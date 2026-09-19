from __future__ import annotations

import base64
import io
import json
from typing import Any

import pytest
from pypdf import PdfWriter

from backend.core import formatos


def _entry(fmt_id: str = "upload-x", **overrides: Any) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "id": fmt_id,
        "nombre": "Fmt",
        "origen": "uploaded",
        "storage_path": "file.pdf",
        "enabled": True,
        "persisted": False,
        "strategy": formatos.SIMPLE_OVERLAY,
        "mapping": None,
        "filename_pattern": "{id}_{desde}.pdf",
        "max_pages": 500,
        "number_min": 1,
        "number_max": 9999999,
        "has_mapping": False,
    }
    entry.update(overrides)
    return entry


def _minimal_pdf(pages: int = 1) -> bytes:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=210, height=297)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


@pytest.fixture
def catalog_env(monkeypatch, tmp_path):
    monkeypatch.setattr(formatos, "_CATALOG_PATH", tmp_path / "catalog.json")
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setattr(formatos, "_UPLOADS_DIR", uploads)
    monkeypatch.setattr(formatos, "_BUILTIN_DIR", tmp_path / "builtin")
    monkeypatch.setattr(formatos, "_DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(formatos, "_formats", {})
    return tmp_path


def test_list_formats_filters_disabled_and_sets_has_mapping(catalog_env) -> None:
    formatos._formats.update(
        {
            "a": _entry("a", mapping={"x": 1}),
            "b": _entry("b", enabled=False),
            "c": _entry("c"),
        }
    )
    listed = {f["id"]: f for f in formatos.list_formats()}
    assert set(listed) == {"a", "c"}
    assert listed["a"]["has_mapping"] is True
    assert listed["c"]["has_mapping"] is False


def test_get_format_returns_copy_or_none(catalog_env) -> None:
    formatos._formats["a"] = _entry("a", mapping={"x": 1})
    got = formatos.get_format("a")
    assert got is not None and got["has_mapping"] is True
    got["mapping"] = None
    assert formatos._formats["a"]["mapping"] == {"x": 1}
    assert formatos.get_format("nope") is None


def test_resolve_path_rejects_traversal_in_uploaded(catalog_env) -> None:
    with pytest.raises(ValueError, match="fuera de directorio"):
        formatos._resolve_path(_entry(storage_path="../evil.pdf"))


def test_resolve_path_prefers_builtin_then_data_dir(catalog_env, tmp_path) -> None:
    builtin_dir = formatos._BUILTIN_DIR
    builtin_dir.mkdir()
    (builtin_dir / "t.b64").write_text("eQ==", encoding="ascii")
    fmt = _entry(origen="builtin", storage_path="t.b64")
    assert formatos._resolve_path(fmt) == builtin_dir / "t.b64"

    fmt2 = _entry(origen="builtin", storage_path="missing.b64")
    assert formatos._resolve_path(fmt2) == formatos._DATA_DIR / "missing.b64"


def test_load_template_bytes_modes(catalog_env) -> None:
    with pytest.raises(FileNotFoundError):
        formatos._load_template_bytes(_entry(storage_path="nope.pdf"))

    uploaded = formatos._UPLOADS_DIR / "raw.pdf"
    uploaded.write_bytes(b"RAW")
    assert formatos._load_template_bytes(_entry(storage_path="raw.pdf")) == b"RAW"

    builtin_dir = formatos._BUILTIN_DIR
    builtin_dir.mkdir()
    (builtin_dir / "enc.b64").write_text(base64.b64encode(b"DECODED").decode(), encoding="ascii")
    builtin = _entry(origen="builtin", storage_path="enc.b64")
    assert formatos._load_template_bytes(builtin) == b"DECODED"


def test_get_template_pdf_unknown_and_ok(catalog_env) -> None:
    with pytest.raises(ValueError, match="no encontrado"):
        formatos.get_template_pdf("nope")
    (formatos._UPLOADS_DIR / "t.pdf").write_bytes(b"P")
    formatos._formats["a"] = _entry("a", nombre="MiFmt", storage_path="t.pdf")
    data, nombre = formatos.get_template_pdf("a")
    assert data == b"P" and nombre == "MiFmt"


def test_update_mapping_promotes_to_visual_overlay(catalog_env) -> None:
    assert formatos.update_mapping("nope", {}) is None
    formatos._formats["a"] = _entry("a")
    updated = formatos.update_mapping("a", {"page": 0})
    assert updated["strategy"] == formatos.VISUAL_OVERLAY
    assert updated["has_mapping"] is True


def test_load_catalog_tolerates_corrupt_json_and_backfills(catalog_env, tmp_path) -> None:
    catalog = tmp_path / "catalog.json"
    catalog.write_text("{corrupt", encoding="utf-8")
    formatos._load_catalog()
    assert "formato1" in formatos._formats or len(formatos._formats) >= 1  # builtins cargados

    without_flag = _entry("up1")
    del without_flag["has_mapping"]
    catalog.write_text(json.dumps([without_flag]), encoding="utf-8")
    formatos._load_catalog()
    assert formatos._formats["up1"]["has_mapping"] is False


def test_load_catalog_downgrades_visual_overlay_without_mapping(catalog_env, tmp_path) -> None:
    catalog = tmp_path / "catalog.json"
    catalog.write_text(
        json.dumps([_entry("up2", strategy=formatos.VISUAL_OVERLAY, mapping=None)]),
        encoding="utf-8",
    )
    formatos._load_catalog()
    assert formatos._formats["up2"]["strategy"] == formatos.SIMPLE_OVERLAY


def test_load_catalog_keeps_deleted_builtin_disabled(catalog_env, tmp_path) -> None:
    builtin_id = formatos._BUILTIN_FORMATS[0]["id"]
    formatos._load_catalog()
    assert formatos.delete_format(builtin_id) is True
    assert formatos._formats[builtin_id]["enabled"] is False

    formatos._load_catalog()

    assert formatos._formats[builtin_id]["enabled"] is False
    assert builtin_id not in {f["id"] for f in formatos.list_formats()}


def test_add_uploaded_format_validates_name_size_and_pdf(catalog_env, monkeypatch) -> None:
    monkeypatch.setattr(formatos, "MAX_UPLOAD_PDF_BYTES", 10)
    with pytest.raises(ValueError, match=r"50 MB|tamaño máximo"):
        formatos.add_uploaded_format("n", "a.pdf", b"x" * 100)

    monkeypatch.setattr(formatos, "MAX_UPLOAD_PDF_BYTES", 50 * 1024 * 1024)
    with pytest.raises(ValueError, match=r"invalido|corrupto|PDF"):
        formatos.add_uploaded_format("n", "a.pdf", b"not a pdf at all")


def test_add_uploaded_format_happy_path_registers_entry(catalog_env, monkeypatch) -> None:
    entry = formatos.add_uploaded_format("Mi Formato", "doc.pdf", _minimal_pdf(), persisted=False)
    assert entry["id"].startswith("upload-")
    assert formatos._formats[entry["id"]]["origen"] == "uploaded"
    assert (formatos._UPLOADS_DIR / entry["storage_path"]).exists()
    # persisted=False → no se escribe catalog.json
    assert not formatos._CATALOG_PATH.exists()


def test_add_uploaded_format_rejects_too_many_pages(catalog_env, monkeypatch) -> None:
    monkeypatch.setattr(formatos, "MAX_UPLOAD_PDF_PAGES", 1)
    with pytest.raises(ValueError, match="páginas"):
        formatos.add_uploaded_format("n", "a.pdf", _minimal_pdf(pages=2), persisted=False)


def test_generate_pdf_validation_chain(catalog_env) -> None:
    with pytest.raises(ValueError, match="no encontrado"):
        formatos.generate_pdf("nope", 1, 1)
    formatos._formats["a"] = _entry("a")
    formatos._formats["a"]["enabled"] = False
    with pytest.raises(ValueError, match="deshabilitado"):
        formatos.generate_pdf("a", 1, 1)
    formatos._formats["a"]["enabled"] = True
    with pytest.raises(ValueError, match="desde"):
        formatos.generate_pdf("a", 5, 1)
    with pytest.raises(ValueError, match="paginas"):
        formatos.generate_pdf("a", 1, 600)
    with pytest.raises(ValueError, match="limites"):
        formatos.generate_pdf("a", 0, 1)
    formatos._formats["a"]["strategy"] = formatos.VISUAL_OVERLAY
    with pytest.raises(ValueError, match="mapping visual"):
        formatos.generate_pdf("a", 1, 1)


def test_generate_pdf_happy_path_and_filename(catalog_env, monkeypatch) -> None:
    (formatos._UPLOADS_DIR / "t.pdf").write_bytes(_minimal_pdf())
    formatos._formats["a"] = _entry("a", storage_path="t.pdf")

    calls: list[tuple[bytes, int, int]] = []

    class _Stub:
        def generate(self, template_bytes: bytes, desde: int, hasta: int, mapping: Any) -> bytes:
            calls.append((template_bytes, desde, hasta))
            return b"OUT"

    monkeypatch.setattr("backend.core.format_strategies.get_strategy", lambda name: _Stub())

    data, name = formatos.generate_pdf("a", 3, 3)
    assert data == b"OUT" and name == "a_0000003.pdf"
    assert calls[0][1:] == (3, 3)

    _data2, name2 = formatos.generate_pdf("a", 3, 5)
    assert name2 == "a_0000003-0000005.pdf"


def test_delete_format_logs_oserror_but_returns_true(catalog_env, monkeypatch) -> None:
    fmt = _entry("u1", storage_path="gone.pdf")
    (formatos._UPLOADS_DIR / "gone.pdf").write_bytes(b"x")
    formatos._formats["u1"] = fmt

    def _raise(_path: Any) -> None:
        raise OSError("locked")

    monkeypatch.setattr(formatos.os, "remove", _raise)
    assert formatos.delete_format("u1") is True
    assert "u1" not in formatos._formats
