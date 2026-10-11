from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from backend.core.design import models
from backend.core.design.models import create_empty_document, normalize_document
from backend.core.design.prompt import SYSTEM_PROMPT, tool_spec
from backend.core.design.render import render_html
from backend.core.design.store import DesignStore
from backend.handlers import design as design_handlers


def _hostile_payload() -> dict[str, Any]:
    return {
        "name": "  Informe\x00 Q3  ",
        "page": {"preset": "16x9", "widthMm": 9_000, "heightMm": -4},
        "theme": {
            "accent": "red; background-image: url(javascript:alert(1))",
            "background": "#AbC",
            "headFont": "Comic Sans MS",
        },
        "slides": [
            {"layout": "inventado", "title": "<script>alert(1)</script>"},
            {"layout": "bullets", "title": "A", "bullets": ["  uno  ", "  ", "<b>dos</b>"]},
        ],
        "clave_desconocida": {"anidado": [1, 2, 3]},
    }


def test_normalize_document_drops_unknown_keys_and_rejects_hostile_theme() -> None:
    doc = normalize_document(_hostile_payload())
    assert "clave_desconocida" not in doc
    assert doc["name"] == "Informe Q3"
    # El color no es hex: cae al valor por defecto, no llega al CSS.
    assert doc["theme"]["accent"] == "#2563EB"
    assert doc["theme"]["background"] == "#ABC"
    # La fuente está fuera de la allowlist del schema.
    assert doc["theme"]["headFont"] == "Cambria"
    assert doc["slides"][0]["layout"] == "bullets"


def test_normalize_document_bounds_page_size_and_slide_count() -> None:
    doc = normalize_document(
        {"page": {"preset": "16x9", "widthMm": 9_000, "heightMm": -4}, "slides": [{"layout": "title"}] * 200}
    )
    assert doc["page"]["widthMm"] == 2_000.0
    assert doc["page"]["heightMm"] == 20.0
    assert len(doc["slides"]) == models.MAX_SLIDES


def test_normalize_slide_trims_bullets_and_control_chars() -> None:
    slide = models.normalize_slide(
        {"layout": "bullets", "title": "T\x07", "bullets": ["  uno\tcon  tab  ", "   ", "x" * 900]}
    )
    assert slide is not None
    assert slide["title"] == "T"
    assert slide["bullets"][0] == "uno con tab"
    assert len(slide["bullets"]) == 2
    assert len(slide["bullets"][1]) == models.MAX_BULLET_CHARS


def test_empty_slide_list_falls_back_to_a_title_slide() -> None:
    doc = normalize_document({"slides": []})
    assert len(doc["slides"]) == 1
    assert doc["slides"][0]["layout"] == "title"


def test_render_html_escapes_model_text_and_rejects_css_injection() -> None:
    html = render_html(normalize_document(_hostile_payload()))
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "javascript:" not in html
    assert "Comic Sans" not in html
    assert "url(" not in html


def test_render_html_emits_one_section_per_slide_at_the_preset_size() -> None:
    doc = normalize_document(
        {
            "page": {"preset": "16x9"},
            "slides": [{"layout": "title", "title": "Portada"}, {"layout": "section", "title": "Cierre"}],
        }
    )
    html = render_html(doc)
    assert html.count("<section") == 2
    assert "size: 338.667mm 190.5mm" in html


def test_render_html_falls_back_to_the_default_layout() -> None:
    html = render_html(normalize_document({"slides": [{"layout": "secreto", "title": "X"}]}))
    assert html.count("<section") == 1


def test_tool_spec_describes_only_known_layouts_and_presets() -> None:
    spec = tool_spec()
    assert spec["name"] == "create_design"
    layouts = spec["inputSchema"]["properties"]["slides"]["items"]["properties"]["layout"]["enum"]
    assert set(layouts) <= models.LAYOUTS
    presets = spec["inputSchema"]["properties"]["page"]["properties"]["preset"]["enum"]
    assert set(presets) == set(models.PAGE_PRESETS)
    fonts = spec["inputSchema"]["properties"]["theme"]["properties"]["headFont"]["enum"]
    assert set(fonts) == models.FONTS
    assert "create_design" in SYSTEM_PROMPT


def test_store_roundtrip_lists_and_deletes(tmp_path: Path) -> None:
    store = DesignStore(tmp_path)
    created = store.create_empty("Demo")
    assert store.get_document(created["id"]) is not None
    assert [item["id"] for item in store.list_documents()] == [created["id"]]
    assert store.list_documents()[0]["slideCount"] == len(created["slides"])
    assert store.delete_document(created["id"]) is True
    assert store.get_document(created["id"]) is None
    assert store.delete_document(created["id"]) is False


def test_store_id_cannot_escape_the_documents_root(tmp_path: Path) -> None:
    store = DesignStore(tmp_path)
    document = create_empty_document()
    document["id"] = "../../escaped"
    saved = store.save_document(document)
    assert Path(saved["id"]).name == "escaped"
    assert (tmp_path / "escaped.json").is_file()
    assert not (tmp_path.parent / "escaped.json").exists()


def test_store_ignores_corrupt_files(tmp_path: Path) -> None:
    store = DesignStore(tmp_path)
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "roto.json").write_text("{no es json", encoding="utf-8")
    assert store.list_documents() == []
    assert store.get_document("roto") is None


def test_handlers_get_and_delete_raise_not_found(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(design_handlers, "get_design_store", lambda: DesignStore(tmp_path))
    with pytest.raises(Exception) as excinfo:
        design_handlers.design_get({"id": "nope"})
    assert "No existe" in str(excinfo.value)


def test_handler_render_html_uses_the_persisted_document(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = DesignStore(tmp_path)
    monkeypatch.setattr(design_handlers, "get_design_store", lambda: store)
    created = store.create_empty("Desde disco")
    result = design_handlers.design_render_html({"id": created["id"]})
    assert "Desde disco" in result["html"]
    assert result["slideCount"] == 1


def test_handler_export_pdf_writes_the_chosen_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = DesignStore(tmp_path)
    monkeypatch.setattr(design_handlers, "get_design_store", lambda: store)
    created = store.create_empty("Informe Q3")
    target = tmp_path / "salida.pdf"
    result = design_handlers.design_export_pdf({"id": created["id"], "output_path": str(target)})
    assert Path(result["saved_path"]).is_file()
    assert Path(result["saved_path"]).read_bytes().startswith(b"%PDF")
    assert result["filename"].endswith(".pdf")


def test_handler_export_pdf_returns_base64_without_output_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = DesignStore(tmp_path)
    monkeypatch.setattr(design_handlers, "get_design_store", lambda: store)
    created = store.create_empty("Informe Q3")
    result = design_handlers.design_export_pdf({"id": created["id"]})
    assert result["pdf_base64"]
    assert result["filename"] == "Informe Q3.pdf"
