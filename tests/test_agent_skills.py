import json
import time
from pathlib import Path

import pytest

from backend.core.agent import agent, agent_chat, agent_tools, computer_files, resource_grants, skills


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("SKILLS_HOME", str(tmp_path / "configured-skills"))
    monkeypatch.setenv("SKILLS_EXTERNAL_HOMES", str(tmp_path / "external-skills"))
    monkeypatch.delenv("ORBS_SHARED_HOME", raising=False)
    return agent.AgentStore(tmp_path / "agent")


def install(folder: Path, name: str = "pdf-review", description: str = "Revisa documentos PDF", body: str = "Revisa cada página.") -> Path:
    target = folder / name / "SKILL.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(f"---\nname: {name}\ndescription: {description}\n---\n{body}", encoding="utf-8")
    return target


def run(store, tool, session_id="skills-session", **params):
    return agent_tools.run(tool, params, store, session_id)


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


def test_skills_list_handler_lists_library_metadata_for_the_ui(store, monkeypatch):
    from backend.handlers import agent_internal

    install(store.base_dir / "skills", body="INSTRUCCION_PRIVADA")
    install(store.base_dir.parent / "configured-skills/_shared", name="compartida", description="Skill compartida")
    (store.base_dir / "skills/rota").mkdir()
    (store.base_dir / "skills/rota/SKILL.md").write_text("sin encabezado", encoding="utf-8")
    monkeypatch.setattr(agent_internal, "_store", lambda: store)
    result = agent_internal.HANDLERS["agent_skills_list"]({})
    assert [skill["name"] for skill in result["skills"]] == ["compartida", "pdf-review"]
    assert result["skills"][1]["description"] == "Revisa documentos PDF"
    assert result["library"] == str(store.base_dir / "skills") and result["warnings"]
    assert "INSTRUCCION_PRIVADA" not in json.dumps(result)


def test_layered_skills_do_not_grant_general_file_access(store, tmp_path, monkeypatch):
    home = tmp_path / "configured-skills"
    target = install(home / "_shared")
    monkeypatch.setenv("SKILLS_HOME", str(home))
    workspace = store.drafts_dir("skills-session")
    result = skills.run("skills_list", {}, {}, workspace, store.base_dir / "skills", agent_id="reader")
    assert [entry["location"] for entry in result["skills"]] == [str(target)]
    with pytest.raises(ValueError, match="autorizad"):
        computer_files.resolve(str(target), {}, workspace)
    assert store.grants_for("skills-session") == {}


def test_external_skills_keep_shared_fallback_and_do_not_grant_file_access(store, tmp_path):
    external = install(tmp_path / "external-skills", name="external-review")
    install(tmp_path / "configured-skills/_shared")
    workspace, library = store.drafts_dir("skills-session"), store.base_dir / "skills"
    catalog = skills.library_catalog(library)
    listed = {entry["name"]: entry["id"] for entry in catalog["skills"]}
    assert set(listed) == {"external-review", "pdf-review"}
    fallback = skills.resolve(listed["pdf-review"], {}, workspace, library, agent_id="reader")
    assert "_shared" in fallback["warning"]
    content = skills.run("skills_read", {"skill_id": listed["external-review"]}, {}, workspace, library,
                         agent_id="reader")
    assert content["name"] == "external-review"
    with pytest.raises(ValueError, match="autorizad"):
        computer_files.resolve(str(external), {}, workspace)


def test_shadowed_shared_id_cannot_be_read(store, tmp_path):
    home = tmp_path / "configured-skills"
    install(home / "_shared", body="Compartida")
    workspace = store.drafts_dir("skills-session")
    library = store.base_dir / "skills"
    shared_id = skills.run("skills_list", {}, {}, workspace, library, agent_id="reader")["skills"][0]["id"]
    install(home / "reader", body="Propia")
    with pytest.raises(ValueError, match="disponible"):
        skills.run("skills_read", {"skill_id": shared_id}, {}, workspace, library, agent_id="reader")


@pytest.mark.parametrize("agent_id", ["../writer", "reader/writer", "reader\\writer", "C:writer", "_shared", ""])
def test_layered_skills_reject_agent_path_traversal(store, agent_id):
    with pytest.raises(ValueError, match="identificador"):
        skills.run("skills_list", {}, {}, store.drafts_dir("skills-session"), store.base_dir / "skills", agent_id=agent_id)


def test_loading_does_not_create_missing_skill_roots(store, tmp_path):
    home = tmp_path / "configured-skills"
    skills.run("skills_list", {}, {}, store.drafts_dir("skills-session"), store.base_dir / "skills", agent_id="reader")
    assert not home.exists()


@pytest.mark.parametrize("attach_folder", [False, True])
def test_attached_shared_skill_still_cannot_override_agent_skill(store, tmp_path, attach_folder):
    home = tmp_path / "configured-skills"
    shared = install(home / "_shared")
    own = install(home / "reader")
    grant = resource_grants.folder_record(str(shared.parent.parent), "request") if attach_folder \
        else resource_grants.grant_record(str(shared), "request")
    result = skills.run("skills_list", {}, {"attached": grant}, store.drafts_dir("skills-session"),
                        store.base_dir / "skills", agent_id="reader")
    assert [entry["location"] for entry in result["skills"]] == [str(own)]
    assert len(result["warnings"]) == 1


@pytest.mark.parametrize("attach_file", [False, True])
def test_full_shared_catalog_preserves_attached_skill_priority(store, tmp_path, attach_file):
    home = tmp_path / "configured-skills"
    for index in range(256):
        install(home / "_shared", name=f"shared-{index:03}")
    target = install(tmp_path / "attached/.agents/skills", name="attached-only")
    grant = resource_grants.grant_record(str(target), "request") if attach_file \
        else resource_grants.folder_record(str(tmp_path / "attached"), "request")
    store.add_grants("skills-session", [grant])
    grants = store.grants_for("skills-session")
    workspace, library = store.drafts_dir("skills-session"), store.base_dir / "skills"
    result = skills.run("skills_list", {"query": "attached-only"}, grants, workspace, library, agent_id="reader")
    assert result["total"] == 1 and result["truncated"] is True
    skill_id = result["skills"][0]["id"]
    assert skills.run("skills_read", {"skill_id": skill_id}, grants, workspace, library, agent_id="reader")["name"] == "attached-only"


def test_full_shared_catalog_keeps_agent_override_with_attached_shared_root(store, tmp_path, monkeypatch):
    home = tmp_path / "configured-skills"
    own = install(home / "reader", name="review", body="Propia")
    install(home / "_shared", name="review", body="Compartida")
    for index in range(255):
        install(home / "_shared", name=f"shared-{index:03}")
    grant = resource_grants.folder_record(str(home / "_shared"), "request")
    scans = []
    original_iterdir = Path.iterdir

    def track_iterdir(folder):
        scans.append(folder)
        return original_iterdir(folder)

    monkeypatch.setattr(Path, "iterdir", track_iterdir)
    result = skills.run("skills_list", {"query": "review"}, {"attached": grant}, store.drafts_dir("skills-session"),
                        store.base_dir / "skills", agent_id="reader")
    assert [entry["location"] for entry in result["skills"]] == [str(own)]
    assert len(result["warnings"]) == 1
    assert scans.count(home / "_shared") == 1 and scans.count(home / "reader") == 1


def test_composer_skill_resolves_with_agent_levels_and_rejects_unknown_ids(store, tmp_path, monkeypatch):
    from backend.core.exceptions import ValidationError
    from backend.handlers import agent_internal

    home = tmp_path / "configured-skills"
    install(home / "_shared", body="Compartida")
    install(home / "_shared", name="informe", description="Redacta informes")
    install(home / "reader", body="Propia")
    monkeypatch.setattr(agent_internal, "_store", lambda: store)
    resolve = agent_internal.HANDLERS["agent_internal_skill_resolve"]
    listed = {skill["name"]: skill["id"] for skill in agent_internal.HANDLERS["agent_skills_list"]({})["skills"]}
    workspace, library = store.drafts_dir("skills-session"), store.base_dir / "skills"

    own = resolve({"session_id": "skills-session", "skill_id": listed["pdf-review"], "profile_id": "reader"})["skill"]
    assert own["name"] == "pdf-review" and own["id"] != listed["pdf-review"] and own["warning"] is None
    assert skills.run("skills_read", {"skill_id": own["id"]}, {}, workspace, library, agent_id="reader")["content"].endswith("Propia")
    fallback = resolve({"session_id": "skills-session", "skill_id": listed["informe"], "profile_id": "reader"})["skill"]
    assert fallback["id"] == listed["informe"] and "_shared" in fallback["warning"]
    assert fallback["notice"] == skills._NOTICE
    assert resolve({"session_id": "skills-session", "skill_id": listed["informe"]})["skill"]["warning"] is None
    for unknown in ("0" * 24, "../reader", 17):
        with pytest.raises(ValidationError, match="desconocida"):
            resolve({"session_id": "skills-session", "skill_id": unknown, "profile_id": "reader"})
    with pytest.raises(ValidationError, match="perfil"):
        resolve({"session_id": "skills-session", "skill_id": listed["informe"], "profile_id": ""})
