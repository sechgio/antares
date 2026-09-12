from __future__ import annotations

import os
from pathlib import Path

import pytest
from PIL import Image
from pypdf import PdfReader, PdfWriter

import backend.core.ubicaciones as core_ub
import backend.handlers.ubicaciones as hub
from backend.core.ubicaciones import (
    _MAX_CONSOLIDATED_PAGE_BYTES,
    _REF_LAYOUT,
    _cap_fetch_size,
    _clear_ubicaciones_caches,
    _compose_ubicacion_image,
    _dimensions_for,
    _get_cached_map_screenshot,
    _map_capture_size,
    _parse_combined_coord_value,
    _redact_url_for_log,
    _resolve_api_key,
    _resolve_provider,
    _unique_pdf_filename,
    _write_consolidated_pdf,
    append_page_to_writer,
    build_consolidated_pdf,
    close_consolidated_writer,
    create_consolidated_writer,
    fetch_static_map,
)
from backend.core.ubicaciones import cache as u_cache
from backend.core.ubicaciones import client as u_client
from backend.core.ubicaciones import composer as u_composer
from backend.core.ubicaciones import consolidator as u_consolidator


def _create_dummy_pdf(path: str) -> None:
    img = Image.new("RGB", (100, 100), (200, 50, 50))
    img.save(path, "PDF")
    img.close()


def test_client_redact_url() -> None:
    url = "https://example.com/map?key=secret123&token=tok456&access_token=acc789&apikey=api000&foo=bar"
    redacted = _redact_url_for_log(url)
    assert "secret123" not in redacted
    assert "tok456" not in redacted
    assert "acc789" not in redacted
    assert "api000" not in redacted
    assert "foo=bar" in redacted


def test_client_provider_resolution() -> None:
    assert _resolve_provider(None) == "osm"
    assert _resolve_provider({"provider": "MAPBOX"}) == "mapbox"
    assert _resolve_api_key({"api_key": "my_key"}) == "my_key"


def test_client_cap_fetch_size() -> None:
    w, h = _cap_fetch_size(2000, 1000)
    assert max(w, h) == 1024
    assert w == 1024
    assert h == 512


def test_client_parse_combined_coord_value() -> None:
    lat, lon = _parse_combined_coord_value("-12.046374, -77.042793")
    assert lat == pytest.approx(-12.046374)
    assert lon == pytest.approx(-77.042793)

    assert _parse_combined_coord_value(None) == (None, None)
    assert _parse_combined_coord_value("") == (None, None)
    assert _parse_combined_coord_value("invalid") == (None, None)


def test_composer_layout_and_dimensions() -> None:
    w, h, f = _dimensions_for("vertical", preview=False)
    assert w == _REF_LAYOUT["vertical"]["out_w"]
    assert h == _REF_LAYOUT["vertical"]["out_h"]
    assert f == _REF_LAYOUT["vertical"]["footer_h"]

    cap_w, cap_h = _map_capture_size("horizontal", preview=False)
    assert cap_w == _REF_LAYOUT["horizontal"]["out_w"]
    assert cap_h == _REF_LAYOUT["horizontal"]["out_h"] - _REF_LAYOUT["horizontal"]["footer_h"]


def test_composer_unique_pdf_filename() -> None:
    used: dict[str, int] = {}
    f1 = _unique_pdf_filename("COD/01", used)
    f2 = _unique_pdf_filename("COD/01", used)
    f3 = _unique_pdf_filename("COD/01", used)
    assert f1 == "COD_01.pdf"
    assert f2 == "COD_01_2.pdf"
    assert f3 == "COD_01_3.pdf"


def test_cache_clear_empties_all() -> None:
    _clear_ubicaciones_caches()
    assert len(u_cache._map_screenshot_store) == 0
    assert len(u_cache._font_cache) == 0
    assert len(u_cache._footer_cache) == 0
    assert len(u_cache._excel_cache) == 0
    assert len(u_cache._preview_composed_cache) == 0


def test_consolidator_build_consolidated_pdf(tmp_path: Path) -> None:
    p1 = str(tmp_path / "page_1.pdf")
    p2 = str(tmp_path / "page_2.pdf")
    p3 = str(tmp_path / "page_3.pdf")
    _create_dummy_pdf(p1)
    _create_dummy_pdf(p2)
    _create_dummy_pdf(p3)

    out_pdf = build_consolidated_pdf([p1, p2, p3], str(tmp_path))
    assert os.path.isfile(out_pdf)
    reader = PdfReader(out_pdf)
    assert len(reader.pages) == 3
    assert not os.path.exists(p1)
    assert not os.path.exists(p2)
    assert not os.path.exists(p3)


def test_consolidator_empty_list_raises(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="No hay imágenes"):
        build_consolidated_pdf([], str(tmp_path))


def test_consolidator_append_page_size_exceeded(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    p = str(tmp_path / "page.pdf")
    _create_dummy_pdf(p)
    writer = PdfWriter()
    monkeypatch.setattr(u_consolidator, "_MAX_CONSOLIDATED_PAGE_BYTES", 1)
    with pytest.raises(OSError, match="excede el límite"):
        append_page_to_writer(writer, p)


def test_consolidator_writer_lifecycle(tmp_path: Path) -> None:
    writer = create_consolidated_writer()
    assert writer is not None
    p1 = str(tmp_path / "p1.pdf")
    _create_dummy_pdf(p1)
    append_page_to_writer(writer, p1)
    out_dir = str(tmp_path / "out")
    os.makedirs(out_dir, exist_ok=True)
    out_path = u_consolidator._save_consolidated_writer(writer, out_dir)
    assert os.path.isfile(out_path)
    close_consolidated_writer(writer)


def test_generar_ubicaciones_closes_writer_when_all_pages_fail(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class TrackingWriter:
        def __init__(self) -> None:
            self.closed = False

        def close(self) -> None:
            self.closed = True

    writer = TrackingWriter()
    monkeypatch.setattr(hub, "create_consolidated_writer", lambda: writer)

    def fail_render(*args: object, **kwargs: object) -> None:
        raise RuntimeError("render failure")

    monkeypatch.setattr(hub, "generar_imagen_ubicacion", fail_render)
    result = hub.handle_generar_ubicaciones(
        {
            "manualData": {"cod_componente": "TEST-001", "lat": -12.0, "lon": -77.0},
            "outputDir": str(tmp_path),
            "consolidado": True,
        }
    )

    assert result["generados"] == 0
    assert result["fallidos"] == 1
    assert writer.closed


def test_consolidator_unsupported_writer_raises(tmp_path: Path) -> None:
    p = str(tmp_path / "page.pdf")
    _create_dummy_pdf(p)
    with pytest.raises(TypeError, match="Tipo de escritor de PDF no soportado"):
        append_page_to_writer("not-a-writer", p)


def test_write_consolidated_pdf_custom_stem(tmp_path: Path) -> None:
    tmp_file = str(tmp_path / "temp.pdf")
    base_file = str(tmp_path / "mi_reporte.pdf")
    _create_dummy_pdf(tmp_file)

    saved = _write_consolidated_pdf(tmp_file, base_file)
    assert saved == base_file
    assert os.path.isfile(base_file)
    assert not os.path.exists(tmp_file)


def test_write_consolidated_pdf_locked_fallback(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    tmp_file = str(tmp_path / "temp.pdf")
    base_file = str(tmp_path / "mi_reporte.pdf")
    _create_dummy_pdf(tmp_file)

    attempts: list[str] = []
    real_replace = os.replace

    def mock_replace(src: str, dst: str) -> None:
        attempts.append(dst)
        if len(attempts) < 3:
            raise PermissionError(13, "Permission denied", dst)
        real_replace(src, dst)

    monkeypatch.setattr(os, "replace", mock_replace)
    saved = _write_consolidated_pdf(tmp_file, base_file)
    assert saved == str(tmp_path / "ubicaciones_consolidado_3.pdf")
    assert os.path.isfile(saved)


def test_write_consolidated_pdf_all_locked_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    tmp_file = str(tmp_path / "temp.pdf")
    base_file = str(tmp_path / "doc.pdf")
    _create_dummy_pdf(tmp_file)

    def always_denied(src: str, dst: str) -> None:
        raise PermissionError(13, "Permission denied", dst)

    monkeypatch.setattr(os, "replace", always_denied)
    with pytest.raises(PermissionError, match="Cierra el archivo"):
        _write_consolidated_pdf(tmp_file, base_file)
    assert not os.path.exists(tmp_file)


def test_module_exports_consistency() -> None:
    assert _MAX_CONSOLIDATED_PAGE_BYTES == 64 * 1024 * 1024
    for mod in (u_client, u_cache, u_composer, u_consolidator):
        assert mod is not None
    assert hub.HANDLERS["generar_ubicaciones"] is hub.handle_generar_ubicaciones
    assert hub.HANDLERS["preview_ubicacion"] is hub.handle_preview_ubicacion
    assert core_ub.fetch_static_map is u_client.fetch_static_map
    assert core_ub.create_consolidated_writer is u_consolidator.create_consolidated_writer


def test_handler_keeps_legacy_test_surface() -> None:
    assert callable(hub._http_get)
    assert callable(hub._resolve_provider)
    assert callable(hub._encode_preview_data)
    assert callable(hub._merge_consolidated_pdfs)
    assert hub._excel_cache is u_cache._excel_cache
    assert hub._preview_composed_cache is u_cache._preview_composed_cache
    assert hub.urllib is not None
    assert hub.create_consolidated_writer is u_consolidator.create_consolidated_writer


def test_compose_and_screenshot(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(u_client, "_http_get", lambda *a, **k: None)
    fallback = fetch_static_map(-12.0, -77.0, 100, 100)
    assert fallback is not None
    img = _compose_ubicacion_image(
        {"cod_componente": "TEST", "direccion": "D", "localidad": "L", "distrito": "DI"},
        "vertical",
        fallback,
        preview=True,
    )
    dim = _dimensions_for("vertical", preview=True)
    assert img.size == (dim[0], dim[1])
    shot = _get_cached_map_screenshot(-12.0, -77.0, "vertical", preview=True)
    assert shot is not None


def test_generar_ubicaciones_empty_coords_raises_clean_value_error(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="No hay filas con coordenadas validas"):
        hub.handle_generar_ubicaciones({
            "outputDir": str(tmp_path),
            "manualData": {"cod_componente": "COD1", "lat": "invalid", "lon": "invalid"},
        })
