"""Tests para el provider de mapas estáticos (reemplazo de Playwright)."""

from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image

from backend.handlers import ubicaciones as ub


def _png_bytes(size: tuple[int, int], color: tuple[int, int, int] = (70, 130, 180)) -> bytes:
    buf = BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


class TestProviderResolution:
    def test_default_is_osm(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("ANTARES_MAP_PROVIDER", raising=False)
        assert ub._resolve_provider(None) == "osm"

    def test_env_overrides_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ANTARES_MAP_PROVIDER", "google")
        assert ub._resolve_provider(None) == "google"

    def test_payload_overrides_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ANTARES_MAP_PROVIDER", "google")
        assert ub._resolve_provider({"provider": "osm"}) == "osm"

    def test_lowercased(self) -> None:
        assert ub._resolve_provider({"provider": "GOOGLE"}) == "google"


def test_resolve_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTARES_GOOGLE_MAPS_KEY", raising=False)
    monkeypatch.delenv("ANTARES_MAPS_API_KEY", raising=False)
    assert ub._resolve_api_key(None) is None
    assert ub._resolve_api_key({"google_maps_key": "abc"}) == "abc"
    assert ub._resolve_api_key({"api_key": "xyz"}) == "xyz"
    monkeypatch.setenv("ANTARES_GOOGLE_MAPS_KEY", "envkey")
    assert ub._resolve_api_key(None) == "envkey"
    # payload wins over env
    assert ub._resolve_api_key({"api_key": "pk"}) == "pk"


class TestCapFetchSize:
    def test_no_upscale_when_under_cap(self) -> None:
        assert ub._cap_fetch_size(600, 800) == (600, 800)

    def test_caps_long_side_preserving_aspect(self) -> None:
        w, h = ub._cap_fetch_size(2480, 3386)
        assert max(w, h) <= ub._MAP_FETCH_MAX_DIM
        # aspect preserved within rounding
        assert w / h == pytest.approx(2480 / 3386, rel=0.01)

    def test_never_zero(self) -> None:
        w, h = ub._cap_fetch_size(1, 1)
        assert w >= 1 and h >= 1


def test_lonlat_to_webmercator_pixel_origin() -> None:
    # Web Mercator: (lon=-180, lat~0) maps to x=0; lat=0 maps to y = n*128.
    x, y = ub._lonlat_to_webmercator_pixel(-180.0, 0.0, 0)
    assert x == pytest.approx(0.0, abs=1e-3)
    assert y == pytest.approx(128.0, abs=1e-3)


def test_fetch_static_map_osm_returns_image(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTARES_MAP_PROVIDER", "osm")
    tile = _png_bytes((ub._OSM_TILE_SIZE, ub._OSM_TILE_SIZE), (60, 120, 160))
    monkeypatch.setattr(ub, "_http_get", lambda url, headers, timeout=ub._HTTP_TIMEOUT: tile)

    data = ub.fetch_static_map(-12.046, -77.042, 800, 600, zoom=18, provider="osm")
    img = Image.open(BytesIO(data))
    assert img.size == ub._cap_fetch_size(800, 600)
    # A real (colored) map passes the tiles heuristic.
    assert ub._screenshot_has_map_tiles(data)


def test_fetch_xyz_tiles_map_downloads_tiles_in_parallel(monkeypatch: pytest.MonkeyPatch) -> None:
    tile = _png_bytes((ub._OSM_TILE_SIZE, ub._OSM_TILE_SIZE), (60, 120, 160))
    calls: list[str] = []

    def fake_get(url: str, headers: dict[str, str], timeout: int = ub._HTTP_TIMEOUT) -> bytes:
        calls.append(url)
        return tile

    monkeypatch.setattr(ub, "_http_get", fake_get)
    img = ub._fetch_xyz_tiles_map(-12.046, -77.042, 850, 568, 18, ub._XYZ_PROVIDERS["osm"])
    assert img.size == (850, 568)
    assert len(calls) >= 2


def test_fetch_static_map_fallback_on_http_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ub, "_http_get", lambda *a, **k: None)
    data = ub.fetch_static_map(-12.0, -77.0, 800, 600, zoom=18, provider="osm")
    img = Image.open(BytesIO(data))
    fw, fh = ub._cap_fetch_size(800, 600)
    assert img.size == (fw, fh)
    # Uniform gray placeholder does NOT pass the tiles heuristic.
    assert not ub._screenshot_has_map_tiles(data)


def test_fetch_static_map_google_without_key_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    data = ub.fetch_static_map(-12.0, -77.0, 800, 600, zoom=18, provider="google", api_key=None)
    assert not ub._screenshot_has_map_tiles(data)


def test_fetch_static_map_google_with_key(monkeypatch: pytest.MonkeyPatch) -> None:
    called: dict[str, str] = {}

    def fake_get(url, headers, timeout=ub._HTTP_TIMEOUT):
        called["url"] = url
        return _png_bytes((640, 640), (90, 140, 190))

    monkeypatch.setattr(ub, "_http_get", fake_get)
    data = ub.fetch_static_map(-12.0, -77.0, 800, 600, zoom=18, provider="google", api_key="TESTKEY")
    assert "maps.googleapis.com" in called["url"]
    assert "key=TESTKEY" in called["url"]
    assert ub._screenshot_has_map_tiles(data)


def test_handle_generar_ubicaciones_skips_non_numeric_coords(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Una fila con lat/lon no numérico debe skiparse, no crashar el batch.

    El filtro histórico sólo rechazaba NaN (``pd.isna("abc")`` es False), así que
    un texto en la columna de coordenadas pasaba y luego ``float(datos['lat'])``
    levantaba ValueError dentro del worker, abortando todo el batch vía ex.map.
    """
    import openpyxl

    monkeypatch.setattr(ub, "fetch_static_map", lambda *a, **k: _png_bytes((256, 256)))

    xlsx = tmp_path / "coords.xlsx"
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["latitud", "longitud"])
    ws.append([-12.0, -77.0])   # válida
    ws.append(["abc", -77.0])   # lat no-numérica -> debe skiparse
    wb.save(xlsx)

    out_dir = tmp_path / "out"
    result = ub.handle_generar_ubicaciones({
        "excelPath": str(xlsx),
        "outputDir": str(out_dir),
        "formato": "vertical",
        "consolidado": False,
    })

    assert result["success"] is True
    assert result["data"]["generados"] == 1
    pdfs = list(out_dir.glob("*.pdf"))
    assert len(pdfs) == 1


def test_handle_generar_ubicaciones_continues_after_row_failure(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Una fila que falla al renderizar (IO, imagen corrupta, etc.) no debe
    abortar el batch: las demás filas se procesan y se reporta el conteo de
    fallidos. Antes el try/finally sin except dejaba que ex.map re-lanzara y
    el handler devolvía success:False con archivos huérfanos."""
    import openpyxl

    monkeypatch.setattr(ub, "fetch_static_map", lambda *a, **k: _png_bytes((256, 256)))

    xlsx = tmp_path / "coords.xlsx"
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["latitud", "longitud"])
    ws.append([-12.0, -77.0])   # ID-1: ok
    ws.append([-13.0, -78.0])   # ID-2: simulamos fallo de render
    wb.save(xlsx)

    real_gen = ub.generar_imagen_ubicacion

    def flaky_gen(d, out_path, formato, map_opts=None, custom_styles=None):
        if d["cod_componente"] == "ID-2":
            raise OSError("simulated render failure")
        return real_gen(d, out_path, formato, map_opts=map_opts, custom_styles=custom_styles)

    monkeypatch.setattr(ub, "generar_imagen_ubicacion", flaky_gen)

    out_dir = tmp_path / "out"
    result = ub.handle_generar_ubicaciones({
        "excelPath": str(xlsx),
        "outputDir": str(out_dir),
        "formato": "vertical",
        "consolidado": False,
    })

    assert result["success"] is True
    assert result["data"]["generados"] == 1
    assert result["data"]["fallidos"] == 1
    pdfs = [p.name for p in out_dir.glob("*.pdf")]
    assert pdfs == ["ID-1.pdf"]


def test_map_cache_key_with_zoom_and_provider() -> None:
    key_default = ub._map_cache_key(-12.0, -77.0, "vertical", preview=True)
    key_zoom15 = ub._map_cache_key(-12.0, -77.0, "vertical", preview=True, map_opts={"zoom": 15})
    key_google = ub._map_cache_key(-12.0, -77.0, "vertical", preview=True, map_opts={"provider": "google"})
    key_maptiler_a = ub._map_cache_key(
        -12.0, -77.0, "vertical", preview=True,
        map_opts={"provider": "maptiler", "zoom": 18, "api_key": "KEY-A"},
    )
    key_maptiler_b = ub._map_cache_key(
        -12.0, -77.0, "vertical", preview=True,
        map_opts={"provider": "maptiler", "zoom": 18, "api_key": "KEY-B"},
    )

    assert key_default != key_zoom15
    assert key_default != key_google
    assert key_zoom15 != key_google
    assert key_maptiler_a != key_maptiler_b

    assert key_zoom15[-3:] == ("osm", 15, "")
    assert key_google[-3:-1] == ("google", 18)


def test_parse_combined_coord_value_rejects_invalid_text() -> None:
    assert ub._parse_combined_coord_value("invalid") == (None, None)
    assert ub._parse_combined_coord_value("abc, def") == (None, None)


def test_parse_combined_coord_value_parses_numeric_pair() -> None:
    lat, lon = ub._parse_combined_coord_value("-12.0464, -77.0428")
    assert lat == pytest.approx(-12.0464)
    assert lon == pytest.approx(-77.0428)


def test_parse_combined_coord_value_parses_google_maps_url() -> None:
    url = "https://maps.google.com/?q=-12.0464,-77.0428"
    lat, lon = ub._parse_combined_coord_value(url)
    assert lat == pytest.approx(-12.0464)
    assert lon == pytest.approx(-77.0428)


def test_handle_generar_ubicaciones_rejects_all_invalid_rows(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    import openpyxl

    monkeypatch.setattr(ub, "fetch_static_map", lambda *a, **k: _png_bytes((256, 256)))

    xlsx = tmp_path / "invalid.xlsx"
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["coordenadas"])
    ws.append(["invalid"])
    ws.append(["also bad"])
    wb.save(xlsx)

    result = ub.handle_generar_ubicaciones({
        "excelPath": str(xlsx),
        "outputDir": str(tmp_path / "out"),
        "formato": "vertical",
        "consolidado": False,
    })

    assert result["success"] is False
    assert "coordenadas validas" in result["error"]


def test_handle_generar_ubicaciones_rejects_manual_invalid_coords(tmp_path: Path) -> None:
    result = ub.handle_generar_ubicaciones({
        "outputDir": str(tmp_path / "out"),
        "formato": "vertical",
        "manualData": {"lat": "abc", "lon": "def", "cod_componente": "X"},
    })

    assert result["success"] is False
    assert "coordenadas validas" in result["error"]


def test_handle_generar_ubicaciones_unique_pdf_for_duplicate_cod(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    import openpyxl

    monkeypatch.setattr(ub, "fetch_static_map", lambda *a, **k: _png_bytes((256, 256)))

    xlsx = tmp_path / "dup.xlsx"
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["cod", "latitud", "longitud"])
    ws.append(["SAME", -12.0, -77.0])
    ws.append(["SAME", -13.0, -78.0])
    wb.save(xlsx)

    out_dir = tmp_path / "out"
    result = ub.handle_generar_ubicaciones({
        "excelPath": str(xlsx),
        "outputDir": str(out_dir),
        "formato": "vertical",
        "consolidado": False,
    })

    assert result["success"] is True
    assert result["data"]["generados"] == 2
    pdfs = sorted(p.name for p in out_dir.glob("*.pdf"))
    assert pdfs == ["SAME.pdf", "SAME_2.pdf"]


def test_handle_generar_ubicaciones_applies_custom_styles_and_map_opts(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    """generar_ubicaciones debe pasar customStyles y map_opts al renderer."""
    captured: list[tuple] = []

    def fake_render(d, formato, map_opts=None, custom_styles=None):
        captured.append((formato, map_opts, custom_styles))
        img = Image.new("RGB", (100, 100), (10, 20, 30))
        return img

    monkeypatch.setattr(ub, "render_imagen_ubicacion", fake_render)

    out_dir = tmp_path / "out"
    styles = {"map": {"overlayAlpha": 50, "overlayColor": "#AABBCC"}}
    result = ub.handle_generar_ubicaciones({
        "outputDir": str(out_dir),
        "formato": "horizontal",
        "consolidado": True,
        "provider": "osm",
        "zoom": 16,
        "api_key": "",
        "customStyles": styles,
        "manualData": {
            "lat": "-12.0",
            "lon": "-77.0",
            "cod_componente": "GEN-1",
        },
    })

    assert result["success"] is True
    assert result["data"]["consolidado"] is True
    assert (out_dir / "ubicaciones_consolidado.pdf").is_file()
    assert len(captured) == 1
    formato, map_opts, custom_styles = captured[0]
    assert formato == "horizontal"
    assert map_opts["provider"] == "osm"
    assert map_opts["zoom"] == 16
    assert custom_styles == styles


def test_preview_composed_cache_differs_by_formato() -> None:
    """Cambiar formato debe producir previews compuestas distintas."""
    manual = {
        "lat": "-11.968674",
        "lon": "-76.978299",
        "cod_componente": "FMT",
        "direccion": "Calle 1",
        "localidad": "Loc",
        "distrito": "Dist",
    }

    def fake_map(lat, lon, formato, preview=True, map_opts=None):
        w, h = ub._map_capture_size(formato, preview=preview)
        return _png_bytes((w, h), (80, 120, 160))

    with patch.object(ub, "_get_cached_map_screenshot", side_effect=fake_map):
        vertical = ub.handle_preview_ubicacion({"formato": "vertical", "manualData": manual})
        horizontal = ub.handle_preview_ubicacion({"formato": "horizontal", "manualData": manual})

    assert vertical["success"] is True
    assert horizontal["success"] is True
    assert vertical["data"]["image"] != horizontal["data"]["image"]


@pytest.mark.parametrize(
    ("provider", "needle"),
    [
        ("mapbox", "access_token="),
        ("maptiler", "key="),
        ("stadia", "api_key="),
        ("geoapify", "apiKey="),
        ("thunderforest", "apikey="),
    ],
)
def test_xyz_providers_embed_api_key_in_tile_url(
    monkeypatch: pytest.MonkeyPatch, provider: str, needle: str,
) -> None:
    tile = _png_bytes((ub._OSM_TILE_SIZE, ub._OSM_TILE_SIZE), (60, 120, 160))
    seen: list[str] = []

    def fake_get(url: str, headers: dict[str, str], timeout: int = ub._HTTP_TIMEOUT) -> bytes:
        seen.append(url)
        return tile

    monkeypatch.setattr(ub, "_http_get", fake_get)
    ub.fetch_static_map(-12.046, -77.042, 400, 300, zoom=16, provider=provider, api_key="TEST-KEY-123")
    assert seen
    assert any(needle in url and "TEST-KEY-123" in url for url in seen)

