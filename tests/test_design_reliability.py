from pathlib import Path
from typing import Any

import pytest

from backend.core.design import generate
from backend.core.design.memory import DesignMemory
from backend.core.design.models import normalize_document
from backend.core.design.render import render_html
from backend.core.design.store import DesignStore


def test_store_preserves_stat_and_quote_through_normalization(tmp_path: Path) -> None:
    original = normalize_document({"slides": [
        {"layout": "stat", "stat": {"value": "12", "label": "Socios"}},
        {"layout": "quote", "quote": {"text": "Buenos resultados", "author": "Ana"}},
    ]})
    store = DesignStore(tmp_path)
    saved = store.save_document(original)
    reopened = store.get_document(saved["id"])
    assert reopened is not None
    assert reopened["slides"] == original["slides"]
    html = render_html(reopened)
    assert all(text in html for text in ("12", "Socios", "Buenos resultados", "Ana"))


@pytest.mark.parametrize("repair_result", ["valid", "missing", "empty", "error"])
def test_generation_repairs_with_the_original_and_keeps_it_if_repair_fails(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, repair_result: str,
) -> None:
    monkeypatch.setattr(generate.design_memory, "get_design_memory", lambda: DesignMemory(tmp_path / "m.json"))
    images = [{"media_type": "image/png", "data_b64": "aW1n"}]
    monkeypatch.setattr(generate, "_review_turn", lambda *_: ("1: acorta el título", images))
    requests: list[list[dict[str, Any]]] = []

    def chat(_provider, _model, messages, **_kwargs):
        requests.append(messages)
        if len(requests) == 2 and repair_result == "error":
            raise ValueError("El modelo no admite herramientas con imágenes")
        if len(requests) == 2 and repair_result == "missing":
            return {"text": "No terminé", "calls": []}
        if len(requests) == 2 and repair_result == "empty":
            return {"calls": [{"name": "create_design", "params": {"slides": []}}]}
        title = "Original" if len(requests) == 1 else "Corregido"
        return {"calls": [{"name": "create_design", "params": {"slides": [{"title": title}]}}]}

    monkeypatch.setattr(generate.agent_chat, "chat", chat)
    result = generate.generate_design("openai", "Informe", "modelo", page_preset="a4")
    assert result["slides"][0]["title"] == ("Corregido" if repair_result == "valid" else "Original")
    assert result["page"]["preset"] == "a4"
    assert all("`a4`" in request[0]["content"] for request in requests)
    assert len(requests) == 2
    assert requests[1][1]["images"] == images
    assert all(text in requests[1][1]["content"] for text in ("Original", "acorta el título"))
