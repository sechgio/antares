from datetime import date, timedelta

import pytest

from backend.core.agent import agent, memory
from backend.core.exceptions import ValidationError
from backend.handlers import agent_internal

VERSIONS = {"document_generate": "v1", "artifact_print": "v1", "drafts_list": "v1"}


@pytest.fixture()
def store(tmp_path, monkeypatch):
    instance = agent.AgentStore(tmp_path)
    monkeypatch.setattr(agent, "get_agent_store", lambda: instance)
    monkeypatch.setattr(memory, "_stores", {})
    return instance


def test_compaction_candidates_become_expiring_inferred_memories(store, monkeypatch):
    mem = memory.memory_for(store)
    mem.context("s1", "inicio", VERSIONS)
    candidate = {"kind": "preference", "title": "Formato", "content": "Prefiere los informes en PDF"}
    counts = mem.promote("s1", [candidate,
                              {"kind": "fact", "title": "Proveedor", "content": "api_key: sk-abcdefghijklmnopqrstu"},
                              {"kind": "fact", "title": "formato", "content": "Otra redacción del mismo título"},
                              {"kind": "fact", "title": "Entrega", "content": "prefiere los informes en PDF"},
                              {"kind": "procedure", "title": "Pasos", "content": "Genera y envía"}])
    assert counts == {"promoted": 1, "updated": 0, "deduplicated": 2, "rejected": 2}
    item = mem.items()[0]
    assert item["confidence"] == "inferred" and item["source"]["via"] == "compaction"
    assert item["expires_at"] - memory._now() > 29 * 86400000
    assert "Prefiere los informes en PDF" in mem.context("s2", "informes", VERSIONS)["context"]
    assert mem.promote("s1", [candidate]) == {"promoted": 0, "updated": 0, "deduplicated": 1, "rejected": 0}
    later = memory._now() + 31 * 86400000
    monkeypatch.setattr(memory, "_now", lambda: later)
    assert mem.context("s2", "informes", VERSIONS)["context"] == ""
    assert mem.promote("s1", [candidate])["updated"] == 1
    assert len(mem.items()) == 1 and mem.items()[0]["expires_at"] > later
    edited = mem.update(item["id"], {"action": "edit", "content": "Prefiere los informes en PDF"})
    assert edited["expires_at"] is None and edited["confidence"] == "confirmed"
    reloaded = memory.MemoryStore(store.base_dir)
    assert reloaded.items()[0]["expires_at"] is None
    monkeypatch.setattr(memory, "MAX_ITEMS", len(mem.items()) + memory.AUTO_HEADROOM)
    assert mem.promote("s1", [{"kind": "fact", "title": "Sede", "content": "La sede está en Lima"}])["rejected"] == 1
    assert mem.remember("s1", {"kind": "fact", "title": "Sede", "content": "La sede está en Lima"})["kind"] == "fact"
    mem.context("s3", "inicio", VERSIONS, profile_id="p1", memory_scope="none")
    with pytest.raises(ValueError, match="no usa memoria"):
        mem.promote("s3", [candidate])


def test_dreaming_promotes_corroborated_journal_facts_and_archives_the_batch(store):
    mem = memory.memory_for(store)
    mem.context("s1", "inicio", VERSIONS, profile_id="p1")
    mem.context("s2", "inicio", VERSIONS, profile_id="p2")

    def journal(session_id, title, content, days_ago):
        return mem.remember(session_id, {"kind": "journal", "title": title, "content": content,
                                         "date": (date.today() - timedelta(days=days_ago)).isoformat()})

    first = journal("s1", "Visita", "El usuario dijo que la oficina está en Lima", 2)
    second = journal("s1", "Llamada", "Repitió que la oficina está en Lima y que firma como Ana", 1)
    old = journal("s1", "Antiguo", "Nota de hace semanas", 12)
    other = journal("s2", "Ajeno", "Diario de otro agente", 1)
    known = mem.remember("s1", {"kind": "fact", "title": "Impresora", "content": "Usa la impresora Brother"})
    stale = mem.remember("s1", {"kind": "fact", "title": "Sede", "content": "La oficina está en Quito"})
    corrected = mem.remember("s1", {"kind": "preference", "title": "Idioma", "content": "Responde en español"})
    mem.update(corrected["id"], {"action": "edit", "content": "Responde siempre en español"})

    dream = mem.dream_input("p1", 7)
    assert [entry["id"] for entry in dream["journals"]] == [second["id"], first["id"]]
    assert not any(entry["archived"] for entry in dream["journals"])
    assert {entry["id"] for entry in dream["memories"]} == {known["id"], stale["id"], corrected["id"]}

    both = [first["id"], second["id"]]
    counts = mem.consolidate("p1", None, both,
                             [{"title": "Oficina", "content": "La oficina está en Lima", "sources": both},
                              {"title": "Firma", "content": "Firma como Ana", "sources": [second["id"]]},
                              {"title": "Firma del usuario", "content": "Firma los informes como Ana",
                               "sources": [second["id"]], "explicit": True},
                              {"title": "Impresora", "content": "Usa la impresora Brother", "sources": both},
                              {"title": "Ajena", "content": "Dato citado de otro diario",
                               "sources": [other["id"], old["id"]]}],
                             [{"title": "Clave", "content": "password: hunter2hunter2", "sources": both}],
                             [stale["id"], corrected["id"]])
    assert counts == {"promoted": 2, "updated": 0, "deduplicated": 1, "rejected": 1,
                      "insufficient": 2, "obsoleted": 1, "archived": 2}
    view = {item["id"]: item for item in mem.items()}
    oficina = next(item for item in mem.items() if item["title"] == "Oficina")
    assert oficina["profile_id"] == "p1" and oficina["confidence"] == "inferred"
    assert oficina["expires_at"] is None
    assert oficina["source"] == {"kind": "agent", "via": "dreaming", "journal_ids": both}
    assert view[stale["id"]]["status"] == "suspended" and view[corrected["id"]]["status"] == "active"
    assert view[first["id"]]["consolidated_at"] and view[second["id"]]["consolidated_at"]
    assert not view[old["id"]].get("consolidated_at") and not view[other["id"]].get("consolidated_at")
    assert not any(item["kind"] == "procedure" for item in mem.items())

    rerun = mem.consolidate("p1", None, both,
                            [{"title": "Oficina", "content": "La oficina está en Lima", "sources": both}], [], [])
    assert rerun["promoted"] == 0 and rerun["deduplicated"] == 1 and rerun["archived"] == 0
    reloaded = memory.MemoryStore(store.base_dir).dream_input("p1", 7)
    assert all(entry["archived"] for entry in reloaded["journals"])
    assert mem.update(stale["id"], {"action": "enable"})["status"] == "active"


def test_memory_promotion_handlers_reach_the_store(store):
    agent_internal.HANDLERS["agent_internal_memory_context"]({"session_id": "s1", "text": "inicio"})
    counts = agent_internal.HANDLERS["agent_internal_memory_promote"](
        {"session_id": "s1", "items": [{"kind": "fact", "title": "Dato", "content": "Contenido del dato"}]})
    assert counts["promoted"] == 1
    assert agent_internal.HANDLERS["agent_internal_memory_dream_input"](
        {"profile_id": "p1", "days": 7}) == {"journals": [], "memories": []}
    with pytest.raises(ValidationError):
        agent_internal.HANDLERS["agent_internal_memory_consolidate"](
            {"profile_id": "p1", "memory_scope": "none", "journal_ids": []})


def test_dreaming_payloads_match_the_ipc_catalog():
    from backend.core.ipc_catalog import validate_params_schema

    promote = {"session_id": "s1", "items": [{"kind": "preference", "title": "Formato", "content": "PDF"}]}
    assert validate_params_schema("agent_internal_memory_promote", promote) is None
    bad = {"session_id": "s1", "items": [{"kind": "procedure", "title": "Pasos", "content": "x"}]}
    assert validate_params_schema("agent_internal_memory_promote", bad) is not None
    consolidate = {"profile_id": "p1", "memory_scope": None, "journal_ids": ["j1"],
                   "facts": [{"title": "Oficina", "content": "Lima", "sources": ["j1"], "explicit": False}],
                   "preferences": [], "obsolete": ["m1"]}
    assert validate_params_schema("agent_internal_memory_consolidate", consolidate) is None
    assert validate_params_schema("agent_internal_memory_consolidate",
                                  {**consolidate, "memory_scope": "none"}) is not None
    assert validate_params_schema("agent_internal_memory_dream_input",
                                  {"profile_id": "p1", "days": 7}) is None
