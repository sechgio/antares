import json

import pytest

from backend.core.agent import agent, agent_tools, memory
from backend.core.exceptions import ValidationError
from backend.handlers import agent_internal

VERSIONS = {"document_generate": "v1", "artifact_print": "v1", "drafts_list": "v1"}


@pytest.fixture()
def store(tmp_path, monkeypatch):
    instance = agent.AgentStore(tmp_path)
    monkeypatch.setattr(agent, "get_agent_store", lambda: instance)
    monkeypatch.setattr(memory, "_stores", {})
    return instance


def _receipt(store, session_id, call_id, method, status):
    outcome, record = store.dispatch_claim(session_id, call_id, method, {"params": {}}, None)
    assert outcome == "new"
    store.dispatch_finish(session_id, call_id, str(record["op_id"]), status, json.dumps({"ok": status != "failed"}))
    return str(record["op_id"])


def _learn(store, session_id="s1", **extra):
    params = {"title": "Informe mensual", "when": "Cuando pidan el informe mensual de cortes",
              "steps": [{"tool": "document_generate", "purpose": "Generar el PDF con la plantilla"},
                        {"tool": "artifact_print", "purpose": "Imprimir el PDF revisado"}], **extra}
    return agent_tools.run("procedure_learn", params, store, session_id)["learned"]


def test_procedure_needs_verified_receipts_from_the_conversation(store):
    with pytest.raises(ValueError, match="Sin comprobante verificado"):
        _learn(store)
    _receipt(store, "s1", "c1", "document_generate", "succeeded")
    _receipt(store, "other", "c2", "artifact_print", "submitted")
    with pytest.raises(ValueError, match="artifact_print"):
        _learn(store)
    op = _receipt(store, "s1", "c3", "artifact_print", "submitted")
    learned = _learn(store)
    assert learned["kind"] == "procedure" and learned["version"] == 1
    assert op in learned["source"]["op_ids"] and learned["source"]["session_id"] == "s1"
    _receipt(store, "s2", "c4", "document_generate", "succeeded")
    _receipt(store, "s2", "c5", "artifact_print", "failed")
    with pytest.raises(ValueError, match="artifact_print"):
        _learn(store, session_id="s2")


def test_steps_are_declarative_and_secrets_are_never_stored(store):
    with pytest.raises(ValueError, match="no guarda"):
        agent_tools.run("memory_remember", {"kind": "fact", "title": "Proveedor", "content": "api_key: sk-abcdefghijklmnopqrstu"},
                        store, "s1")
    with pytest.raises(ValueError):
        _learn(store, steps=[{"tool": "procedure_learn", "purpose": "Recursión"}])
    with pytest.raises(ValueError):
        _learn(store, steps=[{"tool": "document_generate"}])


def test_user_correction_prevails_and_versions_can_be_reverted(store):
    remembered = agent_tools.run("memory_remember", {"kind": "preference", "title": "Impresora", "content": "Usa HP-01"},
                                 store, "s1")["remembered"]
    mem = memory.memory_for(store)
    edited = mem.update(remembered["id"], {"action": "edit", "content": "Usa la impresora Brother"})
    assert edited["version"] == 2 and edited["source"] == {"kind": "user"}
    with pytest.raises(ValueError, match="corrigió"):
        agent_tools.run("memory_remember", {"kind": "preference", "title": "impresora", "content": "Usa HP-01"}, store, "s1")
    reverted = mem.update(remembered["id"], {"action": "revert", "version": 1})
    assert reverted["content"] == "Usa HP-01" and reverted["version"] == 3
    assert reverted["source"]["reverted_to"] == 1
    assert mem.context("s9", "hola", VERSIONS)["context"].count("Usa HP-01") == 1
    mem.update(remembered["id"], {"action": "disable"})
    assert mem.context("s9", "hola", VERSIONS)["context"] == ""


def test_reuse_is_relevant_limited_and_changes_after_correction(store):
    _receipt(store, "s1", "c1", "document_generate", "succeeded")
    _receipt(store, "s1", "c2", "artifact_print", "submitted")
    mem = memory.memory_for(store)
    mem.context("s1", "inicio", VERSIONS)
    learned = _learn(store)
    unrelated = mem.context("s2", "renombra estas fotos", VERSIONS)
    assert learned["id"] not in unrelated["items"]
    used = mem.context("s2", "prepara el informe mensual de cortes", VERSIONS)
    assert learned["id"] in used["items"] and "Imprimir el PDF revisado" in used["context"]
    assert "no conceden permisos" in used["context"]
    mem.update(learned["id"], {"action": "edit", "steps": [{"tool": "document_generate", "purpose": "Generar en CMYK"}]})
    corrected = mem.context("s3", "informe mensual", VERSIONS)
    assert "Generar en CMYK" in corrected["context"] and "Imprimir" not in corrected["context"]
    for n in range(40):
        mem.remember("s1", {"kind": "fact", "title": f"Dato informe {n}", "content": "x" * 900})
    assert len(mem.context("s4", "informe", VERSIONS)["context"]) <= memory.CONTEXT_CHARS + 200


@pytest.mark.parametrize("versions,templates,reason", [
    ({"document_generate": "v1"}, None, "ya no está disponible"),
    ({**VERSIONS, "artifact_print": "v2"}, None, "cambió"),
    (VERSIONS, {"otra"}, "plantilla"),
])
def test_changed_tools_or_templates_suspend_the_procedure(store, versions, templates, reason):
    _receipt(store, "s1", "c1", "document_generate", "succeeded")
    _receipt(store, "s1", "c2", "artifact_print", "submitted")
    mem = memory.memory_for(store)
    mem.context("s1", "inicio", VERSIONS)
    learned = _learn(store, templates=["informe-cortes"])
    out = mem.context("s2", "informe mensual", versions, templates)
    assert learned["id"] not in out["items"]
    item = next(i for i in mem.items() if i["id"] == learned["id"])
    assert item["status"] == "suspended" and reason in item["reason"]
    assert mem.update(learned["id"], {"action": "enable"})["status"] == "active"


def test_repeated_failures_of_an_applied_procedure_suspend_it(store):
    _receipt(store, "s1", "c1", "document_generate", "succeeded")
    _receipt(store, "s1", "c2", "artifact_print", "submitted")
    mem = memory.memory_for(store)
    learned = _learn(store)
    mem.context("s2", "informe mensual", VERSIONS)
    mem.record_outcome("s2", "artifact_print", "failed")
    mem.record_outcome("s2", "artifact_print", "succeeded")
    mem.record_outcome("s2", "artifact_print", "failed")
    assert next(i for i in mem.items() if i["id"] == learned["id"])["status"] == "active"
    mem.record_outcome("s2", "artifact_print", "uncertain")
    assert next(i for i in mem.items() if i["id"] == learned["id"])["status"] == "suspended"


def test_delete_removes_versions_and_derived_references_and_persists(store, tmp_path):
    _receipt(store, "s1", "c1", "document_generate", "succeeded")
    _receipt(store, "s1", "c2", "artifact_print", "submitted")
    mem = memory.memory_for(store)
    learned = _learn(store)
    mem.context("s2", "informe mensual", VERSIONS)
    assert mem.delete(learned["id"]) is True
    reloaded = memory.MemoryStore(tmp_path)
    assert reloaded.items() == [] and reloaded.search("informe") == []
    raw = (tmp_path / "memory.json").read_text(encoding="utf-8")
    assert learned["id"] not in raw and "Imprimir" not in raw


def test_handlers_expose_review_and_reuse_never_grants_an_effect(store):
    _receipt(store, "s1", "c1", "document_generate", "succeeded")
    _receipt(store, "s1", "c2", "artifact_print", "submitted")
    learned = _learn(store)
    listed = agent_internal.HANDLERS["agent_memory_list"]({})["items"]
    assert [item["id"] for item in listed] == [learned["id"]]
    context = agent_internal.HANDLERS["agent_internal_memory_context"](
        {"session_id": "s2", "text": "informe mensual", "tools": [{"name": n, "version": v} for n, v in VERSIONS.items()]})
    assert learned["id"] in context["items"]
    out = agent_internal.HANDLERS["agent_internal_dispatch"](
        {"session_id": "s2", "call_id": "p1", "name": "artifact_print", "params": {"artifact_id": "a", "file_index": 0}})
    assert "aprobación" in json.loads(out["result"])["error"]
    with pytest.raises(ValidationError):
        agent_internal.HANDLERS["agent_memory_update"]({"id": learned["id"], "action": "borrar"})
    assert agent_internal.HANDLERS["agent_memory_delete"]({"id": learned["id"]}) == {"deleted": True}
    assert agent_internal.HANDLERS["agent_memory_list"]({})["items"] == []


def test_a_different_account_suspends_the_procedure(store):
    intent = {"params": {}}
    approval = store.create_approval("s1", {"id": "g1", "name": "gsheets_update_range", "params": {},
                                            "fingerprint": agent.fingerprint("gsheets_update_range", intent),
                                            "context": {"account": "ana@example.com"}})
    store.decide_approval(str(approval["id"]), True)
    outcome, record = store.dispatch_claim("s1", "g1", "gsheets_update_range", intent, str(approval["id"]))
    assert outcome == "new"
    store.dispatch_finish("s1", "g1", str(record["op_id"]), "succeeded", "{}")
    learned = agent_tools.run("procedure_learn", {"title": "Cierre de mes", "when": "Al cerrar el mes",
                                                  "steps": [{"tool": "gsheets_update_range", "purpose": "Anotar totales"}]},
                              store, "s1")["learned"]
    assert learned["accounts"] == {"google": "ana@example.com"}
    mem = memory.memory_for(store)
    versions = {"gsheets_update_range": ""}
    same = mem.context("s2", "cerrar el mes", versions, accounts={"google": "ana@example.com"})
    assert learned["id"] in same["items"]
    other = mem.context("s3", "cerrar el mes", versions, accounts={"google": "otra@example.com"})
    assert learned["id"] not in other["items"]
    item = next(i for i in mem.items() if i["id"] == learned["id"])
    assert item["status"] == "suspended" and "cuenta de Google" in item["reason"]
