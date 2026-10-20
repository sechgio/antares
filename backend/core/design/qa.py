from __future__ import annotations

from typing import Any

from backend.core.design.render import render_html
from backend.core.design.types import JsonObject

MIN_FONT_PT = 9.0
_OVERFLOW_TOLERANCE_PT = 2.0
_COLLISION_AREA_RATIO = 0.18
MIN_CONTRAST_BODY = 4.5
MIN_CONTRAST_LARGE = 3.0

Finding = dict[str, Any]  # allowlist: dict[str, Any]
Preflight = dict[str, Any]  # allowlist: dict[str, Any]


def _hex_to_rgb(value: str) -> tuple[float, float, float]:
    text = value.lstrip("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    try:
        return (int(text[0:2], 16) / 255.0, int(text[2:4], 16) / 255.0, int(text[4:6], 16) / 255.0)
    except (ValueError, IndexError):
        return (0.0, 0.0, 0.0)


def _relative_luminance(rgb: tuple[float, float, float]) -> float:
    def channel(value: float) -> float:
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

    red, green, blue = (channel(c) for c in rgb)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def contrast_ratio(foreground: str, background: str) -> float:
    first = _relative_luminance(_hex_to_rgb(foreground))
    second = _relative_luminance(_hex_to_rgb(background))
    lighter, darker = max(first, second), min(first, second)
    return (lighter + 0.05) / (darker + 0.05)


def _overlap_ratio(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    width = min(ax1, bx1) - max(ax0, bx0)
    height = min(ay1, by1) - max(ay0, by0)
    if width <= 0 or height <= 0:
        return 0.0
    intersection = width * height
    area_a = max((ax1 - ax0) * (ay1 - ay0), 1e-6)
    area_b = max((bx1 - bx0) * (by1 - by0), 1e-6)
    return intersection / min(area_a, area_b)


def layouts_for(document: JsonObject) -> list[str]:
    slides = document.get("slides")
    if not isinstance(slides, list):
        return []
    return [str(s.get("layout") or "") for s in slides if isinstance(s, dict)]


def consecutive_run_lengths(items: list[str]) -> list[tuple[str, int, int]]:
    if not items:
        return []
    runs: list[tuple[str, int, int]] = []
    start = 0
    for index in range(1, len(items) + 1):
        if index == len(items) or items[index] != items[start]:
            runs.append((items[start], index - start, start))
            start = index
    return runs


def check_layout_monotony(document: JsonObject, max_run: int = 3) -> list[Finding]:
    findings: list[Finding] = []
    for layout, length, start in consecutive_run_lengths(layouts_for(document)):
        if length >= max_run:
            findings.append(
                {
                    "kind": "layout-monotony",
                    "severity": "warning",
                    "slide": start + 1,
                    "message": (
                        f"La maquetación `{layout}` se repite {length} veces seguidas "
                        f"(diapositivas {start + 1} a {start + length}). Alterna con otra."
                    ),
                    "detail": {"layout": layout, "runLength": length, "fromSlide": start + 1},
                }
            )
    return findings


def check_theme_contrast(theme: JsonObject) -> list[Finding]:
    background = str(theme.get("background") or "#FFFFFF")
    findings: list[Finding] = []
    pairs = (
        ("text", str(theme.get("text") or "#111827"), MIN_CONTRAST_BODY, "cuerpo de texto"),
        ("muted", str(theme.get("muted") or "#6B7280"), MIN_CONTRAST_BODY, "texto secundario"),
        ("accent", str(theme.get("accent") or "#2563EB"), MIN_CONTRAST_LARGE, "acento"),
    )
    for key, color, minimum, label in pairs:
        ratio = contrast_ratio(color, background)
        if ratio < minimum:
            findings.append(
                {
                    "kind": "contrast",
                    "severity": "error",
                    "slide": 0,
                    "message": f"El {label} ({color}) queda en {ratio:.1f}:1 sobre el fondo {background}; el mínimo es {minimum}:1.",
                    "detail": {"role": key, "ratio": round(ratio, 2), "minimum": minimum},
                }
            )
    return findings


def _page_findings(page: Any, slide_number: int, safe: tuple[float, float, float, float]) -> list[Finding]:
    findings: list[Finding] = []
    blocks: list[tuple[float, float, float, float]] = []
    text = page.get_text("dict")
    for block in text.get("blocks") or []:
        if block.get("type") != 0:
            continue
        box = block.get("bbox")
        if not box or len(box) != 4:
            continue
        blocks.append((float(box[0]), float(box[1]), float(box[2]), float(box[3])))
        for line in block.get("lines") or []:
            for span in line.get("spans") or []:
                size = float(span.get("size") or 0.0)
                content = str(span.get("text") or "").strip()
                if size and content and size < MIN_FONT_PT:
                    findings.append(
                        {
                            "kind": "tiny-text",
                            "severity": "warning",
                            "slide": slide_number,
                            "message": f'Texto a {size:.1f} pt, por debajo del suelo de {MIN_FONT_PT:.0f} pt: "{content[:48]}".',
                            "detail": {"size": round(size, 1), "text": content[:80]},
                        }
                    )

    if not blocks:
        findings.append(
            {
                "kind": "empty-slide",
                "severity": "error",
                "slide": slide_number,
                "message": "La diapositiva no contiene texto: el render la ha dejado vacía.",
                "detail": {},
            }
        )
        return findings

    sx0, sy0, sx1, sy1 = safe
    for box in blocks:
        if box[0] < sx0 - _OVERFLOW_TOLERANCE_PT or box[1] < sy0 - _OVERFLOW_TOLERANCE_PT \
                or box[2] > sx1 + _OVERFLOW_TOLERANCE_PT or box[3] > sy1 + _OVERFLOW_TOLERANCE_PT:
            findings.append(
                {
                    "kind": "overflow",
                    "severity": "error",
                    "slide": slide_number,
                    "message": "El texto se sale del área segura de la diapositiva (margenes o recorte).",
                    "detail": {"bbox": [round(v, 1) for v in box], "safe": [round(v, 1) for v in safe]},
                }
            )
            break

    for index, first in enumerate(blocks):
        for second in blocks[index + 1 :]:
            if _overlap_ratio(first, second) >= _COLLISION_AREA_RATIO:
                findings.append(
                    {
                        "kind": "collision",
                        "severity": "error",
                        "slide": slide_number,
                        "message": "Dos bloques de texto se solapan.",
                        "detail": {"a": [round(v, 1) for v in first], "b": [round(v, 1) for v in second]},
                    }
                )
                break
        else:
            continue
        break
    return findings


def run_preflight(document: JsonObject, pdf: bytes | None = None) -> Preflight:
    theme_raw = document.get("theme")
    page_raw = document.get("page")
    theme: JsonObject = theme_raw if isinstance(theme_raw, dict) else {}
    page: JsonObject = page_raw if isinstance(page_raw, dict) else {}
    findings = check_theme_contrast(theme)
    findings.extend(check_layout_monotony(document))

    if pdf is None:
        from backend.utils.pdf_html import write_pdf_sanitized

        pdf = write_pdf_sanitized(render_html(document))

    import pymupdf

    width_mm = float(page.get("widthMm") or 210)
    height_mm = float(page.get("heightMm") or 297)
    pad_x = width_mm * 0.075 / 25.4 * 72.0
    pad_y = height_mm * 0.075 / 25.4 * 72.0

    with pymupdf.open(stream=pdf, filetype="pdf") as document_pdf:
        slide_count = len(document_pdf)
        for index, pdf_page in enumerate(document_pdf):
            rect = pdf_page.rect
            findings.extend(
                _page_findings(pdf_page, index + 1, (pad_x, pad_y, rect.width - pad_x, rect.height - pad_y))
            )

    errors = [f for f in findings if f["severity"] == "error"]
    return {
        "ok": not errors,
        "slideCount": slide_count,
        "findings": findings,
        "errorCount": len(errors),
        "warningCount": len(findings) - len(errors),
    }
