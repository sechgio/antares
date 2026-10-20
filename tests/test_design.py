from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from backend.core.design import models
from backend.core.design.memory import MAX_NOTES, DesignMemory, default_memory, normalize_memory, render_block
from backend.core.design.models import create_empty_document, normalize_document
from backend.core.design.prompt import SYSTEM_PROMPT, tool_spec
from backend.core.design.qa import check_layout_monotony, contrast_ratio, run_preflight
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
    assert doc["theme"]["accent"] == "#2563EB"
    assert doc["theme"]["background"] == "#ABC"
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

def test_contrast_ratio_matches_wcag_reference_values() -> None:
    assert contrast_ratio("#000000", "#FFFFFF") == pytest.approx(21.0, abs=0.01)
    assert contrast_ratio("#FFFFFF", "#FFFFFF") == pytest.approx(1.0, abs=0.01)
    assert contrast_ratio("#767676", "#FFFFFF") == pytest.approx(4.54, abs=0.01)
    assert contrast_ratio("#000", "#FFF") == pytest.approx(21.0, abs=0.01)


def test_preflight_passes_a_healthy_deck() -> None:
    report = run_preflight(
        normalize_document(
            {
                "name": "Sano",
                "page": {"preset": "16x9"},
                "theme": {"background": "#FFFFFF", "text": "#111827", "muted": "#6B7280", "accent": "#2563EB"},
                "slides": [
                    {"layout": "title", "title": "Plan Q3", "subtitle": "Resumen"},
                    {"layout": "bullets", "title": "Cifras", "bullets": ["Ingresos +12%", "Margen 41%"]},
                ],
            }
        )
    )
    assert report["ok"] is True
    assert report["errorCount"] == 0
    assert report["slideCount"] == 2


def test_preflight_flags_low_contrast_with_the_real_ratio() -> None:
    report = run_preflight(
        normalize_document(
            {
                "page": {"preset": "16x9"},
                "theme": {"background": "#FFFFFF", "text": "#BBBBBB", "muted": "#BBBBBB", "accent": "#BBBBBB"},
                "slides": [{"layout": "title", "title": "Poco legible"}],
            }
        )
    )
    assert report["ok"] is False
    contrast = [f for f in report["findings"] if f["kind"] == "contrast"]
    assert len(contrast) == 3
    assert all(f["slide"] == 0 for f in contrast)
    assert "1.9:1" in contrast[0]["message"]


def test_preflight_flags_text_overflowing_the_safe_area() -> None:
    report = run_preflight(
        normalize_document(
            {
                "page": {"preset": "16x9"},
                "slides": [{"layout": "bullets", "title": "T", "bullets": [("palabra " * 120)] * 8}],
            }
        )
    )
    assert report["ok"] is False
    assert any(f["kind"] == "overflow" for f in report["findings"])


def test_preflight_flags_an_empty_slide() -> None:
    report = run_preflight(
        normalize_document({"page": {"preset": "a4"}, "slides": [{"layout": "blank", "body": ""}]})
    )
    assert any(f["kind"] == "empty-slide" for f in report["findings"])


def test_render_block_is_empty_without_notes() -> None:
    assert render_block(default_memory()) == ""


def test_render_block_passes_notes_through_as_plain_prompt_text() -> None:
    block = render_block({"notes": [{"id": "1", "text": "odio los degradados & el azul"}]})
    assert "- odio los degradados & el azul" in block
    assert "&amp;" not in block
    assert "<" not in block
    assert "para todas sus presentaciones" in block


def test_normalize_memory_drops_blanks_duplicates_and_oversized() -> None:
    raw = {
        "notes": [
            {"text": "  vale  "},
            {"text": "   "},
            {"text": "x" * 5000},
            "no soy un dict",
            {"text": "vale"},
        ]
    }
    memory = normalize_memory(raw)
    assert [n["text"] for n in memory["notes"]] == ["vale", "x" * 600]


def test_memory_add_is_idempotent_case_insensitive(tmp_path):
    memory = DesignMemory(tmp_path / "memory.json")
    first = memory.add("Paletas claras")
    assert len(first["notes"]) == 1
    again = memory.add("paletas   CLARAS")
    assert len(again["notes"]) == 1
    assert memory.load()["notes"][0]["text"] == "Paletas claras"


def test_memory_update_delete_and_clear(tmp_path):
    memory = DesignMemory(tmp_path / "memory.json")
    added = memory.add("Español formal")
    note_id = added["notes"][0]["id"]

    memory.update(note_id, "Español formal, sin jerga")
    assert memory.load()["notes"][0]["text"] == "Español formal, sin jerga"

    memory.delete(note_id)
    assert memory.load()["notes"] == []

    memory.add("Otra cosa")
    assert len(memory.clear()["notes"]) == 0


def test_memory_rejects_missing_ids(tmp_path):
    memory = DesignMemory(tmp_path / "memory.json")
    for call in (lambda: memory.update("nope", "x"), lambda: memory.delete("nope")):
        with pytest.raises(LookupError):
            call()


def test_memory_survives_corrupt_file(tmp_path):
    path = tmp_path / "memory.json"
    path.write_text("{roto", encoding="utf-8")
    assert DesignMemory(path).load() == default_memory()


def test_memory_caps_notes(tmp_path):
    memory = DesignMemory(tmp_path / "memory.json")
    for index in range(MAX_NOTES + 12):
        memory.add(f"nota {index}")
    assert len(memory.load()["notes"]) == MAX_NOTES


def test_memory_handlers_roundtrip(tmp_path, monkeypatch):
    import backend.handlers.design as handlers

    monkeypatch.setattr(handlers, "get_design_memory", lambda: DesignMemory(tmp_path / "m.json"))
    handlers.design_memory_add({"text": "Nada de emojis"})
    stored = handlers.design_memory_get({})["memory"]
    assert stored["notes"][0]["text"] == "Nada de emojis"

    note_id = stored["notes"][0]["id"]
    handlers.design_memory_update({"id": note_id, "text": "Nada de emojis ni iconos"})
    assert handlers.design_memory_get({})["memory"]["notes"][0]["text"] == "Nada de emojis ni iconos"

    handlers.design_memory_delete({"id": note_id})
    assert handlers.design_memory_get({})["memory"]["notes"] == []
    handlers.design_memory_add({"text": "x"})
    handlers.design_memory_clear({})
    assert handlers.design_memory_get({})["memory"]["notes"] == []


def test_memory_handler_rejects_unknown_note(tmp_path, monkeypatch):
    import backend.handlers.design as handlers

    monkeypatch.setattr(handlers, "get_design_memory", lambda: DesignMemory(tmp_path / "m.json"))
    with pytest.raises(Exception) as excinfo:
        handlers.design_memory_delete({"id": "nope"})
    assert "No existe" in str(excinfo.value)


def test_review_turn_returns_empty_without_critique(monkeypatch):
    import backend.core.design.generate as generate_module

    monkeypatch.setattr(
        generate_module.agent_chat, "chat", lambda *a, **k: {"text": "SIN_OBSERVACIONES", "calls": []}
    )
    document = normalize_document({"page": {"preset": "16x9"}, "slides": [{"layout": "title", "title": "P"}]})
    assert generate_module._review_turn("openai", "gpt-4o", document, "system") == ""


def test_review_turn_survives_a_provider_without_vision(monkeypatch):
    import backend.core.design.generate as generate_module

    def boom(*args, **kwargs):
        raise ValueError("este modelo no acepta imágenes")

    monkeypatch.setattr(generate_module.agent_chat, "chat", boom)
    document = normalize_document({"page": {"preset": "16x9"}, "slides": [{"layout": "title", "title": "P"}]})
    assert generate_module._review_turn("ollama", "llava", document, "system") == ""


def test_review_turn_returns_the_critique_when_there_are_defects(monkeypatch):
    import backend.core.design.generate as generate_module

    monkeypatch.setattr(
        generate_module.agent_chat,
        "chat",
        lambda *a, **k: {"text": "3: el título se sale por la derecha\n5: contraste bajo", "calls": []},
    )
    document = normalize_document({"page": {"preset": "16x9"}, "slides": [{"layout": "title", "title": "P"}]})
    critique = generate_module._review_turn("openai", "gpt-4o", document, "system")
    assert "el título se sale" in critique


def test_slide_images_rasterizes_every_page(tmp_path):
    import backend.core.design.generate as generate_module

    document = normalize_document(
        {
            "page": {"preset": "16x9"},
            "slides": [{"layout": "title", "title": f"Diapositiva {n}"} for n in range(3)],
        }
    )
    from backend.core.design.render import render_html
    from backend.utils.pdf_html import write_pdf_sanitized

    images = generate_module._slide_images(write_pdf_sanitized(render_html(document)), 8)
    assert len(images) == 3
    assert all(img["media_type"] == "image/png" for img in images)
    assert all(img["data_b64"] for img in images)
    assert images[0]["data_b64"].startswith("iVBORw0KGgo")  # firma PNG


def test_slide_images_respects_the_cap():
    import backend.core.design.generate as generate_module
    from backend.core.design.render import render_html
    from backend.utils.pdf_html import write_pdf_sanitized

    document = normalize_document(
        {"page": {"preset": "16x9"}, "slides": [{"layout": "title", "title": f"S{n}"} for n in range(6)]}
    )
    images = generate_module._slide_images(write_pdf_sanitized(render_html(document)), 3)
    assert len(images) == 3

def test_render_hides_notes_by_default_and_shows_them_on_demand() -> None:
    document = normalize_document(
        {
            "page": {"preset": "16x9"},
            "slides": [{"layout": "title", "title": "P", "notes": "Abrir con la anécdota del cliente."}],
        }
    )
    assert 'class="notes"' not in render_html(document)
    with_notes = render_html(document, notes=True)
    assert "Abrir con la anécdota del cliente." in with_notes
    assert 'class="notes-on"' in with_notes


def test_render_escapes_notes() -> None:
    document = normalize_document({"slides": [{"layout": "title", "notes": "<script>x</script>"}]})
    html = render_html(document, notes=True)
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_consecutive_run_lengths_groups_repeats() -> None:
    runs = check_layout_monotony({"slides": [{"layout": "bullets"}] * 4 + [{"layout": "title"}]})
    assert len(runs) == 1
    assert runs[0]["detail"]["runLength"] == 4
    assert runs[0]["slide"] == 1


def test_layout_monotony_ignores_alternating_layouts() -> None:
    document = {
        "slides": [
            {"layout": "title"},
            {"layout": "bullets"},
            {"layout": "stat"},
            {"layout": "quote"},
            {"layout": "twoColumn"},
        ]
    }
    assert check_layout_monotony(document) == []


def test_preflight_reports_monotony_as_warning_not_error() -> None:
    report = run_preflight(
        normalize_document(
            {"page": {"preset": "16x9"}, "slides": [{"layout": "bullets", "title": "t"}] * 4}
        )
    )
    kinds = {f["kind"] for f in report["findings"]}
    assert "layout-monotony" in kinds
    assert all(f["severity"] == "warning" for f in report["findings"] if f["kind"] == "layout-monotony")


def test_export_pdf_with_notes_adds_pages(tmp_path, monkeypatch):
    store = DesignStore(tmp_path)
    monkeypatch.setattr(design_handlers, "get_design_store", lambda: store)
    created = store.create_empty()
    created["slides"] = [
        {"id": "s1", "layout": "title", "title": "Portada", "subtitle": "", "body": "", "bullets": [],
         "left": [], "right": [], "statValue": "", "statLabel": "", "quoteText": "", "quoteAuthor": "",
         "notes": "Nota para el ponente."}
    ]
    saved = store.save_document(created)
    target = tmp_path / "con-notas.pdf"
    result = design_handlers.design_export_pdf(
        {"document": saved, "output_path": str(target), "notes": True}
    )
    assert Path(result["saved_path"]).is_file()
    import fitz

    with fitz.open(str(target)) as pdf:
        assert "Nota para el ponente." in "".join(p.get_text() for p in pdf)
