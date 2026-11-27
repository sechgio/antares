import pytest

from backend.core.agent import agent, agent_tools, memory
from backend.handlers import agent_internal
from tests.test_agent_memory import VERSIONS
from tests.test_agent_memory import store as store


def test_memory_write_tools_are_not_approval_gated():
    specs = {spec["name"]: spec for spec in memory.TOOL_SPECS}
    assert specs["memory_remember"]["gated"] is False
    assert specs["procedure_learn"]["gated"] is False
    assert specs["memory_search"]["gated"] is False
    essential = specs["memory_remember"]["inputSchema"]["properties"]["essential"]
    assert essential["type"] == "boolean"
    assert "essential" not in specs["memory_remember"]["inputSchema"]["required"]


def test_essential_memory_is_injected_without_relevance(store):
    mem = memory.memory_for(store)
    pinned = agent_tools.run(
        "memory_remember",
        {"kind": "fact", "title": "Zapatos de seguridad", "content": "La bodega exige casco", "essential": True},
        store,
        "s1",
    )["remembered"]
    assert pinned["essential"] is True
    unrelated = agent_tools.run(
        "memory_remember",
        {"kind": "fact", "title": "Formato carta", "content": "Los informes van en carta"},
        store,
        "s1",
    )["remembered"]
    assert "essential" not in unrelated
    rendered = mem.context("s1", "cuánto vale el tornillo de 3 pulgadas", VERSIONS)
    assert "Zapatos de seguridad" in rendered["context"], "el recuerdo fijado entra sin relevancia temática"
    assert "Formato carta" not in rendered["context"], "el no fijado sigue compitiendo por relevancia"
    assert str(pinned["id"]) in rendered["items"]


def test_essential_memories_do_not_consume_the_ranked_item_budget(store):
    mem = memory.memory_for(store)
    for index in range(3):
        agent_tools.run(
            "memory_remember",
            {"kind": "fact", "title": f"Fijado {index}", "content": f"hecho fijado {index}", "essential": True},
            store,
            "s1",
        )
    words = ["alfa", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliett"]
    for index in range(memory.CONTEXT_ITEMS + 2):
        agent_tools.run(
            "memory_remember",
            {"kind": "fact", "title": f"Dato {words[index]}", "content": f"el valor de {words[index]} es {index}"},
            store,
            "s1",
        )
    rendered = mem.context("s1", " ".join(words), VERSIONS)
    lines = [line for line in rendered["context"].splitlines() if line.startswith("- ")]
    pinned_lines = [line for line in lines if "Fijado" in line]
    ranked_lines = [line for line in lines if "Dato" in line]
    assert len(pinned_lines) == 3, "los fijados entran todos sin consumir el cupo"
    assert len(ranked_lines) == memory.CONTEXT_ITEMS, "el cupo de relevancia se mantiene para el resto"


def test_essential_requires_boolean_and_rejects_journals(store):
    with pytest.raises(ValueError, match="verdadero o falso"):
        agent_tools.run(
            "memory_remember", {"kind": "fact", "title": "X", "content": "Y", "essential": "sí"}, store, "s1"
        )
    with pytest.raises(ValueError, match="diario es episódico"):
        agent_tools.run(
            "memory_remember",
            {"kind": "journal", "title": "Bitácora", "content": "hoy pasó algo", "essential": True},
            store,
            "s1",
        )


def test_pin_and_unpin_actions_toggle_injection(store):
    mem = memory.memory_for(store)
    remembered = agent_tools.run(
        "memory_remember", {"kind": "fact", "title": "Tono", "content": "Prefiere respuestas breves"}, store, "s1"
    )["remembered"]
    text = "presupuesto anual de tuberías"
    assert remembered["title"] not in mem.context("s1", text, VERSIONS)["context"]
    pinned = mem.update(remembered["id"], {"action": "pin"})
    assert pinned["essential"] is True
    assert "Tono" in mem.context("s1", text, VERSIONS)["context"]
    unpinned = mem.update(remembered["id"], {"action": "unpin"})
    assert "essential" not in unpinned
    assert "Tono" not in mem.context("s1", text, VERSIONS)["context"]


def test_pin_rejects_journals_and_procedures(store):
    journal = agent_tools.run(
        "memory_remember", {"kind": "journal", "title": "Bitácora", "content": "hoy pasó algo"}, store, "s1"
    )["remembered"]
    mem = memory.memory_for(store)
    with pytest.raises(ValueError, match="hechos y preferencias"):
        mem.update(journal["id"], {"action": "pin"})
    with pytest.raises(ValueError, match="Acción de memoria no válida"):
        mem.update(journal["id"], {"action": "fijar"})


def test_pin_unpin_roundtrip_through_ipc_handler(store, monkeypatch):
    remembered = agent_tools.run(
        "memory_remember", {"kind": "fact", "title": "Puerto", "content": "El servidor usa el 8443"}, store, "s1"
    )["remembered"]
    result = agent_internal._memory_update({"id": remembered["id"], "action": "pin"})
    assert result["item"]["essential"] is True
    result = agent_internal._memory_update({"id": remembered["id"], "action": "unpin"})
    assert "essential" not in result["item"]


def test_capture_absorbs_memories_and_advances_watermark(store):
    mem = memory.memory_for(store)
    counts = mem.capture(
        "s1",
        None,
        [{"title": "Puerto del servidor", "content": "El servidor usa el 8443"}],
        [{"title": "Tono breve", "content": "Prefiere respuestas breves"}],
        up_to_ts=5000,
    )
    assert counts["promoted"] == 2
    assert mem.capture_watermark("s1") == 5000
    titles = {item["title"] for item in mem.items()}
    assert {"Puerto del servidor", "Tono breve"} <= titles
    sources = {item["source"].get("via") for item in mem.items()}
    assert "capture" in sources
    again = mem.capture(
        "s1", None, [{"title": "Puerto del servidor", "content": "El servidor usa el 8443"}], [], up_to_ts=6000
    )
    assert again["promoted"] == 0 and again["deduplicated"] + again["updated"] == 1
    assert mem.capture_watermark("s1") == 6000


def test_capture_watermark_never_goes_backwards_and_persists(store, tmp_path):
    mem = memory.memory_for(store)
    mem.capture("s1", None, [], [], up_to_ts=9000)
    mem.capture("s1", None, [], [], up_to_ts=3000)
    assert mem.capture_watermark("s1") == 9000
    monkeypatch_store = agent.AgentStore(tmp_path)
    reloaded = memory.memory_for(monkeypatch_store)
    assert reloaded.capture_watermark("s1") == 9000, "la marca sobrevive a la relectura del disco"


def test_capture_respects_scope_none_and_incognito(store):
    mem = memory.memory_for(store)
    with pytest.raises(ValueError, match="no usa memoria"):
        mem.capture("s1", "none", [{"title": "X", "content": "Y"}], [], up_to_ts=1000)
    mem._incognito.add("s9")
    counts = mem.capture("s9", None, [{"title": "X", "content": "Y"}], [], up_to_ts=1000)
    assert counts["rejected"] == 1
    assert not any(item["title"] == "X" for item in mem.items())


def test_capture_input_lists_active_memories_for_dedupe(store):
    mem = memory.memory_for(store)
    agent_tools.run(
        "memory_remember",
        {"kind": "fact", "title": "Formato carta", "content": "Los informes van en carta"},
        store,
        "s1",
    )
    result = mem.capture_input("s1", None)
    assert any(entry["title"] == "Formato carta" for entry in result["memories"])
    assert result["since_ts"] == 0
