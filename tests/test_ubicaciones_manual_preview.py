"""Regresión: preview manual no reutiliza caché entre filas distintas."""

from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image

from backend.handlers import ubicaciones as ubi


def _fake_map_png(width: int, height: int) -> bytes:
    img = Image.new("RGB", (width, height), (80, 120, 160))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _clear_preview_caches() -> None:
    ubi._clear_ubicaciones_caches()


def test_manual_preview_cache_differs_by_text_fields() -> None:
    cap_w, cap_h = ubi._map_capture_size("horizontal", preview=True)
    fake_map = _fake_map_png(cap_w, cap_h)
    base_payload = {
        "formato": "horizontal",
        "manualData": {
            "lat": "-11.968674",
            "lon": "-76.978299",
            "direccion": "Calle 1",
            "localidad": "Loc 1",
            "distrito": "Dist 1",
        },
    }

    with patch.object(ubi, "_get_cached_map_screenshot", return_value=fake_map):
        first = ubi.handle_preview_ubicacion(
            {**base_payload, "manualData": {**base_payload["manualData"], "cod_componente": "COD-A"}}
        )
        second = ubi.handle_preview_ubicacion(
            {**base_payload, "manualData": {**base_payload["manualData"], "cod_componente": "COD-B"}}
        )

    assert first["cod_componente"] == "COD-A"
    assert second["cod_componente"] == "COD-B"
    # data: URI — Electron CSP blocks file: in img-src
    assert str(first["image"]).startswith("data:image/jpeg;base64,")
    assert Path(first["image_path"]).is_file()
    assert "base64," in str(first["image"])


def test_manual_preview_cache_differs_by_coordinates() -> None:
    cap_w, cap_h = ubi._map_capture_size("horizontal", preview=True)
    fake_map = _fake_map_png(cap_w, cap_h)
    shared_text = {
        "cod_componente": "SAME-COD",
        "direccion": "Calle 1",
        "localidad": "Loc 1",
        "distrito": "Dist 1",
    }

    with patch.object(ubi, "_get_cached_map_screenshot", return_value=fake_map) as fetch_map:
        first = ubi.handle_preview_ubicacion(
            {
                "formato": "horizontal",
                "manualData": {**shared_text, "lat": "-11.968674", "lon": "-76.978299"},
            }
        )
        second = ubi.handle_preview_ubicacion(
            {
                "formato": "horizontal",
                "manualData": {**shared_text, "lat": "-12.0464", "lon": "-77.0428"},
            }
        )

    assert first["image"] is not None
    assert second["image"] is not None
    assert fetch_map.call_count == 2


def test_recompose_only_reuses_working_map_cache_without_refetch() -> None:
    cap_w, cap_h = ubi._map_capture_size("horizontal", preview=True)
    gray_map = ubi._fallback_map_bytes(cap_w, cap_h)
    lat, lon = -11.968674, -76.978299
    map_key = ubi._map_cache_key(lat, lon, "horizontal", preview=True, map_opts={"zoom": 18, "provider": "osm"})
    ubi._map_screenshot_working_cache[map_key] = gray_map

    base_manual = {
        "lat": str(lat),
        "lon": str(lon),
        "direccion": "Calle 1",
        "localidad": "Loc 1",
        "distrito": "Dist 1",
    }

    with patch.object(ubi, "_get_cached_map_screenshot") as fetch_map:
        first = ubi.handle_preview_ubicacion(
            {
                "formato": "horizontal",
                "recomposeOnly": True,
                "manualData": {**base_manual, "cod_componente": "COD-A"},
            }
        )
        second = ubi.handle_preview_ubicacion(
            {
                "formato": "horizontal",
                "recomposeOnly": True,
                "manualData": {**base_manual, "cod_componente": "COD-B"},
            }
        )

    assert first["cod_componente"] == "COD-A"
    assert second["cod_componente"] == "COD-B"
    fetch_map.assert_not_called()


def test_preview_composed_cache_differs_by_map_provider() -> None:
    cap_w, cap_h = ubi._map_capture_size("horizontal", preview=True)
    fake_map = _fake_map_png(cap_w, cap_h)
    manual = {
        "lat": "-11.968674",
        "lon": "-76.978299",
        "cod_componente": "COD-X",
        "direccion": "Calle 1",
        "localidad": "Loc 1",
        "distrito": "Dist 1",
    }

    with patch.object(ubi, "_get_cached_map_screenshot", return_value=fake_map) as fetch_map:
        osm = ubi.handle_preview_ubicacion({"formato": "horizontal", "manualData": manual, "provider": "osm", "zoom": 18})
        maptiler = ubi.handle_preview_ubicacion({
            "formato": "horizontal",
            "manualData": manual,
            "provider": "maptiler",
            "zoom": 18,
            "api_key": "MT-KEY",
        })

    assert osm["image"] is not None
    assert maptiler["image"] is not None
    assert fetch_map.call_count == 2


def test_preview_composed_cache_differs_by_custom_styles() -> None:
    cap_w, cap_h = ubi._map_capture_size("horizontal", preview=True)
    fake_map = _fake_map_png(cap_w, cap_h)
    lat, lon = -11.968674, -76.978299
    map_key = ubi._map_cache_key(lat, lon, "horizontal", preview=True, map_opts={"zoom": 18, "provider": "osm"})
    ubi._map_screenshot_working_cache[map_key] = fake_map
    manual = {
        "lat": str(lat),
        "lon": str(lon),
        "cod_componente": "COD-X",
        "direccion": "Calle 1",
        "localidad": "Loc 1",
        "distrito": "Dist 1",
    }
    base_payload = {"formato": "horizontal", "manualData": manual, "recomposeOnly": True, "zoom": 18, "provider": "osm"}

    with patch.object(ubi, "_get_cached_map_screenshot", return_value=fake_map) as fetch_map:
        first = ubi.handle_preview_ubicacion({
            **base_payload,
            "customStyles": {"map": {"overlayAlpha": 0, "overlayColor": "#F6F6F6"}},
        })
        second = ubi.handle_preview_ubicacion({
            **base_payload,
            "customStyles": {"map": {"overlayAlpha": 120, "overlayColor": "#F6F6F6"}},
        })

    assert first["image"] != second["image"]
    fetch_map.assert_not_called()


def test_preview_composed_cache_differs_by_zoom() -> None:
    cap_w, cap_h = ubi._map_capture_size("horizontal", preview=True)
    fake_map = _fake_map_png(cap_w, cap_h)
    manual = {
        "lat": "-11.968674",
        "lon": "-76.978299",
        "cod_componente": "COD-X",
        "direccion": "Calle 1",
        "localidad": "Loc 1",
        "distrito": "Dist 1",
    }

    with patch.object(ubi, "_get_cached_map_screenshot", return_value=fake_map) as fetch_map:
        zoom15 = ubi.handle_preview_ubicacion({
            "formato": "horizontal",
            "manualData": manual,
            "provider": "osm",
            "zoom": 15,
        })
        zoom19 = ubi.handle_preview_ubicacion({
            "formato": "horizontal",
            "manualData": manual,
            "provider": "osm",
            "zoom": 19,
        })

    assert zoom15["image"] is not None
    assert zoom19["image"] is not None
    assert fetch_map.call_count == 2


def test_clear_ubicaciones_caches_empties_all_stores() -> None:
    cap_w, cap_h = ubi._map_capture_size("horizontal", preview=True)
    fake_map = _fake_map_png(cap_w, cap_h)
    manual = {
        "lat": "-11.968674",
        "lon": "-76.978299",
        "cod_componente": "COD-X",
        "direccion": "Calle 1",
        "localidad": "Loc 1",
        "distrito": "Dist 1",
    }

    with patch.object(ubi, "_get_cached_map_screenshot", return_value=fake_map):
        ubi.handle_preview_ubicacion({
            "formato": "horizontal",
            "manualData": manual,
            "provider": "osm",
            "zoom": 15,
        })

    assert len(ubi._preview_composed_cache) > 0
    ubi._clear_ubicaciones_caches()
    assert len(ubi._preview_composed_cache) == 0
    assert len(ubi._map_screenshot_store) == 0
    assert len(ubi._excel_cache) == 0


def test_preview_composed_cache_is_bounded() -> None:
    cap_w, cap_h = ubi._map_capture_size("horizontal", preview=True)
    fake_map = _fake_map_png(cap_w, cap_h)

    with patch.object(ubi, "_get_cached_map_screenshot", return_value=fake_map):
        for i in range(25):
            ubi.handle_preview_ubicacion({
                "formato": "horizontal",
                "manualData": {
                    "lat": "-11.968674",
                    "lon": "-76.978299",
                    "cod_componente": f"COD-{i}",
                    "direccion": f"Calle {i}",
                    "localidad": "Loc 1",
                    "distrito": "Dist 1",
                },
                "provider": "osm",
                "zoom": 15,
            })

    assert len(ubi._preview_composed_cache) <= ubi._MAX_COMPOSED_CACHE
    assert ubi._MAX_COMPOSED_CACHE <= 20
