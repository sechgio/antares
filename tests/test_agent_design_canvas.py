from __future__ import annotations

import shutil
import subprocess

import pytest

from backend.core.agent import agent, agent_tools, artifacts, design_canvas, modules


@pytest.fixture()
def store(tmp_path):
    return agent.AgentStore(tmp_path / "agent")


def board(board_id, **extra):
    return {"id": board_id, "w": 390, "h": 844, "html": f"<h1>{board_id}</h1>", **extra}


def write(store, **args):
    return agent_tools.run("design_canvas_write", args, store, "s1")


def test_canvas_registers_as_design_page_and_lays_out_boards(store):
    poster = board("poster", title="Póster", html='<h1 style="color: {{accent}}">Menú</h1>',
                   props={"accent": {"type": "color", "default": "#D97757", "label": "Acento"}})
    result = write(store, title="Menú de primavera", boards=[poster, board("story", w=1080, h=1920)])
    artifact = result["artifact"]
    assert artifact["kind"] == "page" and result["panel"]["type"] == "page"
    assert [(b["id"], b["x"], b["y"]) for b in result["boards"]] == [("poster", 0, 0), ("story", 470, 0)]
    page = artifacts.action(store, "s1", {"action": "file", "artifact_id": artifact["id"]})["page"]
    assert page["title"] == "Menú de primavera" and "<h1>Menú de primavera</h1>" in page["html"]
    assert page["data"]["design_canvas"]["boards"][0]["props"]["accent"]["default"] == "#D97757"
    assert {"design_canvas_write", "design_canvas_read"} <= agent_tools.READ_TOOLS
    assert modules.module_for("design_canvas_write") == "design"


def test_rows_wrap_when_canvas_gets_wide(store):
    result = write(store, title="Piezas", boards=[board(f"b{i}", w=1440, h=900) for i in range(3)])
    assert [(b["x"], b["y"]) for b in result["boards"]] == [(0, 0), (1520, 0), (0, 1020)]


def test_revision_replaces_by_id_keeps_positions_and_rejects_stale(store):
    first = write(store, title="App", boards=[board("login", x=10, y=20), board("home")])["artifact"]
    read = agent_tools.run("design_canvas_read", {"artifact_id": first["id"]}, store, "s1")
    assert read["expected_revision"] == first["template_revision"] and [b["id"] for b in read["boards"]] == ["login", "home"]
    args = {"artifact_id": first["id"], "expected_revision": first["template_revision"]}
    updated = write(store, boards=[board("login", html="<h1>Entrar</h1>"), board("settings")], remove=["home"], **args)
    assert updated["artifact"]["id"] == first["id"]
    assert [(b["id"], b["x"], b["y"]) for b in updated["boards"]] == [("login", 10, 20), ("settings", 0, 984)]
    boards = agent_tools.run("design_canvas_read", {"artifact_id": first["id"]}, store, "s1")["boards"]
    assert boards[0]["html"] == "<h1>Entrar</h1>" and read["title"] == "App"
    with pytest.raises(ValueError, match="cambió"):
        write(store, boards=[board("login")], **args)


def test_partial_revision_moves_and_renames_without_html_and_read_filters(store):
    first = write(store, title="Flujo", boards=[board("login", html="<a data-goto='home'>Entrar</a>"), board("home")],
                  notes=[{"id": "t", "kind": "title", "text": "Alta", "x": 0, "y": -260, "w": 860}])["artifact"]
    updated = write(store, boards=[{"id": "home", "title": "Inicio", "x": 900, "y": 0}],
                    artifact_id=first["id"], expected_revision=first["template_revision"])
    assert [(b["id"], b["x"]) for b in updated["boards"]] == [("login", 0), ("home", 900)]
    read = agent_tools.run("design_canvas_read", {"artifact_id": first["id"], "board_ids": ["home"]}, store, "s1")
    login, home = read["boards"]
    assert "html" not in login and login["title"] == ""
    assert home["title"] == "Inicio" and home["html"] == "<h1>home</h1>"
    assert read["notes"] == [{"id": "t", "kind": "title", "text": "Alta", "x": 0, "y": -260, "w": 860}]
    with pytest.raises(ValueError, match="enlaza con data-goto a home"):
        write(store, boards=[], remove=["home"], artifact_id=first["id"], expected_revision=read["expected_revision"])
    cleared = write(store, boards=[], notes=[], artifact_id=first["id"], expected_revision=read["expected_revision"])
    assert agent_tools.run("design_canvas_read", {"artifact_id": cleared["artifact"]["id"]}, store, "s1")["notes"] == []


@pytest.mark.parametrize(("item", "message"), [
    (board("a", html="<script>alert(1)</script>"), "no ejecuta scripts"),
    (board("a", html="<p>{{price}}</p>"), "sin declararla"),
    (board("a", w=20), "w de a"),
    (board("a", props={"accent": {"type": "color", "default": "red"}}), "#RRGGBB"),
    (board("a b"), "id"),
    ({"id": "a", "w": 390, "h": 844}, "necesita html"),
    (board("a", html="<button data-goto='b'>Ir</button>"), "data-goto a b"),
])
def test_invalid_boards_are_rejected(store, item, message):
    with pytest.raises(ValueError, match=message):
        write(store, title="Lienzo", boards=[item])


@pytest.mark.parametrize(("note", "message"), [
    ({"id": "n", "kind": "box", "text": "x", "x": 0, "y": 0}, "kind"),
    ({"id": "n", "kind": "note", "text": " ", "x": 0, "y": 0}, "text"),
    ({"id": "n", "kind": "note", "text": "x", "x": 0, "y": 0, "color": "red"}, "color"),
])
def test_invalid_notes_are_rejected(store, note, message):
    with pytest.raises(ValueError, match=message):
        write(store, title="Lienzo", boards=[board("a")], notes=[note])


def test_canvas_requires_title_boards_and_its_own_artifacts(store):
    with pytest.raises(ValueError, match="title"):
        write(store, boards=[board("a")])
    with pytest.raises(ValueError, match="entre 1"):
        write(store, title="Vacío", boards=[])
    with pytest.raises(ValueError, match="dos veces"):
        write(store, title="Doble", boards=[board("a"), board("a")])
    page = agent_tools.run("page_create", {"title": "Panel", "html": "<p>x</p>", "script": ""}, store, "s1")["artifact"]
    with pytest.raises(ValueError, match="no es un lienzo"):
        agent_tools.run("design_canvas_read", {"artifact_id": page["id"]}, store, "s1")
    with pytest.raises(ValueError, match="no pertenece"):
        agent_tools.run("design_canvas_read", {"artifact_id": "otro"}, store, "s1")


@pytest.mark.skipif(shutil.which("node") is None, reason="Node no está disponible")
def test_renderer_script_is_valid_module(tmp_path):
    source = tmp_path / "renderer.mjs"
    source.write_text(design_canvas._SCRIPT, encoding="utf-8")
    subprocess.run(["node", "--check", str(source)], check=True, capture_output=True)
