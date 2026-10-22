import json
from pathlib import Path

import pytest

from backend.core.agent import agent, agent_chat, agent_tools, resource_grants


@pytest.fixture()
def store(tmp_path):
    return agent.AgentStore(tmp_path / "agent")


def install(folder: Path, name: str = "pdf-review", description: str = "Revisa documentos PDF", body: str = "Revisa cada página.") -> Path:
    target = folder / name / "SKILL.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(f"---\nname: {name}\ndescription: {description}\n---\n{body}", encoding="utf-8")
    return target


def run(store, name, session_id="skills-session", **params):
    return agent_tools.run(name, params, store, session_id)


def test_catalog_discovers_metadata_without_loading_instructions(store):
    install(store.base_dir / "skills", body="INSTRUCCION_PRIVADA")
    result = run(store, "skills_list")
    assert result["skills"][0]["name"] == "pdf-review"
    assert result["skills"][0]["description"] == "Revisa documentos PDF"
    assert "INSTRUCCION_PRIVADA" not in json.dumps(result)
    assert "skills_list" in agent_chat.readonly_methods() and "skills_read" in agent_chat.readonly_methods()


@pytest.mark.parametrize("relative", ["SKILL.md", "references/check.txt"])
def test_read_opens_only_selected_skill_and_requested_file(store, monkeypatch, relative):
    target = install(store.base_dir / "skills", body="Página elegida.\n" * 800)
    (target.parent / "references").mkdir()
    support = target.parent / "references/check.txt"
    support.write_text("Referencia elegida.\n" * 800, encoding="utf-8")
    for index in range(32):
        install(store.base_dir / "skills", name=f"other-{index}", body="No leer esta instrucción")
    skill_id = run(store, "skills_list", query="pdf-review")["skills"][0]["id"]
    opened = []
    original_open = Path.open

    def track_open(path, *args, **kwargs):
        opened.append(path)
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", track_open)
    for offset in (0, 4000):
        opened.clear()
        page = run(store, "skills_read", skill_id=skill_id, file_path=relative, offset=offset)
        assert page["offset"] == offset and page["content"]
        assert len(opened) <= 2 and set(opened) <= {target, target.parent / relative}


def test_attached_folder_takes_priority_over_full_library(store, tmp_path):
    for index in range(256):
        install(store.base_dir / "skills", name=f"library-{index:03}")
    folder = tmp_path / "selected-project"
    install(folder / ".agents/skills", name="target-review")
    store.add_grants("skills-session", [resource_grants.folder_record(str(folder), "request")])
    result = run(store, "skills_list", query="target-review")
    assert result["total"] == 1 and result["truncated"] is True
    assert result["skills"][0]["name"] == "target-review"
    assert run(store, "skills_read", skill_id=result["skills"][0]["id"])["name"] == "target-review"


def test_read_returns_instructions_and_support_files_without_executing(store):
    target = install(store.base_dir / "skills", body="Lee references/checklist.txt y scripts/check.py")
    (target.parent / "references").mkdir()
    (target.parent / "references/checklist.txt").write_text("Revisa los márgenes y firmas.", encoding="utf-8")
    (target.parent / "scripts").mkdir()
    marker = target.parent / "executed"
    (target.parent / "scripts/check.py").write_text(f"from pathlib import Path\nPath({str(marker)!r}).touch()", encoding="utf-8")
    skill_id = run(store, "skills_list")["skills"][0]["id"]
    main = run(store, "skills_read", skill_id=skill_id)
    assert "Lee references/checklist.txt" in main["content"]
    assert main["next_offset"] is None
    assert "márgenes" in run(store, "skills_read", skill_id=skill_id, file_path="references/checklist.txt")["content"]
    assert "touch()" in run(store, "skills_read", skill_id=skill_id, file_path="scripts/check.py")["content"]
    assert not marker.exists()


def test_project_skills_require_live_folder_grants_and_stay_session_scoped(store, tmp_path):
    folder = tmp_path / "project"
    install(folder / ".agents/skills")
    assert run(store, "skills_list")["skills"] == []
    grant = resource_grants.folder_record(str(folder), "request")
    store.add_grants("skills-session", [grant])
    skill_id = run(store, "skills_list")["skills"][0]["id"]
    assert run(store, "skills_list", session_id="another-session")["skills"] == []
    assert "Revisa cada página" in run(store, "skills_read", skill_id=skill_id)["content"]
    store.revoke_grant("skills-session", str(folder))
    with pytest.raises(ValueError, match="disponible"):
        run(store, "skills_read", skill_id=skill_id)


def test_attached_skill_file_does_not_authorize_its_siblings(store, tmp_path):
    target = install(tmp_path / "external")
    (target.parent / "secret.txt").write_text("No autorizado", encoding="utf-8")
    store.add_grants("skills-session", [resource_grants.grant_record(str(target), "request")])
    skill_id = run(store, "skills_list")["skills"][0]["id"]
    assert run(store, "skills_read", skill_id=skill_id)["name"] == "pdf-review"
    with pytest.raises(ValueError, match="autorizad"):
        run(store, "skills_read", skill_id=skill_id, file_path="secret.txt")


@pytest.mark.parametrize("file_path", ["../secret.txt", "references/../../secret.txt", "C:\\Windows\\win.ini", "/etc/passwd", "..\\secret.txt", "references/evil.txt:secret", "\\\\server\\share", ""])
def test_read_rejects_paths_outside_skill(store, file_path):
    install(store.base_dir / "skills")
    skill_id = run(store, "skills_list")["skills"][0]["id"]
    with pytest.raises(ValueError):
        run(store, "skills_read", skill_id=skill_id, file_path=file_path)


def test_rejects_symlinked_support_files(store, tmp_path):
    target = install(store.base_dir / "skills")
    outside = tmp_path / "secret.txt"
    outside.write_text("No autorizado", encoding="utf-8")
    try:
        (target.parent / "link.txt").symlink_to(outside)
    except OSError:
        pytest.skip("El sistema no permite crear enlaces simbólicos")
    skill_id = run(store, "skills_list")["skills"][0]["id"]
    with pytest.raises(ValueError, match=r"enlaces|reparse"):
        run(store, "skills_read", skill_id=skill_id, file_path="link.txt")


def test_read_paginates_without_losing_unicode_content(store):
    target = install(store.base_dir / "skills", body="áéíóú ñ\n" * 1600)
    skill_id = run(store, "skills_list")["skills"][0]["id"]
    chunks = []
    offset = 0
    while offset is not None:
        page = run(store, "skills_read", skill_id=skill_id, offset=offset)
        assert len(page["content"]) <= 4000
        chunks.append(page["content"])
        offset = page["next_offset"]
    assert "".join(chunks) == target.read_bytes().decode("utf-8")


def test_catalog_accepts_yaml_multiline_metadata_and_ignores_broken_entries(store):
    valid = install(store.base_dir / "skills", description='>-\n  Revisa PDFs\n  con firmas')
    install(store.base_dir / "skills", "invalid", description="[broken")
    install(store.base_dir / "skills", "huge", body="x" * 70_000)
    result = run(store, "skills_list", query="FIRMAS")
    assert [skill["name"] for skill in result["skills"]] == [valid.parent.name]
    assert result["skills"][0]["description"] == "Revisa PDFs con firmas"
    assert result["warnings"]


def test_control_characters_fit_the_tool_budget_without_losing_pagination(store):
    target = install(store.base_dir / "skills", body="\x01" * 6000)
    skill_id = run(store, "skills_list")["skills"][0]["id"]
    chunks = []
    offset = 0
    while offset is not None:
        page = run(store, "skills_read", skill_id=skill_id, offset=offset)
        assert len(json.dumps(page, ensure_ascii=False)) <= 5600
        chunks.append(page["content"])
        offset = page["next_offset"]
    assert "".join(chunks) == target.read_bytes().decode("utf-8")


def test_duplicate_names_are_distinguishable_and_ids_survive_reopening(store):
    install(store.base_dir / "skills")
    install(store.drafts_dir("skills-session") / "skills")
    result = run(store, "skills_list")
    assert len(result["skills"]) == 2
    assert len({skill["id"] for skill in result["skills"]}) == 2
    reopened = agent.AgentStore(store.base_dir)
    assert run(reopened, "skills_list")["skills"] == result["skills"]


@pytest.mark.parametrize("header", [
    "name: another-name\ndescription: Revisa PDFs",
    "name: pdf-review",
    "name: pdf-review\ndescription: !!python/object/apply:builtins.str [unsafe]",
    "name: pdf-review\ndescription: [not, a, string]",
])
def test_catalog_rejects_invalid_metadata_and_python_yaml_tags(store, header):
    target = install(store.base_dir / "skills")
    target.write_text(f"---\n{header}\n---\nInstrucciones", encoding="utf-8")
    result = run(store, "skills_list")
    assert result["skills"] == [] and result["warnings"]


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 21}, {"limit": True}, {"query": []}, {"query": "x" * 201}])
def test_catalog_validates_input(store, params):
    with pytest.raises(ValueError):
        run(store, "skills_list", **params)


def test_skill_metadata_does_not_grant_tools_or_permissions(store):
    target = install(store.base_dir / "skills")
    target.write_text(target.read_text(encoding="utf-8").replace("---\nRevisa", "allowed-tools: shell_run desktop_click\n---\nRevisa"), encoding="utf-8")
    before = set(agent_tools.EFFECT_TOOLS)
    skill_id = run(store, "skills_list")["skills"][0]["id"]
    assert "allowed-tools" in run(store, "skills_read", skill_id=skill_id)["content"]
    assert set(agent_tools.EFFECT_TOOLS) == before
    assert store.grants_for("skills-session") == {}
    assert "shell_run" not in agent_tools.READ_TOOLS
