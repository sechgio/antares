import json
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from threading import Event
from unittest.mock import patch

import pytest
from PIL import Image, ImageFont

from backend.core.ubicaciones import composer
from backend.core.ubicaciones import geocode as geo
from backend.handlers import ubicaciones as ubi


def _nominatim_payload(lat: float = -12.0464, lon: float = -77.0428) -> bytes:
    return json.dumps([{"lat": str(lat), "lon": str(lon), "display_name": "X"}]).encode()


def _fake_map_png(width: int, height: int) -> bytes:
    img = Image.new("RGB", (width, height), (80, 120, 160))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _clean_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    geo._clear_geocode_state()
    monkeypatch.setattr(geo, "_GEOCODE_MIN_INTERVAL_S", 0)
    monkeypatch.setattr(geo, "user_data_path", lambda rel: tmp_path / rel)
    ubi._clear_ubicaciones_caches()


def test_build_geocode_query_joins_non_empty_fields() -> None:
    assert geo.build_geocode_query("Av X 123", "Urb Norte", "Lima") == "Av X 123, Urb Norte, Lima"
    assert geo.build_geocode_query("Av X 123", "", "Lima") == "Av X 123, Lima"
    assert geo.build_geocode_query("", "", "") == ""


def test_normalize_country_accepts_iso_codes() -> None:
    assert geo.normalize_country(" PE ") == "pe"
    assert geo.normalize_country("pe,cl") == "pe,cl"
    assert geo.normalize_country("peru") is None
    assert geo.normalize_country("p3") is None
    assert geo.normalize_country(None) is None
    assert geo.normalize_country("") is None


def test_geocode_address_parses_first_result_and_sends_country() -> None:
    urls: list[str] = []

    def fake_get(url: str, headers: dict, **kwargs: object) -> bytes:
        urls.append(url)
        return _nominatim_payload()

    with patch.object(geo, "_http_get", side_effect=fake_get):
        coords = geo.geocode_address("Av X 123, Lima", country="pe")

    assert coords == (-12.0464, -77.0428)
    assert "countrycodes=pe" in urls[0]
    assert "av+x+123" in urls[0]


def test_geocode_address_returns_none_on_empty_results() -> None:
    with patch.object(geo, "_http_get", return_value=b"[]"):
        assert geo.geocode_address("direccion inexistente") is None


def test_geocode_address_returns_none_on_http_failure() -> None:
    with patch.object(geo, "_http_get", return_value=None):
        assert geo.geocode_address("Av X 123") is None


def test_geocode_address_does_not_cache_temporary_http_failure() -> None:
    with patch.object(geo, "_http_get", side_effect=[None, _nominatim_payload()]) as http:
        assert geo.geocode_address("Av X 123") is None
        assert geo.geocode_address("Av X 123") == (-12.0464, -77.0428)

    assert http.call_count == 2


def test_geocode_address_rejects_out_of_range_coordinates() -> None:
    with patch.object(geo, "_http_get", return_value=_nominatim_payload(91, 181)):
        assert geo.geocode_address("Av X 123") is None


def test_geocode_address_caches_positive_result() -> None:
    calls: list[str] = []

    def fake_get(url: str, headers: dict, **kwargs: object) -> bytes:
        calls.append(url)
        return _nominatim_payload()

    with patch.object(geo, "_http_get", side_effect=fake_get):
        first = geo.geocode_address("Av X 123", country="pe")
        second = geo.geocode_address("  av x 123 ", country="pe")

    assert first == second == (-12.0464, -77.0428)
    assert len(calls) == 1


def test_geocode_address_caches_negative_result() -> None:
    calls: list[str] = []

    def fake_get(url: str, headers: dict, **kwargs: object) -> bytes:
        calls.append(url)
        return b"[]"

    with patch.object(geo, "_http_get", side_effect=fake_get):
        assert geo.geocode_address("direccion rara") is None
        assert geo.geocode_address("direccion rara") is None

    assert len(calls) == 1


def test_geocode_address_persists_cache_across_state_reset(tmp_path: Path) -> None:
    with patch.object(geo, "_http_get", return_value=_nominatim_payload()) as http:
        geo.geocode_address("Av X 123", country="pe")
        geo._clear_geocode_state()
        cached = geo.geocode_address("Av X 123", country="pe")

    assert cached == (-12.0464, -77.0428)
    assert http.call_count == 1
    assert (tmp_path / "ubicaciones_geocode_cache.json").is_file()


def test_concurrent_identical_queries_share_cached_request() -> None:
    request_started = Event()
    release_request = Event()
    calls = 0

    def fake_get(url: str, headers: dict, **kwargs: object) -> bytes:
        nonlocal calls
        calls += 1
        request_started.set()
        release_request.wait(timeout=2)
        return _nominatim_payload()

    with patch.object(geo, "_http_get", side_effect=fake_get), ThreadPoolExecutor(max_workers=3) as executor:
        first = executor.submit(geo.geocode_address, "Av X 123", country="pe")
        assert request_started.wait(timeout=2)
        others = [executor.submit(geo.geocode_address, "Av X 123", country="pe") for _ in range(2)]
        release_request.set()
        results = [first.result(), *(future.result() for future in others)]

    assert results == [(-12.0464, -77.0428)] * 3
    assert calls == 1


def test_geocoded_pdf_includes_openstreetmap_attribution() -> None:
    cap_w, cap_h = ubi._map_capture_size("horizontal", preview=True)
    fake_map = _fake_map_png(cap_w, cap_h)
    attribution = "Geocodificación: © OpenStreetMap contributors"

    with (
        patch.object(composer, "_get_footer_image", return_value=None),
        patch.object(composer, "_get_pin_rgba", return_value=None),
        patch.object(composer, "_get_font", return_value=ImageFont.load_default()),
        patch.object(composer.ImageDraw.ImageDraw, "text", autospec=True) as draw_text,
    ):
        image = composer._compose_ubicacion_image(
            {"cod_componente": "UBI-1", "lat": -12.0, "lon": -77.0, "_geocoded_by": "nominatim"},
            "horizontal",
            fake_map,
            preview=True,
        )
        image.close()

    assert any(call.args[2] == attribution for call in draw_text.call_args_list)


def test_geocoding_rejects_invalid_country_code(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="código ISO"):
        ubi.handle_generar_ubicaciones({
            "outputDir": str(tmp_path),
            "manualData": {"cod_componente": "UBI-1", "lat": "-12", "lon": "-77"},
            "geocode": True,
            "geocodeCountry": "peru",
        })


def test_generar_ubicaciones_manual_geocodes_when_enabled(tmp_path: Path) -> None:
    with (
        patch.object(geo, "_http_get", return_value=_nominatim_payload()),
        patch.object(ubi, "generar_imagen_ubicacion") as render,
    ):
        resp = ubi.handle_generar_ubicaciones({
            "outputDir": str(tmp_path),
            "manualData": {
                "cod_componente": "UBI-1",
                "direccion": "Av X 123",
                "localidad": "Urb Norte",
                "distrito": "Lima",
                "lat": "",
                "lon": "",
            },
            "geocode": True,
            "geocodeCountry": "pe",
        })

    assert resp["generados"] == 1
    assert resp["geocodificados"] == 1
    datos = render.call_args[0][0]
    assert datos["lat"] == -12.0464
    assert datos["lon"] == -77.0428
    assert datos["_geocoded_by"] == "nominatim"


def test_generar_ubicaciones_keeps_response_shape_when_geocode_is_disabled(tmp_path: Path) -> None:
    with patch.object(ubi, "generar_imagen_ubicacion"):
        response = ubi.handle_generar_ubicaciones({
            "outputDir": str(tmp_path),
            "manualData": {"cod_componente": "UBI-1", "lat": "-12", "lon": "-77"},
        })

    assert set(response) == {"generados", "fallidos", "outputDir", "consolidado", "consolidatedPath"}


def test_generar_ubicaciones_keeps_existing_coordinates_when_geocode_is_enabled(tmp_path: Path) -> None:
    with (
        patch.object(geo, "_http_get") as http,
        patch.object(ubi, "generar_imagen_ubicacion") as render,
    ):
        response = ubi.handle_generar_ubicaciones({
            "outputDir": str(tmp_path),
            "manualData": {
                "cod_componente": "UBI-1",
                "direccion": "Av X 123",
                "lat": "-12.123",
                "lon": "-77.456",
            },
            "geocode": True,
            "geocodeCountry": "pe",
        })

    assert response["geocodificados"] == 0
    assert render.call_args[0][0]["lat"] == -12.123
    assert render.call_args[0][0]["lon"] == -77.456
    http.assert_not_called()


def test_generar_ubicaciones_manual_without_geocode_keeps_error(tmp_path: Path) -> None:
    with patch.object(geo, "_http_get") as http, pytest.raises(ValueError, match="No hay filas con coordenadas"):
        ubi.handle_generar_ubicaciones({
            "outputDir": str(tmp_path),
            "manualData": {"direccion": "Av X 123", "lat": "", "lon": ""},
        })
    http.assert_not_called()


def test_generar_ubicaciones_excel_without_coord_columns_geocodes(tmp_path: Path) -> None:
    import pandas as pd

    excel_path = tmp_path / "solo_direcciones.xlsx"
    pd.DataFrame({
        "cod_componente": ["UBI-1", "UBI-2"],
        "direccion": ["Av A 100", "Av B 200"],
        "distrito": ["Lima", "Lima"],
    }).to_excel(excel_path, index=False)

    with (
        patch.object(geo, "_http_get", return_value=_nominatim_payload()) as http,
        patch.object(ubi, "generar_imagen_ubicacion"),
    ):
        resp = ubi.handle_generar_ubicaciones({
            "excelPath": str(excel_path),
            "outputDir": str(tmp_path / "out"),
            "geocode": True,
            "geocodeCountry": "pe",
        })

    assert resp["generados"] == 2
    assert resp["geocodificados"] == 2
    assert http.call_count == 2


def test_generar_ubicaciones_excel_without_coords_keeps_error(tmp_path: Path) -> None:
    import pandas as pd

    excel_path = tmp_path / "solo_direcciones.xlsx"
    pd.DataFrame({"direccion": ["Av A 100"], "distrito": ["Lima"]}).to_excel(excel_path, index=False)

    with patch.object(geo, "_http_get") as http, pytest.raises(ValueError, match="latitud"):
        ubi.handle_generar_ubicaciones({
            "excelPath": str(excel_path),
            "outputDir": str(tmp_path / "out"),
        })
    http.assert_not_called()


def test_generar_ubicaciones_skips_rows_geocode_fails(tmp_path: Path) -> None:
    import pandas as pd

    excel_path = tmp_path / "mixto.xlsx"
    pd.DataFrame({
        "cod_componente": ["UBI-1", "UBI-2", "UBI-3"],
        "direccion": ["", "Av B 200", "Av C 300"],
        "latitud": [-12.1, None, None],
        "longitud": [-77.1, None, None],
    }).to_excel(excel_path, index=False)

    with (
        patch.object(geo, "_http_get", return_value=_nominatim_payload()) as http,
        patch.object(ubi, "generar_imagen_ubicacion"),
    ):
        resp = ubi.handle_generar_ubicaciones({
            "excelPath": str(excel_path),
            "outputDir": str(tmp_path / "out"),
            "geocode": True,
        })

    assert resp["generados"] == 3
    assert resp["geocodificados"] == 2
    assert http.call_count == 2


def test_generar_ubicaciones_reports_each_unresolved_row(tmp_path: Path) -> None:
    import pandas as pd

    excel_path = tmp_path / "fallidas.xlsx"
    pd.DataFrame({
        "cod_componente": ["UBI-1", "UBI-2", "UBI-3"],
        "direccion": ["Av A 100", "", "Av C 300"],
        "latitud": [-12.1, None, None],
        "longitud": [-77.1, None, None],
    }).to_excel(excel_path, index=False)

    with (
        patch.object(geo, "_http_get", return_value=b"[]"),
        patch.object(ubi, "generar_imagen_ubicacion"),
    ):
        resp = ubi.handle_generar_ubicaciones({
            "excelPath": str(excel_path),
            "outputDir": str(tmp_path / "out"),
            "geocode": True,
        })

    assert resp["generados"] == 1
    assert resp["geocodificados"] == 0
    assert resp["geocodeFailures"] == [
        {"cod_componente": "UBI-2", "motivo": "missing_address"},
        {"cod_componente": "UBI-3", "motivo": "not_found"},
    ]


def test_generar_ubicaciones_returns_geocoding_failure_when_all_rows_fail(tmp_path: Path) -> None:
    with patch.object(geo, "_http_get", return_value=b"[]"):
        resp = ubi.handle_generar_ubicaciones({
            "outputDir": str(tmp_path),
            "manualData": {
                "cod_componente": "UBI-1",
                "direccion": "Av X 123",
                "lat": "",
                "lon": "",
            },
            "geocode": True,
        })

    assert resp["generados"] == 0
    assert resp["geocodeFailures"] == [{"cod_componente": "UBI-1", "motivo": "not_found"}]


def test_preview_ubicacion_manual_geocodes_when_enabled(tmp_path: Path) -> None:
    cap_w, cap_h = ubi._map_capture_size("horizontal", preview=True)
    fake_map = _fake_map_png(cap_w, cap_h)

    with (
        patch.object(geo, "_http_get", return_value=_nominatim_payload()),
        patch.object(ubi, "_get_cached_map_screenshot", return_value=fake_map) as fetch_map,
    ):
        resp = ubi.handle_preview_ubicacion({
            "formato": "horizontal",
            "manualData": {
                "cod_componente": "UBI-1",
                "direccion": "Av X 123",
                "distrito": "Lima",
                "lat": "",
                "lon": "",
            },
            "geocode": True,
            "geocodeCountry": "pe",
        })

    assert resp["cod_componente"] == "UBI-1"
    assert resp["datos"]["lat"] == -12.0464
    assert resp["datos"]["lon"] == -77.0428
    fetch_map.assert_called_once()


def test_excel_preview_cache_changes_when_geocoded_coordinates_change(tmp_path: Path) -> None:
    import pandas as pd

    excel_path = tmp_path / "preview.xlsx"
    pd.DataFrame({"direccion": ["Av X 123"], "distrito": ["Lima"]}).to_excel(excel_path, index=False)
    preview_path = tmp_path / "preview.jpg"
    preview_path.write_bytes(b"preview")
    cap_w, cap_h = ubi._map_capture_size("horizontal", preview=True)
    fake_map = _fake_map_png(cap_w, cap_h)
    compose_calls: list[float] = []

    def compose(ctx: tuple, row_index: int, formato: str, datos: dict, screenshot: bytes, total: int, **kwargs: object) -> dict:
        compose_calls.append(datos["lat"])
        key = ubi._composed_preview_key(ctx, row_index, formato, "", kwargs.get("map_opts"))
        result = {"image_path": str(preview_path), "datos": {"lat": datos["lat"]}}
        ubi._preview_composed_cache[key] = result
        return result

    with (
        patch.object(geo, "_http_get", side_effect=[_nominatim_payload(-12, -77), _nominatim_payload(-20, -69)]),
        patch.object(ubi, "_get_cached_map_screenshot", return_value=fake_map),
        patch.object(ubi, "_compose_and_cache_preview", side_effect=compose),
        patch.object(ubi, "_spawn_prefetch"),
    ):
        first = ubi.handle_preview_ubicacion({
            "excelPath": str(excel_path),
            "formato": "horizontal",
            "rowIndex": 0,
            "geocode": True,
            "geocodeCountry": "pe",
        })
        second = ubi.handle_preview_ubicacion({
            "excelPath": str(excel_path),
            "formato": "horizontal",
            "rowIndex": 0,
            "geocode": True,
            "geocodeCountry": "cl",
        })

    assert first["datos"]["lat"] == -12
    assert second["datos"]["lat"] == -20
    assert compose_calls == [-12, -20]


def test_preview_ubicacion_reports_geocoding_failure() -> None:
    with patch.object(geo, "_http_get", return_value=b"[]"), pytest.raises(
        ValueError, match="No se pudo geocodificar la dirección"
    ):
        ubi.handle_preview_ubicacion({
            "formato": "horizontal",
            "manualData": {"direccion": "Av X 123", "lat": "", "lon": ""},
            "geocode": True,
        })


def test_preview_ubicacion_reports_missing_address() -> None:
    with patch.object(geo, "_http_get") as http, pytest.raises(
        ValueError, match="ni una dirección para geocodificar"
    ):
        ubi.handle_preview_ubicacion({
            "formato": "horizontal",
            "manualData": {"lat": "", "lon": ""},
            "geocode": True,
        })
    http.assert_not_called()


def test_preview_ubicacion_manual_without_geocode_keeps_error() -> None:
    with patch.object(geo, "_http_get") as http, pytest.raises(ValueError, match="coordenadas validas"):
        ubi.handle_preview_ubicacion({
            "formato": "horizontal",
            "manualData": {"direccion": "Av X 123", "lat": "", "lon": ""},
        })
    http.assert_not_called()
