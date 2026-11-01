import json
import time
from pathlib import Path

import pytest

from backend.core.agent import agent, agent_chat, agent_tools, skills


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("SKILLS_HOME", str(tmp_path / "configured-skills"))
    monkeypatch.setenv("SKILLS_EXTERNAL_HOMES", str(tmp_path / "external-skills"))
    monkeypatch.delenv("ORBS_SHARED_HOME", raising=False)
    return agent.AgentStore(tmp_path / "agent")


def install(folder: Path, name: str = "pdf-review", description: str = "Revisa documentos PDF") -> Path:
    target = folder / name / "SKILL.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(f"---\nname: {name}\ndescription: {description}\n---\n", encoding="utf-8")
    return target


def run(store, tool, **params):
    return agent_tools.run(tool, params, store, "skills-session")


def test_skill_create_is_a_gated_effect(store):
    assert agent_tools.SPECS["skill_create"]["gated"] is True
    assert "skill_create" in agent_tools.EFFECT_TOOLS
    assert "skill_create" not in agent_tools.READ_TOOLS
    assert "skill_create" in agent_chat.gated_methods()
    assert "skill_create" not in agent_chat.readonly_methods()


def test_skill_create_writes_inside_library_without_overwriting(store):
    target = store.base_dir / "skills" / "weekly-report" / "SKILL.md"
    created = run(store, "skill_create", name="weekly-report", description="Prepara: informe semanal",
                  content="# Pasos\n\n1. Revisa los datos.")
    assert created["created"] is True and created["name"] == "weekly-report"
    assert Path(created["path"]) == target and created["id"]
    original = target.read_text(encoding="utf-8")
    assert "name: weekly-report" in original and "1. Revisa los datos." in original
    listed = run(store, "skills_list")
    assert listed["skills"][0]["id"] == created["id"]
    assert listed["skills"][0]["description"] == "Prepara: informe semanal"
    read = run(store, "skills_read", skill_id=created["id"])
    assert read["name"] == "weekly-report" and "1. Revisa los datos." in read["content"]
    with pytest.raises(ValueError, match="existe"):
        run(store, "skill_create", name="weekly-report", description="Otra", content="Otra")
    assert target.read_text(encoding="utf-8") == original


@pytest.mark.parametrize("name", [
    "../escape", "a/b", "a\\b", "C:evil", "", "UPPER", "a--b", ".oculta", "pdf_review", "a" * 65,
])
def test_skill_create_rejects_names_outside_library(store, name):
    with pytest.raises(ValueError, match="nombre"):
        run(store, "skill_create", name=name, description="Revisa", content="Revisa")
    assert not (store.base_dir / "escape").exists()
    assert not (store.base_dir.parent / "escape").exists()


def test_skill_create_rejects_symlinked_skill_folder(store, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    folder = store.base_dir / "skills" / "linked"
    folder.parent.mkdir(parents=True)
    try:
        folder.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("El sistema no permite crear enlaces simbólicos")
    with pytest.raises(ValueError, match="enlace"):
        run(store, "skill_create", name="linked", description="Revisa", content="Revisa")
    assert not (outside / "SKILL.md").exists()


def test_skill_create_rejects_symlinked_library(store, tmp_path):
    outside = tmp_path / "outside-library"
    outside.mkdir()
    library = store.base_dir / "skills"
    library.parent.mkdir(parents=True, exist_ok=True)
    try:
        library.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("El sistema no permite crear enlaces simbólicos")
    with pytest.raises(ValueError, match="biblioteca"):
        run(store, "skill_create", name="linked-library", description="Revisa", content="Revisa")
    assert not (outside / "linked-library").exists()


def test_skill_create_rejects_oversized_content_before_writing(store):
    with pytest.raises(ValueError, match="64 KiB"):
        run(store, "skill_create", name="huge", description="Revisa", content="x" * (64 * 1024))
    assert not (store.base_dir / "skills" / "huge").exists()
    with pytest.raises(ValueError, match="1024"):
        run(store, "skill_create", name="long-description", description="x" * 1025, content="Revisa")
    assert not (store.base_dir / "skills" / "long-description").exists()


def test_skill_create_content_limit_is_bytes_not_characters(store):
    schema = agent_tools.SPECS["skill_create"]["inputSchema"]["properties"]["content"]
    assert "64 KiB" in schema["description"]
    with pytest.raises(ValueError, match="64 KiB"):
        run(store, "skill_create", name="utf8-too-large", description="Revisa", content="á" * (32 * 1024))
    assert not (store.base_dir / "skills" / "utf8-too-large").exists()
    created = run(store, "skill_create", name="utf8-limit", description="Revisa",
                  content="á" * (32 * 1024 - 64))
    assert created["created"] is True


def test_skill_create_stops_at_catalog_capacity(store):
    library = store.base_dir / "skills"
    library.mkdir(parents=True)
    for index in range(skills._MAX_CANDIDATES - 1):
        (library / f"slot-{index}").mkdir()
    created = run(store, "skill_create", name="last-slot", description="Revisa", content="Revisa")
    assert created["created"] is True
    with pytest.raises(ValueError, match="límite"):
        run(store, "skill_create", name="overflow", description="Revisa", content="Revisa")
    assert not (library / "overflow").exists()


def test_skill_create_requires_approval_and_targets_library(store, monkeypatch):
    from backend.core.exceptions import ValidationError
    from backend.handlers import agent_internal

    monkeypatch.setattr(agent_internal, "_store", lambda: store)
    params = {"name": "approval-target", "description": "Revisa", "content": "Revisa"}
    denied = json.loads(agent_internal.HANDLERS["agent_internal_dispatch"]({
        "session_id": "skills-session", "call_id": "create-without-approval", "name": "skill_create", "params": params,
    })["result"])
    assert "aprobación" in denied["error"]
    approval = agent_internal.HANDLERS["agent_internal_approval_ensure"]({
        "session_id": "skills-session", "call_id": "create-with-approval", "method": "skill_create", "params": params,
    })["approval"]
    assert approval["status"] == "pending"
    assert [resource["path"] for resource in approval["resources"]] == [
        str(store.base_dir / "skills" / "approval-target" / "SKILL.md")]
    install(store.base_dir / "skills", name="approval-target")
    with pytest.raises(ValidationError, match="existe"):
        agent_internal.HANDLERS["agent_internal_approval_ensure"]({
            "session_id": "skills-session", "call_id": "create-existing", "method": "skill_create", "params": params,
        })


def test_skill_create_executes_after_approval(store, monkeypatch):
    from backend.handlers import agent_internal

    monkeypatch.setattr(agent_internal, "_store", lambda: store)
    monkeypatch.setattr(agent_internal._agent, "get_agent_runner", lambda: agent.AgentRunner(store, lambda _: None))
    params = {"name": "approved-skill", "description": "Revisa", "content": "Revisa"}
    approval = agent_internal.HANDLERS["agent_internal_approval_ensure"]({
        "session_id": "skills-session", "call_id": "create-approved", "method": "skill_create", "params": params,
    })["approval"]
    assert not (store.base_dir / "skills" / "approved-skill").exists()
    agent_internal.HANDLERS["agent_internal_approval_decide"]({"approval_id": approval["id"], "approve": True})
    assert agent_internal.HANDLERS["agent_internal_dispatch"]({
        "session_id": "skills-session", "call_id": "create-approved", "name": "skill_create", "params": params,
        "approval_id": approval["id"],
    })["result"] is None
    deadline = time.monotonic() + 5
    result = None
    while time.monotonic() < deadline:
        out = agent_internal.HANDLERS["agent_internal_dispatch_result"]({
            "session_id": "skills-session", "call_id": "create-approved",
        })["result"]
        if out is not None:
            result = json.loads(out)
            break
        time.sleep(0.02)
    assert result is not None and result["created"] is True
    assert (store.base_dir / "skills" / "approved-skill" / "SKILL.md").is_file()


def test_skill_create_and_complementos_share_one_contract(store):
    library = store.base_dir / "skills"
    entry = skills.create(library, "sin-instrucciones", "Solo descripción")
    assert entry["description"] == "Solo descripción"
    assert (library / "sin-instrucciones" / "SKILL.md").is_file()
    with pytest.raises(ValueError, match="instrucciones"):
        run(store, "skill_create", name="otra", description="Revisa")
    created = run(store, "skill_create", name="compartida", description="Primera", content="Pasos")
    with pytest.raises(ValueError, match="ya existe"):
        skills.create(library, "compartida", "Segunda", "Otros")
    assert (library / "compartida" / "SKILL.md").read_text(encoding="utf-8").count("Primera") == 1
    assert created["name"] == "compartida"


def test_skill_create_recovers_an_interrupted_empty_folder(store):
    folder = store.base_dir / "skills" / "reanudada"
    folder.mkdir(parents=True)
    created = run(store, "skill_create", name="reanudada", description="Revisa", content="Pasos")
    assert created["created"] is True
    assert (folder / "SKILL.md").is_file()


def test_skill_create_leaves_no_partial_file_after_a_write_failure(store, monkeypatch):
    target = store.base_dir / "skills" / "interrumpida" / "SKILL.md"

    def fail_fsync(_fd):
        raise OSError("disco lleno")

    monkeypatch.setattr(skills.os, "fsync", fail_fsync)
    with pytest.raises(ValueError, match="No se pudo guardar"):
        skills.create(store.base_dir / "skills", "interrumpida", "Revisa", "Pasos")
    assert not target.exists() and not target.parent.exists()
    monkeypatch.undo()
    assert skills.create(store.base_dir / "skills", "interrumpida", "Revisa", "Pasos")["name"] == "interrumpida"
    assert target.is_file()


def test_publish_does_not_overwrite_an_existing_skill_file(tmp_path):
    target = tmp_path / "SKILL.md"
    target.write_text("original", encoding="utf-8")
    with pytest.raises(FileExistsError):
        skills._publish(target, b"nuevo")
    assert target.read_text(encoding="utf-8") == "original"


def test_skill_create_allows_a_symlinked_ancestor(tmp_path):
    real = tmp_path / "perfil-real"
    (real / "skills").mkdir(parents=True)
    linked = tmp_path / "perfil-enlazado"
    try:
        linked.symlink_to(real, target_is_directory=True)
    except OSError:
        pytest.skip("El sistema no permite crear enlaces simbólicos")
    created = skills.create(linked / "skills", "ancestro-enlazado", "Revisa", "Pasos")
    assert created["name"] == "ancestro-enlazado"
    assert (real / "skills" / "ancestro-enlazado" / "SKILL.md").is_file()
