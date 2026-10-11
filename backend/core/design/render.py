"""Design → HTML.

El render **nunca** interpola marcado ni CSS del modelo: los textos se escapan
con ``html.escape``, los colores y fuentes llegan validados por
``models.normalize_*`` y el layout se elige de una allowlist. El HTML que sale
aquí es el que se sanitiza antes de renderizar y el que WeasyPrint imprime.
"""

from __future__ import annotations

from html import escape

from backend.core.design.models import LAYOUTS
from backend.core.design.types import JsonObject

_ESCAPE = {"quote": False}

_STYLE = """
@page {{ size: {width}mm {height}mm; margin: 0; }}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{ width: {width}mm; height: {height}mm; }}
body {{
  font-family: {body_font}, Georgia, serif;
  background: {background};
  color: {text};
  -weasy-hyphens: none;
}}
.slide {{
  width: {width}mm; height: {height}mm;
  padding: {pad_h}mm {pad_v}mm;
  display: flex; flex-direction: column;
  page-break-after: always;
  break-after: page;
  overflow: hidden;
}}
.slide:last-child {{ page-break-after: auto; break-after: auto; }}
.title {{ font-family: {head_font}, Georgia, serif; font-weight: 700;
  font-size: {fs_title}pt; line-height: 1.12; color: {text}; }}
.title.on-accent {{ color: {background}; }}
.subtitle {{ font-size: {fs_subtitle}pt; line-height: 1.35; color: {muted}; }}
.rule {{ height: {rule_mm}mm; background: {accent}; align-self: flex-start; }}
.body {{ font-size: {fs_body}pt; line-height: 1.45; color: {text}; }}
.muted {{ color: {muted}; }}
.center {{ justify-content: center; text-align: center; align-items: center; }}
.hero {{ justify-content: center; }}
.hero .title {{ font-size: {fs_hero}pt; }}
ul {{ list-style: none; }}
li {{ position: relative; padding-left: {bullet_indent}mm; font-size: {fs_body}pt;
  line-height: 1.4; color: {text}; margin-bottom: {bullet_gap}mm; }}
li::before {{ content: ""; position: absolute; left: 0; top: {bullet_top}em;
  width: {bullet_mm}mm; height: {bullet_mm}mm; border-radius: 50%; background: {accent}; }}
.cols {{ display: flex; gap: {col_gap}mm; align-items: flex-start; }}
.cols > div {{ flex: 1 1 0; }}
.stat-value {{ font-family: {head_font}, Georgia, serif; font-size: {fs_stat}pt;
  font-weight: 700; line-height: 1; color: {accent}; }}
.stat-label {{ font-size: {fs_subtitle}pt; color: {muted}; margin-top: {stat_gap}mm; }}
.quote-text {{ font-family: {head_font}, Georgia, serif; font-size: {fs_quote}pt;
  line-height: 1.3; font-style: italic; color: {text}; }}
.quote-author {{ font-size: {fs_caption}pt; color: {muted}; margin-top: {stat_gap}mm; }}
.notes {{ display: none; }}
"""


def _font_stack(name: str) -> str:
    # `name` ya viene de la allowlist del schema; las comillas cierran el literal
    # para que un nombre con espacios no rompa la declaración CSS.
    return f'"{name}"'


def _px_ratio(width_mm: float, height_mm: float) -> float:
    """Escala tipográfica según el ancho de la página (A4 ≈ 1.0)."""
    ratio: float = (width_mm / 210.0) ** 0.5 * 0.98
    return max(0.72, min(1.45, ratio))


def _bullets_html(items: list[str]) -> str:
    if not items:
        return ""
    parts = [f"<li>{escape(str(item))}</li>" for item in items if str(item).strip()]
    return f"<ul>{''.join(parts)}</ul>" if parts else ""


def _slide_html(slide: JsonObject, theme: dict[str, str]) -> str:
    layout = str(slide.get("layout") or "")
    if layout not in LAYOUTS:
        layout = "bullets"
    title = escape(str(slide.get("title") or ""))
    subtitle = escape(str(slide.get("subtitle") or ""))
    body = escape(str(slide.get("body") or ""))

    if layout == "title":
        parts = [f'<div class="title hero-title">{title}</div>'] if title else []
        if subtitle:
            parts.append(f'<div class="subtitle" style="margin-top:6mm">{subtitle}</div>')
        return f'<section class="slide hero">{"".join(parts)}</section>'

    if layout == "section":
        parts = [f'<div class="title">{title}</div>'] if title else []
        if subtitle:
            parts.append(f'<div class="subtitle" style="margin-top:4mm">{subtitle}</div>')
        return f'<section class="slide center">{"".join(parts)}</section>'

    if layout == "stat":
        value = escape(str(slide.get("statValue") or title))
        label = escape(str(slide.get("statLabel") or subtitle))
        parts = [f'<div class="stat-value">{value}</div>'] if value else []
        if label:
            parts.append(f'<div class="stat-label">{label}</div>')
        if body:
            parts.append(f'<div class="body muted" style="margin-top:10mm">{body}</div>')
        return f'<section class="slide hero">{"".join(parts)}</section>'

    if layout == "quote":
        text = escape(str(slide.get("quoteText") or body))
        author = escape(str(slide.get("quoteAuthor") or subtitle))
        parts = [f'<div class="quote-text">{text}</div>'] if text else []
        if author:
            parts.append(f'<div class="quote-author">{author}</div>')
        return f'<section class="slide center">{"".join(parts)}</section>'

    if layout == "twoColumn":
        left = _bullets_html(list(slide.get("left") or []))
        right = _bullets_html(list(slide.get("right") or []))
        columns = ""
        if left or right:
            columns = (
                '<div class="cols">'
                f"<div>{left}</div>"
                f"<div>{right}</div>"
                "</div>"
            )
        head = f'<div class="title">{title}</div><div style="height:5mm"></div>' if title else ""
        tail = f'<div class="body" style="margin-top:5mm">{body}</div>' if body else ""
        return f'<section class="slide">{head}{columns}{tail}</section>'

    if layout == "blank":
        inner = f'<div class="body">{body}</div>' if body else ""
        return f'<section class="slide">{inner}</section>'

    head = f'<div class="title">{title}</div><div style="height:5mm"></div>' if title else ""
    items = list(slide.get("bullets") or [])
    # `body` es texto corrido: si el modelo solo lo escribió ahí y dejó
    # `bullets` vacío, se muestra como un único punto para no perder contenido.
    if not items and body:
        items = [body]
    bullets = _bullets_html(items)
    tail = f'<div class="body" style="margin-top:5mm">{body}</div>' if body and not bullets else ""
    return f'<section class="slide">{head}{bullets}{tail}</section>'


def render_html(document: JsonObject) -> str:
    """Devuelve el HTML completo del Design, listo para sanitizer o para PDF."""
    page_raw = document.get("page")
    theme_raw = document.get("theme")
    page: JsonObject = page_raw if isinstance(page_raw, dict) else {}
    theme: dict[str, str] = theme_raw if isinstance(theme_raw, dict) else {}
    width = float(page.get("widthMm") or 210)
    height = float(page.get("heightMm") or 297)
    ratio = _px_ratio(width, height)

    pad_v = round(width * 0.075, 2)
    pad_h = round(height * 0.075, 2)
    slide_count = max(1, len(document.get("slides") or []))
    title = escape(str(document.get("name") or "Diseño"))

    style = _STYLE.format(
        width=f"{width:g}",
        height=f"{height:g}",
        pad_v=f"{pad_v:g}",
        pad_h=f"{pad_h:g}",
        rule_mm=f"{max(0.6, width * 0.0025):g}",
        background=theme.get("background", "#FFFFFF"),
        text=theme.get("text", "#111827"),
        muted=theme.get("muted", "#6B7280"),
        accent=theme.get("accent", "#2563EB"),
        head_font=_font_stack(str(theme.get("headFont") or "Cambria")),
        body_font=_font_stack(str(theme.get("bodyFont") or "Calibri")),
        fs_hero=f"{40 * ratio:.1f}",
        fs_title=f"{30 * ratio:.1f}",
        fs_subtitle=f"{17 * ratio:.1f}",
        fs_body=f"{16 * ratio:.1f}",
        fs_caption=f"{12 * ratio:.1f}",
        fs_stat=f"{72 * ratio:.1f}",
        fs_quote=f"{26 * ratio:.1f}",
        bullet_indent=f"{width * 0.028:.2f}",
        bullet_mm=f"{width * 0.008:.2f}",
        bullet_top="0.42",
        bullet_gap=f"{max(1.5, height * 0.012):.2f}",
        col_gap=f"{width * 0.05:.2f}",
        stat_gap=f"{max(1.5, height * 0.012):.2f}",
    )

    slides_raw = document.get("slides")
    slides = slides_raw if isinstance(slides_raw, list) else []
    rendered = "".join(_slide_html(dict(slide), theme) for slide in slides if isinstance(slide, dict))
    return (
        "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\">"
        f"<title>{title}</title><style>{style}</style></head>"
        f'<body data-slides="{slide_count}">{rendered}</body></html>'
    )
