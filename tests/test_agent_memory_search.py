import sqlite3
from datetime import date, timedelta

import pytest

from backend.core.agent import agent, memory, memory_index

VERSIONS = {"document_generate": "v1"}


@pytest.fixture()
def store(tmp_path, monkeypatch):
    instance = agent.AgentStore(tmp_path)
    monkeypatch.setattr(agent, "get_agent_store", lambda: instance)
    monkeypatch.setattr(memory, "_stores", {})
    monkeypatch.delenv("ANTARES_MEMORY_EMBEDDINGS", raising=False)
    monkeypatch.setattr(memory_index, "_embedder", None)
    return instance


def _ids(results):
    return [item["id"] for item in results]


def _indexed(tmp_path):
    with sqlite3.connect(tmp_path / "memory_index.sqlite") as conn:
        return {row[0] for row in conn.execute("SELECT id FROM memory_fts")}


def test_search_tolerates_accents_plurals_prefixes_and_highlights(store):
    mem = memory.memory_for(store)
    billing = mem.remember("s1", {"kind": "fact", "title": "Facturación electrónica",
                                  "content": "El RUC se valida antes de emitir"})
    report = mem.remember("s1", {"kind": "fact", "title": "Reporte mensual", "content": "Se envía el día 5"})
    assert _ids(mem.search("facturacion", session_id="s1")) == [billing["id"]]
    assert _ids(mem.search("FACTURAS", session_id="s1")) == [billing["id"]]
    assert _ids(mem.search("reportes", session_id="s1")) == [report["id"]]
    assert _ids(mem.search("electr", session_id="s1")) == [billing["id"]]
    found = mem.search("facturación", session_id="s1")[0]
    assert "**Facturación**" in found["snippet"]


def test_phrase_and_kind_weights_order_results(store):
    mem = memory.memory_for(store)
    old = date.today() - timedelta(days=3)
    journal = mem.remember("s1", {"kind": "journal", "title": "Informe mensual de cortes",
                                  "content": "Se revisó el informe mensual", "date": old.isoformat()})
    scattered = mem.remember("s1", {"kind": "fact", "title": "Cortes", "content": "El informe va con anexo mensual"})
    phrase = mem.remember("s1", {"kind": "fact", "title": "Informe mensual", "content": "Plantilla de cortes A4"})
    pref = mem.remember("s1", {"kind": "preference", "title": "Viñetas", "content": "Sin relación"})
    results = _ids(mem.search("informe mensual", session_id="s1"))
    assert results[0] == phrase["id"]
    assert results.index(scattered["id"]) < results.index(journal["id"])
    assert pref["id"] not in results


def test_index_follows_edit_expiry_delete_and_supersede(store, tmp_path):
    mem = memory.memory_for(store)
    fact = mem.remember("s1", {"kind": "fact", "title": "Proveedor", "content": "Papelera Andina"})
    gone = mem.remember("s1", {"kind": "fact", "title": "Temporal", "content": "Clave de obra caducable"})
    old = mem.remember("s1", {"kind": "fact", "title": "Precio", "content": "Tarifa vieja"})
    assert _indexed(tmp_path) == {fact["id"], gone["id"], old["id"]}
    mem.update(fact["id"], {"action": "edit", "content": "Imprenta Sol"})
    assert mem.search("andina", session_id="s1") == []
    assert _ids(mem.search("imprenta", session_id="s1")) == [fact["id"]]
    mem._items[gone["id"]]["expires_at"] = 1
    assert mem.search("caducable", session_id="s1") == []
    assert gone["id"] not in _indexed(tmp_path)
    new = mem.remember("s1", {"kind": "fact", "title": "Precio nuevo", "content": "Tarifa actual",
                              "supersedes": old["id"]})
    assert _ids(mem.search("tarifa", session_id="s1")) == [new["id"]]
    mem.delete(fact["id"])
    assert fact["id"] not in _indexed(tmp_path)
    assert _indexed(tmp_path) == {new["id"]}


def test_migration_rebuilds_the_index_from_memory_json(store, tmp_path):
    mem = memory.memory_for(store)
    fact = mem.remember("s1", {"kind": "fact", "title": "Sucursal", "content": "Arequipa"})
    with sqlite3.connect(tmp_path / "memory_index.sqlite") as conn:
        conn.execute("DELETE FROM memory_fts")
        conn.execute("PRAGMA user_version = 0")
    reloaded = memory.MemoryStore(tmp_path)
    assert _ids(reloaded.search("arequipa", session_id="s1")) == [fact["id"]]
    assert _indexed(tmp_path) == {fact["id"]}
    with sqlite3.connect(tmp_path / "memory_index.sqlite") as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == memory_index.SCHEMA_VERSION
        conn.execute("DELETE FROM memory_fts")
    assert reloaded.rebuild_index() and _indexed(tmp_path) == {fact["id"]}


def test_falls_back_to_word_search_without_fts5(store, monkeypatch):
    monkeypatch.setattr(memory_index, "SCHEMA", memory_index.SCHEMA.replace("fts5(", "fts_missing("))
    mem = memory.memory_for(store)
    report = mem.remember("s1", {"kind": "fact", "title": "Reporte mensual", "content": "Se envía el día 5"})
    found = mem.search("reporte", session_id="s1")
    assert _ids(found) == [report["id"]] and "snippet" not in found[0]
    assert mem.search("reportes", session_id="s1") == []
    assert report["id"] in mem.context("s1", "reporte mensual", VERSIONS)["items"]


def test_context_uses_the_ranking_within_limits(store):
    mem = memory.memory_for(store)
    report = mem.remember("s1", {"kind": "fact", "title": "Reporte mensual", "content": "Se envía el día 5"})
    pref = mem.remember("s1", {"kind": "preference", "title": "Tono", "content": "Formal"})
    unrelated = mem.remember("s1", {"kind": "fact", "title": "Sucursal", "content": "Arequipa"})
    context = mem.context("s1", "prepara los reportes", VERSIONS)
    assert context["items"] == [report["id"], pref["id"]] and unrelated["id"] not in context["items"]
    for n in range(20):
        mem.remember("s1", {"kind": "fact", "title": f"Reporte {n}", "content": "x" * 900})
    crowded = mem.context("s1", "reportes", VERSIONS)
    assert len(crowded["items"]) <= memory.CONTEXT_ITEMS
    assert len(crowded["context"]) <= memory.CONTEXT_CHARS + 400


def test_optional_embeddings_fuse_semantic_matches(store, monkeypatch):
    mem = memory.memory_for(store)
    car = mem.remember("s1", {"kind": "fact", "title": "Vehículo de reparto", "content": "Placa ABC-123"})
    mem.remember("s1", {"kind": "fact", "title": "Sucursal", "content": "Arequipa"})

    def embed(texts):
        return [[1.0, 0.0] if ("auto" in t or "Vehículo" in t) else [0.0, 1.0] for t in texts]

    memory_index.set_embedder(embed)
    assert mem.search("auto", session_id="s1") == []
    monkeypatch.setenv("ANTARES_MEMORY_EMBEDDINGS", "1")
    assert _ids(mem.search("auto", session_id="s1")) == [car["id"]]

    def broken(texts):
        raise OSError("sin red")

    memory_index.set_embedder(broken)
    assert _ids(mem.search("vehiculo", session_id="s1")) == [car["id"]]


def test_share_confirmed_memory_to_selected_profiles_and_revoke_after_restart(store):
    mem = memory.memory_for(store)
    mem.context("owner", "", VERSIONS, profile_id="source")
    item = mem.remember("owner", {"kind": "fact", "title": "Unidades", "content": "Presentar en metros"})
    with pytest.raises(ValueError, match="Confirma"):
        mem.share(item["id"], item["version"], ["recipient"])
    mem.update(item["id"], {"action": "confirm"})
    saved = mem.share(item["id"], item["version"], ["recipient"])
    assert saved["shared_with_profiles"] == ["recipient"]
    revision = mem.revision
    assert mem.share(item["id"], item["version"], ["recipient"]) == saved
    assert mem.revision == revision

    reopened = memory.MemoryStore(store.base_dir)
    assert "Presentar en metros" in reopened.context("dest", "Unidades", VERSIONS, profile_id="recipient")["context"]
    assert reopened.context("other", "Unidades", VERSIONS, profile_id="other")["context"] == ""
    assert reopened.context("own", "Unidades", VERSIONS, profile_id="recipient", memory_scope="own")["context"] == ""
    found = reopened.search("Unidades", session_id="dest")[0]
    assert found["content"] == "Presentar en metros"
    assert "source" not in found and "versions" not in found
    assert reopened.explain(item["id"], session_id="dest")["explanation"] == {"why": "El usuario compartió este recuerdo."}
    with pytest.raises(ValueError, match="ya no existe"):
        reopened.remember("dest", {"kind": "fact", "title": "Unidades", "content": "Cambio", "supersedes": item["id"]})
    reopened.share(item["id"], item["version"], [])
    assert reopened.search("Unidades", session_id="dest") == []
    reopened.share(item["id"], item["version"], ["recipient"])
    revised = reopened.update(item["id"], {"action": "edit", "content": "Presentar en kilómetros"})
    assert "shared_with_profiles" not in revised
    assert reopened.search("Unidades", session_id="dest") == []
    with pytest.raises(ValueError, match="cambió"):
        reopened.share(item["id"], item["version"], ["recipient"])
