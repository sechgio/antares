
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, cast

from backend.core.design.types import JsonObject
from backend.utils.paths import resource_path


def _load_design_schema() -> JsonObject:  # allowlist: JsonObject
    try:
        p = resource_path("shared/design-schema.json")
        if p.exists():
            return cast("JsonObject", json.loads(p.read_text(encoding="utf-8")))  # allowlist: JsonObject
    except Exception:
        pass
    return {}


_SCHEMA = _load_design_schema()

DOCUMENT_VERSION: int = int(_SCHEMA.get("documentVersion", 1))
LAYOUTS: frozenset[str] = frozenset(str(x) for x in _SCHEMA.get("layouts", []))
PAGE_PRESETS: dict[str, dict[str, float]] = {
    str(name): {"widthMm": float(spec.get("widthMm", 210)), "heightMm": float(spec.get("heightMm", 297))}
    for name, spec in cast("dict[str, JsonObject]", _SCHEMA.get("pagePresets", {})).items()
}
FONTS: frozenset[str] = frozenset(str(x) for x in _SCHEMA.get("fonts", []))
DEFAULT_THEME: dict[str, str] = {str(k): str(v) for k, v in cast("dict[str, str]", _SCHEMA.get("theme", {})).items()}
_LIMITS: dict[str, int] = {str(k): int(v) for k, v in cast("dict[str, int]", _SCHEMA.get("limits", {})).items()}

DEFAULT_PAGE_PRESET = "a4"
DEFAULT_LAYOUT = "bullets"

MAX_SLIDES = _LIMITS.get("maxSlides", 40)
MAX_TITLE_CHARS = _LIMITS.get("maxTitleChars", 200)
MAX_SUBTITLE_CHARS = _LIMITS.get("maxSubtitleChars", 400)
MAX_BODY_CHARS = _LIMITS.get("maxBodyChars", 4000)
MAX_BULLETS = _LIMITS.get("maxBullets", 12)
MAX_BULLET_CHARS = _LIMITS.get("maxBulletChars", 400)
MAX_NOTES_CHARS = _LIMITS.get("maxNotesChars", 2000)
MAX_NAME_CHARS = _LIMITS.get("maxNameChars", 120)

_HEX_COLOR = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_MIN_PAGE_MM = 20.0
_MAX_PAGE_MM = 2000.0


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _new_id() -> str:
    return str(uuid.uuid4())


_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f]")


def _text(raw: Any, limit: int) -> str:
    if not isinstance(raw, str):
        return ""
    flat = " ".join(_CONTROL_CHARS.sub(" ", raw).split())
    return flat[:limit]


def _color(raw: Any, fallback: str) -> str:
    if isinstance(raw, str):
        candidate = raw.strip()
        if _HEX_COLOR.match(candidate):
            return candidate.upper()
    return fallback


def _font(raw: Any, fallback: str) -> str:
    if isinstance(raw, str) and raw.strip() in FONTS:
        return raw.strip()
    return fallback


def _bounded_mm(raw: Any, fallback: float) -> float:
    try:
        value = float(cast("float", raw))
    except (TypeError, ValueError):
        return fallback
    if value != value or value in (float("inf"), float("-inf")):
        return fallback
    return round(min(max(value, _MIN_PAGE_MM), _MAX_PAGE_MM), 3)


def normalize_page(raw: Any) -> JsonObject:
    raw = raw if isinstance(raw, dict) else {}
    preset = str(raw.get("preset") or "").strip()
    known = PAGE_PRESETS.get(preset)
    if known is None:
        preset = DEFAULT_PAGE_PRESET
        known = PAGE_PRESETS.get(DEFAULT_PAGE_PRESET) or {"widthMm": 210.0, "heightMm": 297.0}
    return {
        "preset": preset,
        "widthMm": _bounded_mm(raw.get("widthMm"), known["widthMm"]),
        "heightMm": _bounded_mm(raw.get("heightMm"), known["heightMm"]),
    }


def normalize_theme(raw: Any) -> dict[str, str]:
    raw = raw if isinstance(raw, dict) else {}
    default = DEFAULT_THEME
    return {
        "background": _color(raw.get("background"), default.get("background", "#FFFFFF")),
        "surface": _color(raw.get("surface"), default.get("surface", "#F3F4F6")),
        "text": _color(raw.get("text"), default.get("text", "#111827")),
        "muted": _color(raw.get("muted"), default.get("muted", "#6B7280")),
        "accent": _color(raw.get("accent"), default.get("accent", "#2563EB")),
        "accentAlt": _color(raw.get("accentAlt"), default.get("accentAlt", "#0F172A")),
        "headFont": _font(raw.get("headFont"), default.get("headFont", "Cambria")),
        "bodyFont": _font(raw.get("bodyFont"), default.get("bodyFont", "Calibri")),
    }


def _bullets(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw[:MAX_BULLETS]:
        text = _text(item, MAX_BULLET_CHARS)
        if text:
            out.append(text)
    return out


def normalize_slide(raw: Any) -> JsonObject | None:
    raw = raw if isinstance(raw, dict) else None
    if raw is None:
        return None
    layout = str(raw.get("layout") or "").strip()
    if layout not in LAYOUTS:
        layout = DEFAULT_LAYOUT
    stat = raw.get("stat") if isinstance(raw.get("stat"), dict) else {}
    quote = raw.get("quote") if isinstance(raw.get("quote"), dict) else {}
    left = _bullets(raw.get("left"))
    right = _bullets(raw.get("right"))
    return {
        "id": str(raw.get("id") or "") if isinstance(raw.get("id"), str) else _new_id(),
        "layout": layout,
        "title": _text(raw.get("title"), MAX_TITLE_CHARS),
        "subtitle": _text(raw.get("subtitle"), MAX_SUBTITLE_CHARS),
        "body": _text(raw.get("body"), MAX_BODY_CHARS),
        "bullets": _bullets(raw.get("bullets")),
        "left": left,
        "right": right,
        "statValue": _text(stat.get("value"), MAX_TITLE_CHARS),
        "statLabel": _text(stat.get("label"), MAX_SUBTITLE_CHARS),
        "quoteText": _text(quote.get("text"), MAX_BODY_CHARS),
        "quoteAuthor": _text(quote.get("author"), MAX_SUBTITLE_CHARS),
        "notes": _text(raw.get("notes"), MAX_NOTES_CHARS),
    }


def create_empty_document() -> JsonObject:
    return {
        "version": DOCUMENT_VERSION,
        "id": _new_id(),
        "name": "Diseño sin título",
        "prompt": "",
        "updatedAt": utc_now_iso(),
        "page": normalize_page({}),
        "theme": normalize_theme({}),
        "slides": [normalize_slide({"layout": "title", "title": "Diseño sin título", "subtitle": ""}) or {}],
    }


def normalize_document(raw: Any) -> JsonObject:
    """Normaliza cualquier payload del modelo o del renderer a un Design válido."""
    if not isinstance(raw, dict):
        return create_empty_document()
    raw = {str(k): v for k, v in raw.items()}
    doc_id = raw.get("id")
    slides_raw = raw.get("slides")
    slides: list[JsonObject] = []
    if isinstance(slides_raw, list):
        for item in slides_raw[:MAX_SLIDES]:
            slide = normalize_slide(item)
            if slide is not None:
                slides.append(slide)
    if not slides:
        fallback = normalize_slide({"layout": "title", "title": "Diseño sin título"})
        slides = [fallback] if fallback else []
    return {
        "version": DOCUMENT_VERSION,
        "id": doc_id.strip()[:64] if isinstance(doc_id, str) and doc_id.strip() else _new_id(),
        "name": _text(raw.get("name"), MAX_NAME_CHARS) or "Diseño sin título",
        "prompt": _text(raw.get("prompt"), 4000),
        "updatedAt": utc_now_iso(),
        "page": normalize_page(raw.get("page")),
        "theme": normalize_theme(raw.get("theme")),
        "slides": slides,
    }
