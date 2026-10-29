from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.core.agent import agent, agent_tools, artifacts, pages


@pytest.fixture()
def store(tmp_path):
    return agent.AgentStore(tmp_path / "agent")


def create(store, **extra):
    return agent_tools.run("page_create", {"title": "Trabajos de octubre", "html": '<h1 id="total"></h1>',
        "script": "document.querySelector('#total').textContent = AntaresPage.rows.length;", **extra}, store, "s1")


def payload(store, artifact):
    return artifacts.action(store, "s1", {"action": "file", "artifact_id": artifact["id"],
        "sha256": artifact["files"][0]["sha256"]})["page"]


def test_page_tool_registers_and_reopens_complete_dataset(store):
    source = store.workspace_dir("s1") / "trabajos.csv"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text("OT,Metrado\n" + "".join(f"{i},50\n" for i in range(235)), encoding="utf-8")
    result = create(store, spreadsheet_path="trabajos.csv", data={"units": "ml"})
    assert result["row_count"] == 235 and result["columns"] == ["OT", "Metrado"]
    artifact = result["artifact"]
    assert artifact["kind"] == "page" and artifact["files"][0]["mime"] == pages.MIME
    reopened = agent.AgentStore(store.base_dir)
    content = payload(reopened, artifact)
    assert len(content["rows"]) == 235 and content["rows"][-1]["OT"] == "234"
    assert content["data"] == {"units": "ml"}
    assert "rows" not in result and "script" not in artifact
    assert "page_create" in agent_tools.READ_TOOLS


def test_update_keeps_identity_and_data_and_rejects_stale_revision(store):
    first = create(store, data={"values": [1, 2, 3]})["artifact"]
    args = {"artifact_id": first["id"], "expected_revision": first["template_revision"]}
    updated = create(store, title="Revisado", **args)["artifact"]
    assert updated["id"] == first["id"] and updated["created_at"] == first["created_at"]
    assert updated["template_revision"] != first["template_revision"]
    assert payload(store, updated)["data"] == {"values": [1, 2, 3]}
    files = list(store.drafts_dir("s1").iterdir())
    with pytest.raises(ValueError, match="cambió"):
        create(store, **args)
    assert list(store.drafts_dir("s1").iterdir()) == files
    assert len(agent.AgentStore(store.base_dir).artifacts_for("s1")) == 1
    with pytest.raises(ValueError, match="cambió"):
        payload(store, first)


def test_page_ownership_hash_and_pdf_operations(store):
    artifact = create(store)["artifact"]
    params = {"artifact_id": artifact["id"], "action": "file"}
    with pytest.raises(ValueError, match="conversación"):
        artifacts.action(store, "s2", params)
    with pytest.raises(ValueError, match="conversación"):
        pages.create({"title": "Ajena", "html": "x", "script": "", "artifact_id": artifact["id"]}, store, "s2")
    for action in ("preview", "review"):
        with pytest.raises(ValueError, match="página interactiva"):
            artifacts.action(store, "s1", {**params, "action": action})
    Path(artifact["files"][0]["path"]).write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="cambió"):
        artifacts.action(store, "s1", params)


def test_sources_require_authorization_and_never_truncate(store, tmp_path):
    outside = tmp_path / "privado.csv"
    outside.write_text("x\n1\n", encoding="utf-8")
    with pytest.raises(ValueError, match=r"autoriz|usuario"):
        create(store, spreadsheet_path=str(outside))
    source = store.workspace_dir("s1") / "grande.csv"
    source.write_text("x\n" + "1\n" * 5001, encoding="utf-8")
    assert create(store, spreadsheet_path="grande.csv")["row_count"] == 5001
    with pytest.raises(ValueError, match="5 MiB"):
        create(store, data={"large": "x" * pages.MAX_BYTES})


def test_excel_rows_include_the_last_record(store):
    import openpyxl

    source = store.workspace_dir("s1") / "trabajos.xlsx"
    source.parent.mkdir(parents=True, exist_ok=True)
    book = openpyxl.Workbook()
    sheet = book.active
    assert sheet is not None
    sheet.append(["OT", "Metrado"])
    for number in range(235):
        sheet.append([number, 50])
    book.save(source)
    result = create(store, spreadsheet_path="trabajos.xlsx")
    content = payload(store, result["artifact"])
    assert result["row_count"] == 235 and len(content["rows"]) == 235
    assert json.loads(Path(result["artifact"]["files"][0]["path"]).read_text(encoding="utf-8"))["version"] == 1


def test_failed_revision_write_preserves_the_previous_page(store, monkeypatch):
    original = create(store)["artifact"]

    def fail(*args):
        raise OSError("Disco lleno")

    monkeypatch.setattr(agent, "atomic_write_json", fail)
    with pytest.raises(OSError, match="Disco lleno"):
        create(store, title="Nuevo", artifact_id=original["id"], expected_revision=original["template_revision"])
    assert store.artifacts_for("s1")[0] == original
    assert len(list(store.drafts_dir("s1").iterdir())) == 1


def test_failed_creation_does_not_leave_an_artifact_without_its_file(store, monkeypatch):
    def fail(*args):
        raise OSError("Disco lleno")

    monkeypatch.setattr(agent, "atomic_write_json", fail)
    with pytest.raises(OSError, match="Disco lleno"):
        create(store)
    assert store.artifacts_for("s1") == []
    assert list(store.drafts_dir("s1").iterdir()) == []


def test_name_collision_does_not_remove_an_existing_draft(store, monkeypatch):
    from types import SimpleNamespace

    monkeypatch.setattr(pages.uuid, "uuid4", lambda: SimpleNamespace(hex="a" * 32))
    first = create(store)["artifact"]
    original = Path(first["files"][0]["path"]).read_bytes()
    with pytest.raises(FileExistsError):
        create(store, title="Otra")
    assert Path(first["files"][0]["path"]).read_bytes() == original
