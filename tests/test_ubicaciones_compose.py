"""Tests de composición UBICACIONES (sin Playwright)."""

from io import BytesIO
from typing import cast

import pytest
from PIL import Image

from backend.handlers.ubicaciones import (
    _BG_RGB,
    _PIN_TIP_RATIO,
    _REF_LAYOUT,
    _compose_ubicacion_image,
    _crop_footer_bar,
    _dimensions_for,
    _is_gutter_pixel,
    _map_cache_key,
    _map_capture_size,
    _normalize_map_screenshot,
    _output_pdf_filename,
)
from backend.utils.paths import resource_path


def _measure_footer_band_height(jpg_path: str) -> int:
    """Mide la altura (px) de la banda negra principal en una plantilla JPG.

    Helper de test (era shipped en prod): usa getpixel() por pixel, lento pero
    suficiente para validar medidas de las plantillas de referencia una vez.
    """
    img = Image.open(jpg_path).convert("RGB")
    w, h = img.size
    black_rows: list[int] = []
    step = max(1, w // 30)
    for y in range(h):
        total = sum(sum(cast(tuple[int, ...], img.getpixel((x, y)))) for x in range(0, w, step))
        if (total / (w // step + 1)) < 100:
            black_rows.append(y)
    if not black_rows:
        return 0
    groups: list[tuple[int, int]] = []
    start = black_rows[0]
    prev = black_rows[0]
    for y in black_rows[1:]:
        if y == prev + 1:
            prev = y
        else:
            groups.append((start, prev))
            start = prev = y
    groups.append((start, prev))
    best_start, best_end = max(groups, key=lambda band: band[1] - band[0])
    return best_end - best_start + 1


def _fake_map_png(width: int, height: int, color: tuple[int, int, int] = (80, 120, 160)) -> bytes:
    img = Image.new("RGB", (width, height), color)
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


SAMPLE_DATOS = {
    "cod_componente": "RA-10",
    "direccion": "Ca Monshe Ben Maimon Mmaimonides,448",
    "localidad": "Urb Country Club",
    "distrito": "San Juan de Lurigancho",
    "lat": -12.0,
    "lon": -77.0,
}


@pytest.mark.parametrize("formato", ["vertical", "horizontal"])
def test_dimensions_preview_matches_export_proportions(formato: str) -> None:
    export = _dimensions_for(formato, preview=False)
    preview = _dimensions_for(formato, preview=True)
    assert export[2] / export[1] == pytest.approx(preview[2] / preview[1], abs=0.002)


@pytest.mark.parametrize("formato", ["vertical", "horizontal"])
def test_map_capture_size_matches_compose_map_area(formato: str) -> None:
    for preview in (False, True):
        out_w, out_h, footer_h = _dimensions_for(formato, preview=preview)
        cap = _map_capture_size(formato, preview=preview)
        assert cap == (out_w, out_h - footer_h)


@pytest.mark.parametrize("formato", ["vertical", "horizontal"])
def test_compose_output_dimensions(formato: str) -> None:
    cap_w, cap_h = _map_capture_size(formato, preview=False)
    img = _compose_ubicacion_image(
        SAMPLE_DATOS,
        formato,
        _fake_map_png(cap_w, cap_h),
        preview=False,
    )
    expected = _dimensions_for(formato, preview=False)
    assert img.size == (expected[0], expected[1])


@pytest.mark.parametrize("formato", ["vertical", "horizontal"])
def test_compose_preview_dimensions(formato: str) -> None:
    cap_w, cap_h = _map_capture_size(formato, preview=True)
    img = _compose_ubicacion_image(
        SAMPLE_DATOS,
        formato,
        _fake_map_png(cap_w, cap_h),
        preview=True,
    )
    expected = _dimensions_for(formato, preview=True)
    assert img.size == (expected[0], expected[1])


@pytest.mark.parametrize("formato", ["vertical", "horizontal"])
def test_footer_is_black_without_map_strip(formato: str) -> None:
    cap_w, cap_h = _map_capture_size(formato, preview=False)
    # Mapa distinto del footer para detectar franjas de mapa bajo la barra
    map_bytes = _fake_map_png(cap_w, cap_h, (100, 150, 200))
    img = _compose_ubicacion_image(SAMPLE_DATOS, formato, map_bytes, preview=False)
    out_w, out_h, footer_h = _dimensions_for(formato, preview=False)
    map_h = out_h - footer_h

    # Borde superior del footer: negro en los extremos
    left = img.getpixel((0, map_h))
    right = img.getpixel((out_w - 1, map_h))
    assert sum(left) < 80
    assert sum(right) < 80

    # Fila inmediatamente encima del footer: tono del mapa (no negro puro)
    above = img.getpixel((out_w // 2, map_h - 1))
    assert sum(above) > 150


def test_crop_footer_bar_removes_map_preview_strip() -> None:
    footer_path = resource_path("assets/ubicaciones/footer_horizontal.png")
    original = Image.open(footer_path)
    cropped = _crop_footer_bar(original)
    assert cropped.height <= original.height
    # PNG legacy incluía mapa debajo (~260px); el repo usa barra negra ~133px.
    assert cropped.height <= max(original.height, 260) * 0.55


@pytest.mark.parametrize("formato", ["vertical", "horizontal"])
def test_pin_is_within_map_area(formato: str) -> None:
    cap_w, cap_h = _map_capture_size(formato, preview=False)
    img = _compose_ubicacion_image(
        SAMPLE_DATOS,
        formato,
        _fake_map_png(cap_w, cap_h),
        preview=False,
    )
    out_w, out_h, footer_h = _dimensions_for(formato, preview=False)
    map_h = out_h - footer_h
    pin_scale = float(_REF_LAYOUT[formato]["pin_scale"])
    pin_w = int(out_w * pin_scale)
    pin_y = (map_h // 2) - int(pin_w * _PIN_TIP_RATIO)
    assert 0 <= pin_y < map_h
    center_x = out_w // 2
    assert img.getpixel((center_x, pin_y + pin_w // 2)) != _BG_RGB


def test_ref_layout_horizontal_matches_reference_jpg() -> None:
    spec = _REF_LAYOUT["horizontal"]
    assert spec["out_w"] == 3508
    assert spec["out_h"] == 2480
    assert spec["footer_h"] == 135


def test_ref_layout_vertical_a4_aspect() -> None:
    spec = _REF_LAYOUT["vertical"]
    assert spec["out_w"] / spec["out_h"] == pytest.approx(2480 / 3508, rel=0.001)
    assert spec["footer_h"] / spec["out_h"] == pytest.approx(122 / 3508, rel=0.01)


@pytest.mark.parametrize("formato,max_ratio", [("vertical", 0.05), ("horizontal", 0.06)])
def test_footer_not_oversized(formato: str, max_ratio: float) -> None:
    _, out_h, footer_h = _dimensions_for(formato, preview=False)
    assert footer_h / out_h < max_ratio


def test_footer_logo_fills_bar_width() -> None:
    cap_w, cap_h = _map_capture_size("vertical", preview=False)
    img = _compose_ubicacion_image(
        SAMPLE_DATOS,
        "vertical",
        _fake_map_png(cap_w, cap_h),
        preview=False,
    )
    out_w, out_h, footer_h = _dimensions_for("vertical", preview=False)
    map_h = out_h - footer_h
    row_y = map_h + footer_h // 2
    xs = [x for x in range(out_w) if max(img.getpixel((x, row_y))) > 30]
    assert xs, "footer row should contain logo pixels"
    assert (max(xs) - min(xs)) >= out_w * 0.08
    assert max(img.getpixel((out_w // 2, row_y))) > 100


def test_measure_footer_band_height_matches_reference_templates() -> None:
    assets = resource_path("assets/ubicaciones")
    vertical_band = _measure_footer_band_height(f"{assets}/vertical.jpg")
    horizontal_band = _measure_footer_band_height(f"{assets}/Horizontal.jpg")
    assert vertical_band == pytest.approx(52, abs=5)
    assert horizontal_band == pytest.approx(135, abs=5)
    assert round(vertical_band / 1491 * 3508) == pytest.approx(int(_REF_LAYOUT["vertical"]["footer_h"]), abs=3)


def test_normalize_map_screenshot_trims_left_gutter() -> None:
    combined = Image.new("RGB", (400, 200), (244, 251, 252))
    map_part = Image.new("RGB", (320, 200), (100, 150, 200))
    combined.paste(map_part, (80, 0))
    buf = BytesIO()
    combined.save(buf, format="PNG")
    normalized = _normalize_map_screenshot(buf.getvalue(), 320, 200)
    result = Image.open(BytesIO(normalized))
    assert result.size == (320, 200)
    assert not _is_gutter_pixel(*result.getpixel((0, 100)))
    assert result.getpixel((0, 100)) == (100, 150, 200)


def test_map_cache_key_differs_by_resolution() -> None:
    preview_key = _map_cache_key(-12.0, -77.0, "vertical", preview=True)
    export_key = _map_cache_key(-12.0, -77.0, "vertical", preview=False)
    assert preview_key != export_key


def test_output_pdf_filename_sanitizes_windows_invalid_chars() -> None:
    """El nombre del PDF no debe contener caracteres inválidos en Windows
    (:*?\"<>|) ni separadores de path — de lo contrario PIL.save levanta
    OSError y aborta el batch entero de ubicaciones."""
    invalid = set('<>:"/\\|?*')

    # Casos con cada carácter inválido suelto.
    assert _output_pdf_filename("A:B") == "A_B.pdf"
    assert _output_pdf_filename("A?B*C") == "A_B_C.pdf"
    assert _output_pdf_filename('A"B|C') == "A_B_C.pdf"
    assert _output_pdf_filename("A<B>C") == "A_B_C.pdf"
    assert _output_pdf_filename("A/B\\C") == "A_B_C.pdf"

    # Un código válido no se altera.
    assert _output_pdf_filename("RA-10") == "RA-10.pdf"

    # Ningún caso produce un nombre con caracteres inválidos.
    for cod in ["A:B", "A?B*C", 'A"B|C', "A<B>C", "A/B\\C", "RA-10", "ID 42"]:
        name = _output_pdf_filename(cod)
        assert not (invalid & set(name)), f"{name!r} still contains invalid chars"
        assert name.endswith(".pdf")


def test_compose_skips_resize_when_map_size_matches(monkeypatch: pytest.MonkeyPatch) -> None:
    out_w, out_h, footer_h = _dimensions_for("vertical", preview=False)
    map_h = out_h - footer_h
    resize_sizes: list[tuple[int, int]] = []
    original_resize = Image.Image.resize

    def tracked_resize(self, *args, **kwargs):
        size = args[0] if args else kwargs.get("size")
        if isinstance(size, tuple):
            resize_sizes.append(size)
        return original_resize(self, *args, **kwargs)

    monkeypatch.setattr(Image.Image, "resize", tracked_resize)
    _compose_ubicacion_image(
        SAMPLE_DATOS,
        "vertical",
        _fake_map_png(out_w, map_h),
        preview=False,
    )
    assert (out_w, map_h) not in resize_sizes
