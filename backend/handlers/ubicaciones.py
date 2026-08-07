import base64
import contextlib
import errno
import hashlib
import json
import logging
import math
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from typing import Any, cast

import pandas as pd
from PIL import Image, ImageDraw, ImageFont, ImageOps

from backend.utils.paths import resource_path, user_data_path
from backend.utils.validators import sanitizar_nombre
from backend.version import __version__ as _antares_version

logger = logging.getLogger(__name__)

# ponytail: este módulo stay-as-is (~909 líneas, 1 feature completa).
# Split en core/ubicaciones/ rechazado: tests parchean ub._http_get por globals del
# módulo (test_ubicaciones_static_map.py L69/79/100); mudar la cadena HTTP a otro
# módulo rompe esos 3 patches sin tocar tests. Reabrir cuando un 2do consumidor
# necesite compose o map_provider aislados.

# Layout medido desde assets/ubicaciones/vertical.jpg y Horizontal.jpg (300 DPI).
# vertical.jpg es referencia visual a escala reducida; footer_h = altura de la banda negra.
_REF_LAYOUT: dict[str, dict[str, int | float]] = {
    "vertical": {
        "out_w": 2480,
        "out_h": 3508,
        "footer_h": 122,
        "preview_w": 600,
        "y_start": 120,
        "line_spacing": 180,
        "line_gap": 0.7,
        "pin_scale": 0.15,
        "font_large": 120,
        "font_medium": 60,
        "stroke_large": 12,
        "stroke_medium": 8,
        "border": 4,
    },
    "horizontal": {
        "out_w": 3508,
        "out_h": 2480,
        "footer_h": 135,
        "preview_w": 850,
        "y_start": 180,
        "line_spacing": 260,
        "line_gap": 0.7,
        "pin_scale": 0.12,
        "font_large": 120,
        "font_medium": 60,
        "stroke_large": 12,
        "stroke_medium": 8,
        "border": 4,
    },
}
_PIN_TIP_X_RATIO = 0.4846
_PIN_TIP_RATIO = 0.7432  # punta coloreada; el PNG conserva una sombra debajo
_MAP_OVERLAY_ALPHA = 120
_BG_RGB = (246, 246, 246)

# ── Asset caches (fonts, footers, excel) ─────────────────────────────────────
_font_cache: OrderedDict[tuple[str, int], ImageFont.FreeTypeFont | ImageFont.ImageFont] = OrderedDict()
_footer_cache: OrderedDict[tuple[int, int, int], Image.Image | None] = OrderedDict()
_MAX_FONT_CACHE = 32
_MAX_FOOTER_CACHE = 8
_excel_cache: OrderedDict[str, tuple[float, pd.DataFrame, tuple[Any, ...]]] = OrderedDict()
_MAX_EXCEL_CACHE = 8
# Single shared LRU for map screenshots. Validated vs working is tracked with a
# side set so callers keep the same hit/miss semantics without retaining up to
# 2x buffers for the same key.
_map_screenshot_store: OrderedDict[tuple[Any, ...], bytes] = OrderedDict()
_map_screenshot_validated: set[tuple[Any, ...]] = set()
_preview_composed_cache: dict[tuple[int, int, tuple[str, float], int, str], dict[str, Any]] = {}
_preview_excel_ctx: tuple[str, float] | None = None
# Guarda las caches mutadas desde el thread daemon de prefetch (B1): sin lock,
# _trim_cache + __setitem__ concurrentes pueden lanzar RuntimeError o corromper
# el orden LRU.
_cache_lock = threading.Lock()
_MAX_MAP_CACHE = 40
_MAX_COMPOSED_CACHE = 80


class _MapScreenshotCacheView:
    """Dict-like view over the shared map LRU (validated-only or full store)."""

    def __init__(self, *, validated_only: bool) -> None:
        self._validated_only = validated_only

    def clear(self) -> None:
        with _cache_lock:
            _map_screenshot_store.clear()
            _map_screenshot_validated.clear()

    def get(self, key: tuple[Any, ...], default: bytes | None = None) -> bytes | None:
        with _cache_lock:
            if key not in _map_screenshot_store:
                return default
            if self._validated_only and key not in _map_screenshot_validated:
                return default
            _map_screenshot_store.move_to_end(key)
            return _map_screenshot_store[key]

    def __setitem__(self, key: tuple[Any, ...], value: bytes) -> None:
        with _cache_lock:
            _map_screenshot_store[key] = value
            _map_screenshot_store.move_to_end(key)
            if self._validated_only:
                _map_screenshot_validated.add(key)
            # Working writes must not mark validated; a later validated write upgrades.
            while len(_map_screenshot_store) > _MAX_MAP_CACHE:
                old_key, _ = _map_screenshot_store.popitem(last=False)
                _map_screenshot_validated.discard(old_key)

    def __contains__(self, key: object) -> bool:
        if not isinstance(key, tuple):
            return False
        with _cache_lock:
            return key in _map_screenshot_store and (
                not self._validated_only or key in _map_screenshot_validated
            )

    def __len__(self) -> int:
        with _cache_lock:
            if self._validated_only:
                return sum(1 for k in _map_screenshot_store if k in _map_screenshot_validated)
            return len(_map_screenshot_store)


_map_screenshot_cache = _MapScreenshotCacheView(validated_only=True)
_map_screenshot_working_cache = _MapScreenshotCacheView(validated_only=False)
# Filas procesadas en paralelo durante export batch. El cuello es red (OSM tiles
# / Google Static), no CPU: 4 workers dan ~4x speedup manteniéndose cortés con la
# política de uso de OSM. Local al handler (no usa submit_heavy del scheduler: el
# handler ya corre en un slot heavy y anidar saturaría/deadlockearía el budget).
_MAX_RENDER_WORKERS = 4
_COORD_PRECISION = 5
_MAP_CAPTURE_VERSION = 5  # incrementar al cambiar heurística de captura/caché
_FOOTER_LAYOUT_VERSION = 2  # incrementar al cambiar footer_h o escalado de logo

# ── Static map provider (replaces Playwright) ────────────────────────────────
# Two selectable backends, chosen at processing time:
#   - "osm":    OpenStreetMap tiles (free, no API key). Default.
#   - "google": Google Static Maps API (requires ANTARES_GOOGLE_MAPS_KEY).
# Selection order: per-call payload ("provider") > env ANTARES_MAP_PROVIDER > "osm".
# The Google key is read from payload ("google_maps_key") > env ANTARES_GOOGLE_MAPS_KEY.
_MAP_ZOOM = 18
_MAP_PROVIDER_DEFAULT = "osm"
# Cap the static-map fetch on its long side so OSM tile counts stay bounded and
# Google's size limit is respected. The composition upsamples to full A4 with
# LANCZOS, so the map stays sharp enough under the dimming overlay + pin.
_MAP_FETCH_MAX_DIM = 1024
_OSM_TILE_SIZE = 256
_XYZ_PROVIDERS = {
    "osm": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    "mapbox": "https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token={key}",
    "maptiler": "https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key={key}",
    "stadia": "https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}.png?api_key={key}",
    "geoapify": "https://maps.geoapify.com/v1/tile/osm-carto/{z}/{x}/{y}.png?apiKey={key}",
    "thunderforest": "https://tile.thunderforest.com/atlas/{z}/{x}/{y}.png?apikey={key}"
}
_GOOGLE_STATIC_URL = "https://maps.googleapis.com/maps/api/staticmap"
_HTTP_USER_AGENT = f"Antares/{_antares_version} (ubicaciones static map; +https://github.com/sechgio/antares)"
_HTTP_TIMEOUT = 12


def _hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    """Convert '#RRGGBB' or '#RGB' to (R, G, B)."""
    h = hex_str.lstrip("#")
    if len(h) == 3:
        h = h[0] * 2 + h[1] * 2 + h[2] * 2
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _colorize_pin(pin_rgba: Image.Image, target_rgb: tuple[int, int, int]) -> Image.Image:
    """Tint the pin image to target_rgb preserving luminance and alpha."""
    _r, _g, _b, a = pin_rgba.split()
    gray = pin_rgba.convert("L")
    colored = ImageOps.colorize(gray, black=(0, 0, 0), mid=target_rgb, white=(255, 255, 255))
    colored = colored.convert("RGBA")
    colored.putalpha(a)
    return colored


def _get_font(bold: bool, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    key = ("arialbd" if bold else "arial", size)
    with _cache_lock:
        cached = _font_cache.get(key)
        if cached is not None:
            _font_cache.move_to_end(key)
            return cached
    try:
        font: ImageFont.FreeTypeFont | ImageFont.ImageFont = ImageFont.truetype(f"{key[0]}.ttf", size)
    except Exception:
        try:
            font = ImageFont.truetype("arial.ttf", size)
        except Exception:
            font = ImageFont.load_default()
    with _cache_lock:
        _font_cache[key] = font
        _font_cache.move_to_end(key)
        _trim_cache(_font_cache, _MAX_FONT_CACHE)
    return font


def _crop_footer_bar(img: Image.Image) -> Image.Image:
    """Los PNG de footer incluyen una vista previa del mapa debajo; conservar solo la barra."""
    rgb = img.convert("RGB")
    w, h = rgb.size
    step = max(1, w // 30)
    last_black = 0
    for y in range(h):
        total = 0.0
        count = 0
        for x in range(0, w, step):
            total += sum(cast(tuple[int, ...], rgb.getpixel((x, y))))
            count += 1
        if count and (total / count) < 120:
            last_black = y
    bar_h = max(1, last_black + 1)
    return rgb.crop((0, 0, w, bar_h))


def _measure_footer_band_height(jpg_path: str) -> int:
    """Mide la altura (px) de la banda negra principal en una plantilla JPG."""
    with Image.open(jpg_path) as opened:
        img = opened.convert("RGB")
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


def _get_footer_image(width: int, height: int) -> Image.Image | None:
    """Pega logo_footer.png en barra negra; escala por ancho (como plantillas JPG)."""
    key = (_FOOTER_LAYOUT_VERSION, width, height)
    with _cache_lock:
        if key in _footer_cache:
            _footer_cache.move_to_end(key)
            return _footer_cache[key]
    footer: Image.Image | None = None
    assets_dir = resource_path("assets/ubicaciones")
    logo_path = os.path.join(assets_dir, "logo_footer.png")
    if not os.path.exists(logo_path):
        logo_path = os.path.join(assets_dir, "footer_horizontal.png")
    if os.path.exists(logo_path):
        with Image.open(logo_path) as opened:
            src = opened.convert("RGBA")
        bar_h = _crop_footer_bar(src.convert("RGB")).height
        logo = src.crop((0, 0, src.width, bar_h))
        scale = width / logo.width
        new_w = width
        new_h = max(1, round(logo.height * scale))
        if new_h > height:
            scale = height / logo.height
            new_h = height
            new_w = max(1, round(logo.width * scale))
        logo_resized = logo.resize((new_w, new_h), Image.Resampling.LANCZOS)
        footer = Image.new("RGB", (width, height), (0, 0, 0))
        x = (width - new_w) // 2
        y = (height - new_h) // 2
        footer.paste(logo_resized, (x, y), logo_resized)
    with _cache_lock:
        _footer_cache[key] = footer
        _footer_cache.move_to_end(key)
        _trim_cache(_footer_cache, _MAX_FOOTER_CACHE)
    return footer


def _map_opts_fingerprint(map_opts: dict[str, Any] | None) -> tuple[Any, ...]:
    """Identidad de capa/zoom/llave para invalidar cachés al cambiar proveedor."""
    provider = _resolve_provider(map_opts)
    zoom = int(map_opts["zoom"]) if map_opts and map_opts.get("zoom") is not None else _MAP_ZOOM
    api_key = _resolve_api_key(map_opts) or ""
    key_fp = "" if provider == "osm" or not api_key else hashlib.sha256(api_key.encode()).hexdigest()[:12]
    return (provider, zoom, key_fp)


def _composed_preview_key(
    excel_ctx: Any,
    row_index: int,
    formato: str,
    styles_hash: str,
    map_opts: dict[str, Any] | None,
) -> tuple[Any, ...]:
    return (
        _FOOTER_LAYOUT_VERSION,
        _MAP_CAPTURE_VERSION,
        excel_ctx,
        row_index,
        formato,
        styles_hash,
        _map_opts_fingerprint(map_opts),
    )


def _map_cache_key(
    lat: float,
    lon: float,
    formato: str,
    *,
    preview: bool,
    map_opts: dict[str, Any] | None = None,
) -> tuple[Any, ...]:
    cap_w, cap_h = _map_capture_size(formato, preview=preview)
    return (_MAP_CAPTURE_VERSION, *_coord_key(lat, lon), formato, cap_w, cap_h, *_map_opts_fingerprint(map_opts))


def _screenshot_has_map_tiles(screenshot_bytes: bytes) -> bool:
    """Rechaza capturas con cuadrícula gris sin calles cargadas."""
    with Image.open(BytesIO(screenshot_bytes)) as opened:
        img = opened.convert("RGB")
    w, h = img.size
    light_gray = 0
    chroma = 0
    samples = 24
    for i in range(samples):
        x = max(0, min(w - 1, (w * (i + 1)) // (samples + 1)))
        y = max(0, min(h - 1, (h * (i + 1)) // (samples + 1)))
        r, g, b = cast(tuple[int, int, int], img.getpixel((x, y)))
        spread = max(r, g, b) - min(r, g, b)
        lum = r + g + b
        if spread < 14 and lum > 620:
            light_gray += 1
        if spread > 18 and 180 < lum < 650:
            chroma += 1
    return light_gray < samples * 0.55 and chroma >= 2


def _is_gutter_pixel(r: int, g: int, b: int) -> bool:
    """Detecta píxeles de relleno gris de Google Maps (no tiles)."""
    spread = max(r, g, b) - min(r, g, b)
    return r > 225 and g > 232 and b > 228 and spread < 40


def _column_is_gutter(img: Image.Image, x: int) -> bool:
    _w, h = img.size
    step = max(1, h // 80)
    return all(_is_gutter_pixel(*cast(tuple[int, int, int], img.getpixel((x, y)))) for y in range(0, h, step))


def _row_is_gutter(img: Image.Image, y: int) -> bool:
    w, _h = img.size
    step = max(1, w // 80)
    return all(_is_gutter_pixel(*cast(tuple[int, int, int], img.getpixel((x, y)))) for x in range(0, w, step))


def _trim_map_gutters(img: Image.Image) -> Image.Image:
    """Recorta bandas grises uniformes en los bordes del canvas capturado."""
    w, h = img.size
    left = 0
    while left < w - 20 and _column_is_gutter(img, left):
        left += 1
    right = w - 1
    while right > left + 20 and _column_is_gutter(img, right):
        right -= 1
    top = 0
    while top < h - 20 and _row_is_gutter(img, top):
        top += 1
    bottom = h - 1
    while bottom > top + 20 and _row_is_gutter(img, bottom):
        bottom -= 1
    return img.crop((left, top, right + 1, bottom + 1))


def _center_crop_to_aspect(img: Image.Image, width: int, height: int) -> Image.Image:
    """Recorte centrado al aspect ratio objetivo (centro geográfico del mapa)."""
    target_aspect = width / height
    w, h = img.size
    src_aspect = w / h
    if src_aspect > target_aspect:
        new_w = max(1, int(h * target_aspect))
        left = (w - new_w) // 2
        return img.crop((left, 0, left + new_w, h))
    if src_aspect < target_aspect:
        new_h = max(1, int(w / target_aspect))
        top = (h - new_h) // 2
        return img.crop((0, top, w, top + new_h))
    return img


def _normalize_map_screenshot(screenshot_bytes: bytes, width: int, height: int) -> bytes:
    """Canvas → recorte de márgenes + escala exacta. Usado en preview y export PDF."""
    with Image.open(BytesIO(screenshot_bytes)) as opened:
        img = opened.convert("RGB")
    if img.size != (width, height):
        img = _center_crop_to_aspect(img, width, height)
    img = _trim_map_gutters(img)
    if img.size != (width, height):
        img = img.resize((width, height), Image.Resampling.LANCZOS)
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _resolve_provider(map_opts: dict[str, Any] | None) -> str:
    """Per-call payload > env > default. Lets the user choose the backend at processing time."""
    if map_opts and map_opts.get("provider"):
        return str(map_opts["provider"]).lower()
    return os.environ.get("ANTARES_MAP_PROVIDER", _MAP_PROVIDER_DEFAULT).lower()


def _resolve_api_key(map_opts: dict[str, Any] | None) -> str | None:
    if map_opts:
        if map_opts.get("api_key"):
            return str(map_opts["api_key"])
        if map_opts.get("google_maps_key"):
            return str(map_opts["google_maps_key"])
    return os.environ.get("ANTARES_MAPS_API_KEY") or os.environ.get("ANTARES_GOOGLE_MAPS_KEY") or None


def _cap_fetch_size(width: int, height: int) -> tuple[int, int]:
    """Scale (width, height) down so the long side <= _MAP_FETCH_MAX_DIM, preserving aspect."""
    longest = max(width, height)
    if longest <= _MAP_FETCH_MAX_DIM:
        return max(1, width), max(1, height)
    scale = _MAP_FETCH_MAX_DIM / longest
    return max(1, round(width * scale)), max(1, round(height * scale))


def _redact_url_for_log(url: str) -> str:
    """Strip map API secrets from URLs before logging (query keys like key/token)."""
    try:
        parsed = urllib.parse.urlparse(url)
        if not parsed.query:
            return url
        pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        redacted: list[tuple[str, str]] = []
        sensitive = {"key", "access_token", "api_key", "token", "apikey"}
        for name, value in pairs:
            if name.lower() in sensitive:
                redacted.append((name, "***"))
            else:
                redacted.append((name, value))
        return urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode(redacted)))
    except Exception:
        return "<url redacted>"


def _http_get(url: str, headers: dict[str, str], timeout: int = _HTTP_TIMEOUT) -> bytes | None:
    """HTTP GET returning body bytes, or None on any network/HTTP error."""
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # trusted map endpoints
            return cast(bytes, resp.read())
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        logger.debug("HTTP GET failed for %s: %s", _redact_url_for_log(url), exc)
        return None


def _fallback_map_bytes(width: int, height: int) -> bytes:
    """Gray placeholder so composition still renders text + pin when the map fetch fails."""
    img = Image.new("RGB", (max(1, width), max(1, height)), (215, 215, 215))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _lonlat_to_webmercator_pixel(lon: float, lat: float, zoom: int) -> tuple[float, float]:
    """Web Mercator pixel (x, y) in the global tile pixel space at ``zoom``."""
    n = 2 ** zoom
    x = (lon + 180.0) / 360.0 * n * _OSM_TILE_SIZE
    lat_rad = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n * _OSM_TILE_SIZE
    return x, y


def _fetch_xyz_tiles_map(lat: float, lon: float, width: int, height: int, zoom: int, url_template: str, api_key: str = "") -> Image.Image:
    """Compose XYZ raster tiles centered on (lat, lon) into an RGB image of (width, height)."""
    cx, cy = _lonlat_to_webmercator_pixel(lon, lat, zoom)
    left = cx - width / 2
    top = cy - height / 2
    n = 2 ** zoom
    tile_x0 = int(left // _OSM_TILE_SIZE)
    tile_y0 = int(top // _OSM_TILE_SIZE)
    tile_x1 = int((left + width) // _OSM_TILE_SIZE)
    tile_y1 = int((top + height) // _OSM_TILE_SIZE)
    cols = tile_x1 - tile_x0 + 1
    rows = tile_y1 - tile_y0 + 1
    canvas = Image.new("RGB", (cols * _OSM_TILE_SIZE, rows * _OSM_TILE_SIZE), (218, 218, 218))
    headers = {"User-Agent": _HTTP_USER_AGENT}

    tile_jobs: list[tuple[int, int, str]] = []
    for ty in range(tile_y0, tile_y1 + 1):
        if ty < 0 or ty >= n:
            continue
        for tx in range(tile_x0, tile_x1 + 1):
            tx_mod = tx % n
            url = url_template.format(z=zoom, x=tx_mod, y=ty, key=urllib.parse.quote(api_key or ""))
            tile_jobs.append((tx - tile_x0, ty - tile_y0, url))

    def _download_tile(job: tuple[int, int, str]) -> tuple[int, int, Image.Image | None]:
        col, row, url = job
        tile_bytes = _http_get(url, headers)
        if not tile_bytes:
            return col, row, None
        try:
            with Image.open(BytesIO(tile_bytes)) as tile:
                decoded = tile.convert("RGB")
            return col, row, decoded
        except Exception:
            logger.debug("Tile decode failed for %s", _redact_url_for_log(url), exc_info=True)
            return col, row, None

    max_workers = min(_MAX_RENDER_WORKERS, max(len(tile_jobs), 1))
    with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="map-tile") as ex:
        for col, row, tile in ex.map(_download_tile, tile_jobs):
            if tile is not None:
                canvas.paste(tile, (col * _OSM_TILE_SIZE, row * _OSM_TILE_SIZE))

    offset_x = round(left - tile_x0 * _OSM_TILE_SIZE)
    offset_y = round(top - tile_y0 * _OSM_TILE_SIZE)
    return canvas.crop((offset_x, offset_y, offset_x + width, offset_y + height))


def _google_static_map_size(width: int, height: int) -> tuple[int, int]:
    """Fit a Google Static Maps viewport within 640x640 without distortion."""
    width = max(1, int(width))
    height = max(1, int(height))
    longest = max(width, height)
    if longest <= 640:
        return width, height
    scale = 640 / longest
    return max(1, round(width * scale)), max(1, round(height * scale))


def _fetch_google_static_map(lat: float, lon: float, width: int, height: int, zoom: int, key: str) -> Image.Image:
    """Fetch a Google Static Maps image centered on (lat, lon). Uses scale=2 for detail."""
    # Google caps the size parameter at 640x640; preserve the viewport aspect.
    req_w, req_h = _google_static_map_size(width, height)
    params = (
        f"?center={lat},{lon}&zoom={zoom}&size={req_w}x{req_h}&scale=2"
        f"&maptype=roadmap&format=png&key={urllib.parse.quote(key)}"
    )
    url = _GOOGLE_STATIC_URL + params
    data = _http_get(url, {"User-Agent": _HTTP_USER_AGENT})
    if not data:
        return Image.new("RGB", (width, height), (215, 215, 215))
    try:
        with Image.open(BytesIO(data)) as opened:
            return opened.convert("RGB")
    except Exception:
        logger.debug("Google Static Maps decode failed", exc_info=True)
        return Image.new("RGB", (width, height), (215, 215, 215))


def fetch_static_map(
    lat: float,
    lon: float,
    width: int,
    height: int,
    zoom: int = _MAP_ZOOM,
    *,
    provider: str = _MAP_PROVIDER_DEFAULT,
    api_key: str | None = None,
) -> bytes:
    """Return a PNG map image (capped fetch size) for (lat, lon) using the chosen provider.

    On any failure, returns a gray placeholder so downstream composition still renders.
    """
    fetch_w, fetch_h = _cap_fetch_size(width, height)
    try:
        if provider == "google":
            if not api_key:
                logger.warning("Google Static Maps seleccionado pero falta llave API; usando fallback.")
                return _fallback_map_bytes(fetch_w, fetch_h)
            img = _fetch_google_static_map(lat, lon, fetch_w, fetch_h, zoom, api_key)
        else:
            url_template = _XYZ_PROVIDERS.get(provider)
            if not url_template:
                logger.warning("Proveedor desconocido %s; haciendo fallback a OSM.", provider)
                url_template = _XYZ_PROVIDERS["osm"]

            # Most providers other than OSM require a key
            if provider != "osm" and not api_key:
                logger.warning("Proveedor %s requiere una llave API pero no se proporcionó. La petición de mapa probablemente fallará.", provider)

            img = _fetch_xyz_tiles_map(lat, lon, fetch_w, fetch_h, zoom, url_template, api_key or "")
        img = img.resize((fetch_w, fetch_h), Image.Resampling.LANCZOS) if img.size != (fetch_w, fetch_h) else img
        buf = BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except Exception:
        logger.exception("fetch_static_map falló para %s,%s; usando placeholder", lat, lon)
        return _fallback_map_bytes(fetch_w, fetch_h)


def _load_excel_data(excel_path: str) -> tuple[pd.DataFrame, tuple[Any, ...]]:
    """Load and parse Excel, reusing cache when the file has not changed."""
    mtime = os.path.getmtime(excel_path)
    with _cache_lock:
        cached = _excel_cache.get(excel_path)
        if cached and cached[0] == mtime:
            _excel_cache.move_to_end(excel_path)
            return cached[1], cached[2]
    df = pd.read_excel(excel_path, engine="openpyxl")
    cols = _parse_excel_columns(df)
    with _cache_lock:
        _excel_cache[excel_path] = (mtime, df, cols)
        _excel_cache.move_to_end(excel_path)
        _trim_cache(_excel_cache, _MAX_EXCEL_CACHE)
    return df, cols


def _coord_key(lat: float, lon: float) -> tuple[float, float]:
    return (round(lat, _COORD_PRECISION), round(lon, _COORD_PRECISION))


def _dimensions_for(formato: str, *, preview: bool = False) -> tuple[int, int, int]:
    """Retorna (out_w, out_h, footer_height). Preview escala proporcionalmente desde export."""
    spec = _REF_LAYOUT[formato]
    out_w = int(spec["out_w"])
    out_h = int(spec["out_h"])
    footer_h = int(spec["footer_h"])
    if not preview:
        return out_w, out_h, footer_h
    scale = int(spec["preview_w"]) / out_w
    prev_w = round(out_w * scale)
    prev_h = round(out_h * scale)
    map_h = round((out_h - footer_h) * scale)
    prev_footer = max(1, prev_h - map_h)
    return prev_w, prev_h, prev_footer


def _map_capture_size(formato: str, *, preview: bool = False) -> tuple[int, int]:
    """Viewport = área del mapa. Preview usa tamaño pantalla; export usa A4."""
    out_w, out_h, footer_h = _dimensions_for(formato, preview=preview)
    return out_w, out_h - footer_h


def _sync_excel_context(excel_path: str) -> tuple[str, float]:
    """Invalida caché de previews compuestos cuando cambia el Excel."""
    global _preview_excel_ctx
    ctx = (excel_path, os.path.getmtime(excel_path))
    if _preview_excel_ctx != ctx:
        with _cache_lock:
            _preview_composed_cache.clear()
        _preview_excel_ctx = ctx
    return ctx


def _manual_preview_ctx(datos: dict) -> tuple[Any, ...]:
    """Clave de caché única por fila manual (coords + textos)."""
    lat = float(datos["lat"])
    lon = float(datos["lon"])
    return (
        "manual",
        *_coord_key(lat, lon),
        str(datos.get("cod_componente", "")),
        str(datos.get("direccion", "")),
        str(datos.get("localidad", "")),
        str(datos.get("distrito", "")),
    )


def _trim_cache(cache: dict, max_size: int) -> None:
    while len(cache) > max_size:
        if isinstance(cache, OrderedDict):
            cache.popitem(last=False)
        else:
            del cache[next(iter(cache))]


def _get_cached_map_screenshot(
    lat: float,
    lon: float,
    formato: str,
    *,
    preview: bool = False,
    map_opts: dict[str, Any] | None = None,
) -> bytes:
    """Fetch (or reuse) a static map image for (lat, lon). No browser process needed."""
    key = _map_cache_key(lat, lon, formato, preview=preview, map_opts=map_opts)
    # El caché sólo guarda capturas que ya pasaron _screenshot_has_map_tiles
    # (ver gate de escritura más abajo), así que no re-validamos en cada hit.
    cached = _map_screenshot_cache.get(key)
    if cached is not None:
        return cached
    cap_w, cap_h = _map_capture_size(formato, preview=preview)
    provider = _resolve_provider(map_opts)
    zoom = int(map_opts["zoom"]) if map_opts and map_opts.get("zoom") is not None else _MAP_ZOOM
    screenshot = fetch_static_map(
        lat, lon, cap_w, cap_h, zoom,
        provider=provider, api_key=_resolve_api_key(map_opts),
    )
    # Shared LRU: one buffer per key. Working write first; upgrade if tiles OK.
    _map_screenshot_working_cache[key] = screenshot
    if _screenshot_has_map_tiles(screenshot):
        _map_screenshot_cache[key] = screenshot
    return screenshot


_MAX_UBIC_PREVIEW_FILES = 200


def _trim_ubicaciones_preview_files(cache_dir: Path) -> None:
    try:
        files = sorted(cache_dir.glob("*.jpg"), key=lambda p: p.stat().st_mtime)
        excess = len(files) - _MAX_UBIC_PREVIEW_FILES
        if excess <= 0:
            return
        for stale in files[:excess]:
            with contextlib.suppress(OSError):
                stale.unlink()
    except OSError:
        return


def _encode_preview_data(
    preview_img: Image.Image,
    datos: dict,
    *,
    row_index: int,
    total_filas: int,
    formato: str,
) -> dict[str, Any]:
    """Encode composed preview to JPEG.

    ``image`` is a CSP-safe ``data:`` URI for the renderer (Electron blocks
    ``file:`` in img-src). ``image_path`` keeps the on-disk cache entry used for
    composed-preview invalidation and optional Electron re-reads.
    """
    buf = BytesIO()
    preview_img.save(buf, format="JPEG", quality=88, optimize=True, subsampling=0)
    raw = buf.getvalue()

    cache_dir = Path(user_data_path("ubicaciones_preview_cache"))
    cache_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha1(raw).hexdigest()
    out_path = cache_dir / f"{digest}.jpg"
    if not out_path.is_file():
        tmp_path = out_path.with_suffix(".jpg.tmp")
        tmp_path.write_bytes(raw)
        tmp_path.replace(out_path)
        _trim_ubicaciones_preview_files(cache_dir)

    resolved = out_path.resolve()
    return {
        "image": f"data:image/jpeg;base64,{base64.b64encode(raw).decode('ascii')}",
        "image_path": str(resolved),
        "cod_componente": str(datos["cod_componente"]),
        "direccion": str(datos["direccion"]),
        "localidad": str(datos["localidad"]),
        "distrito": str(datos["distrito"]),
        "total_filas": total_filas,
        "row_index": row_index,
        "formato": formato,
    }


def _compose_and_cache_preview(
    excel_ctx: tuple[str, float],
    row_index: int,
    formato: str,
    datos: dict,
    screenshot_bytes: bytes,
    total_filas: int,
    custom_styles: dict | None = None,
    map_opts: dict[str, Any] | None = None,
) -> dict[str, Any]:
    preview_img = _compose_ubicacion_image(datos, formato, screenshot_bytes, preview=True, custom_styles=custom_styles)
    data = _encode_preview_data(
        preview_img,
        datos,
        row_index=row_index,
        total_filas=total_filas,
        formato=formato,
    )
    styles_hash = json.dumps(custom_styles, sort_keys=True) if custom_styles else ""
    cache_key = _composed_preview_key(excel_ctx, row_index, formato, styles_hash, map_opts)
    with _cache_lock:
        _preview_composed_cache[cache_key] = data
        _trim_cache(_preview_composed_cache, _MAX_COMPOSED_CACHE)
    return data


def _prefetch_alternate_formato(
    excel_ctx: tuple[str, float],
    row_index: int,
    formato: str,
    datos: dict,
    lat: float,
    lon: float,
    total_filas: int,
    custom_styles: dict | None = None,
    map_opts: dict | None = None,
) -> None:
    """Pre-compone la orientación opuesta en background (solo Pillow, sin Playwright)."""
    try:
        alt = "horizontal" if formato == "vertical" else "vertical"
        styles_hash = json.dumps(custom_styles, sort_keys=True) if custom_styles else ""
        cache_key = _composed_preview_key(excel_ctx, row_index, alt, styles_hash, map_opts)
        with _cache_lock:
            if cache_key in _preview_composed_cache:
                return
        map_bytes = _map_screenshot_cache.get(_map_cache_key(lat, lon, alt, preview=True, map_opts=map_opts))
        if map_bytes is None:
            return
        _compose_and_cache_preview(
            excel_ctx, row_index, alt, datos, map_bytes, total_filas,
            custom_styles=custom_styles, map_opts=map_opts,
        )
    except Exception:
        logger.debug("Prefetch orientación alterna falló", exc_info=True)


# Acota el prefetch de orientación alterna: a lo sumo _MAX_PREFETCH_THREADS
# prefetches concurrentes, y los hilos son daemon para no retrasar el shutdown
# del backend (un fetch de tiles puede tardar hasta _HTTP_TIMEOUT).
_MAX_PREFETCH_THREADS = 2
_prefetch_slots = threading.BoundedSemaphore(_MAX_PREFETCH_THREADS)


def _spawn_prefetch(*args: Any, **kwargs: Any) -> None:
    """Lanza el prefetch si hay cupo; si no, se descarta (optimización best-effort)."""
    if not _prefetch_slots.acquire(blocking=False):
        return

    def _run() -> None:
        try:
            _prefetch_alternate_formato(*args, **kwargs)
        finally:
            _prefetch_slots.release()

    threading.Thread(
        target=_run,
        daemon=True,
        name="ubic-prefetch",
    ).start()

# pin.png is a static asset; cache the decoded RGBA image to avoid re-reading
# and re-decoding on every Excel row during batch export.
_pin_cache: Image.Image | None = None


def _get_pin_rgba() -> Image.Image | None:
    """Return the cached pin.png as RGBA, loading it once on first access."""
    global _pin_cache
    if _pin_cache is None:
        pin_path = os.path.join(resource_path("assets/ubicaciones"), "pin.png")
        if os.path.exists(pin_path):
            with Image.open(pin_path) as opened:
                _pin_cache = opened.convert("RGBA")
    return _pin_cache


# ── Map source ───────────────────────────────────────────────────────────────
# The map image is now fetched from a static-map provider (OSM tiles or Google
# Static Maps) via fetch_static_map() — see the constants block above. This
# replaced the persistent Playwright/Chromium browser, which was too heavy for
# the installer and broken in production (no bundled Chromium). No browser
# process, warmup, or shutdown lifecycle is needed anymore.


def _compose_ubicacion_image(
    datos: dict,
    formato: str,
    screenshot_bytes: bytes,
    *,
    preview: bool = False,
    custom_styles: dict | None = None,
) -> Image.Image:
    """Compone mapa + textos + pin + footer. Preview y export usan la misma lógica
    escalada proporcionalmente (preview ≈ miniatura fiel del PDF exportado).

    ``custom_styles`` (optional) overrides text appearance (per-field fontSize,
    bold, color, offsetX, offsetY, visible), pin (color, scale, offsets,
    visible), overlay (alpha, color), and layout (yStart, lineSpacing, lineGap).
    When ``None`` or empty, the original hardcoded defaults are used.
    """
    spec = _REF_LAYOUT[formato]
    out_w, out_h, footer_height = _dimensions_for(formato, preview=preview)
    scale = out_w / int(spec["out_w"])

    # ── Custom styles extraction ──
    cs_texts = (custom_styles or {}).get("texts", {})
    cs_pin = (custom_styles or {}).get("pin", {})
    cs_map = (custom_styles or {}).get("map", {})
    cs_layout = (custom_styles or {}).get("layout", {})

    final_img = Image.new("RGB", (out_w, out_h), _BG_RGB)

    map_height = out_h - footer_height
    with Image.open(BytesIO(screenshot_bytes)) as opened:
        mapa = opened.convert("RGBA")
    resample = Image.Resampling.LANCZOS
    target_map_size = (out_w, map_height)
    if mapa.size != target_map_size:
        mapa = mapa.resize(target_map_size, resample)

    overlay_alpha = cs_map.get("overlayAlpha", _MAP_OVERLAY_ALPHA)
    overlay_color = _hex_to_rgb(cs_map["overlayColor"]) if "overlayColor" in cs_map else _BG_RGB
    overlay = Image.new("RGBA", (out_w, map_height), (*overlay_color, overlay_alpha))
    mapa_con_overlay = Image.alpha_composite(mapa, overlay)
    final_img.paste(mapa_con_overlay.convert("RGB"), (0, 0))

    footer_img = _get_footer_image(out_w, footer_height)
    draw = ImageDraw.Draw(final_img)
    if footer_img is not None:
        final_img.paste(footer_img, (0, out_h - footer_height))
    else:
        draw.rectangle([0, out_h - footer_height, out_w, out_h], fill=(0, 0, 0))

    border_w = max(1, round(int(spec["border"]) * scale))
    draw.rectangle([0, 0, out_w - 1, out_h - 1], outline=(0, 0, 0), width=border_w)

    # ── Text fields ──
    cod = str(datos.get("cod_componente", ""))
    dir_str = str(datos.get("direccion", ""))
    loc = str(datos.get("localidad", ""))
    dist = str(datos.get("distrito", ""))

    y_start = round(cs_layout.get("yStart", int(spec["y_start"])) * scale)
    line_spacing = round(cs_layout.get("lineSpacing", int(spec["line_spacing"])) * scale)
    line_gap = cs_layout.get("lineGap", float(spec["line_gap"]))

    def _draw_field(field: str, text: str, default_size: int, y_pos: int, *, is_large: bool = False) -> None:
        """Draw a single text field with per-field style overrides."""
        ts = cs_texts.get(field, {})
        if not ts.get("visible", True):
            return
        font_size = max(8, round(ts.get("fontSize", default_size) * scale))
        bold = ts.get("bold", True)
        color = _hex_to_rgb(ts["color"]) if "color" in ts else (0, 0, 0)
        offset_x = round(ts.get("offsetX", 0) * scale)
        offset_y = round(ts.get("offsetY", 0) * scale)
        stroke_key = "stroke_large" if is_large else "stroke_medium"
        stroke_w = max(1, round(int(spec[stroke_key]) * scale))
        font = _get_font(bold, font_size)
        bbox = draw.textbbox((0, 0), text, font=font)
        w_text = bbox[2] - bbox[0]
        x = (out_w - w_text) // 2 + offset_x
        y = y_pos + offset_y
        if field == "direccion" and w_text > out_w * 0.8:
            x = int(out_w * 0.1) + offset_x
        draw.text((x, y), text, fill=color, font=font, stroke_width=stroke_w, stroke_fill=(255, 255, 255))

    y_text = y_start
    _draw_field("cod_componente", cod, int(spec["font_large"]), y_text, is_large=True)

    y_text += line_spacing
    _draw_field("direccion", dir_str, int(spec["font_medium"]), y_text)

    y_text += round(line_spacing * line_gap)
    _draw_field("localidad", loc, int(spec["font_medium"]), y_text)

    y_text += round(line_spacing * line_gap)
    _draw_field("distrito", dist, int(spec["font_medium"]), y_text)

    # ── Pin ──
    if cs_pin.get("visible", True):
        pin = _get_pin_rgba()
        if pin is not None:
            pin_scale_val = cs_pin.get("scale", float(spec["pin_scale"]))
            new_pin_w = max(1, int(out_w * pin_scale_val))
            new_pin_h = max(1, int(pin.height * (new_pin_w / pin.width)))
            pin_resized = pin.resize((new_pin_w, new_pin_h), resample)
            pin_color_hex = cs_pin.get("color")
            if pin_color_hex:
                pin_resized = _colorize_pin(pin_resized, _hex_to_rgb(pin_color_hex))
            pin_offset_x = round(cs_pin.get("offsetX", 0) * scale)
            pin_offset_y = round(cs_pin.get("offsetY", 0) * scale)
            pin_x = round(out_w / 2 - new_pin_w * _PIN_TIP_X_RATIO) + pin_offset_x
            pin_y = round(map_height / 2 - new_pin_h * _PIN_TIP_RATIO) + pin_offset_y
            final_img.paste(pin_resized, (pin_x, pin_y), mask=pin_resized)

    return final_img


def render_ubicacion(
    datos: dict,
    formato: str,
    *,
    preview: bool = False,
    map_opts: dict[str, Any] | None = None,
    custom_styles: dict | None = None,
) -> Image.Image:
    """Pipeline único: captura mapa + composición WYSIWYG (preview o export)."""
    lat = float(datos["lat"])
    lon = float(datos["lon"])
    screenshot_bytes = _get_cached_map_screenshot(lat, lon, formato, preview=preview, map_opts=map_opts)
    return _compose_ubicacion_image(datos, formato, screenshot_bytes, preview=preview, custom_styles=custom_styles)


def render_imagen_ubicacion(
    datos: dict,
    formato: str,
    map_opts: dict[str, Any] | None = None,
    custom_styles: dict | None = None,
) -> Image.Image:
    """Renderiza la imagen final A4 con mapa, textos, pin y footer."""
    return render_ubicacion(datos, formato, preview=False, map_opts=map_opts, custom_styles=custom_styles)


def generar_imagen_ubicacion(
    datos: dict,
    output_path: str,
    formato: str,
    map_opts: dict[str, Any] | None = None,
    custom_styles: dict | None = None,
) -> None:
    """Genera la imagen y la guarda como PDF."""
    final_img = render_imagen_ubicacion(datos, formato, map_opts=map_opts, custom_styles=custom_styles)
    final_img.convert("RGB").save(output_path, "PDF", resolution=300.0)


def _output_pdf_filename(cod_componente: str) -> str:
    """Construye el nombre de archivo PDF para un cod_componente.

    Sanitiza los caracteres inválidos en Windows (:*?\"<>|) y los separadores
    de path vía ``sanitizar_nombre``. Antes sólo se reemplazaban ``/`` y ``\\``,
    por lo que un cod_componente como ``"A:B"`` producía ``A:B.pdf`` y
    ``PIL.save`` levantaba OSError (Errno 22) en Windows, abortando el batch
    entero de ubicaciones.
    """
    safe_stem = sanitizar_nombre(str(cod_componente)) or "ubicacion"
    return f"{safe_stem}.pdf"


_COMBINED_COORD_URL_PATTERNS = (
    re.compile(r"[@?](-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)"),
    re.compile(r"[?&]q=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)"),
    re.compile(r"[?&]center=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)"),
)


def _parse_combined_coord_value(val: Any) -> tuple[float | None, float | None]:
    """Extrae lat/lon de una celda combinada (par numérico o URL de mapas)."""
    if val is None or pd.isna(val):
        return None, None
    text = str(val).strip()
    if not text:
        return None, None
    for pattern in _COMBINED_COORD_URL_PATTERNS:
        match = pattern.search(text)
        if match:
            lat = _coerce_coord(match.group(1))
            lon = _coerce_coord(match.group(2))
            if lat is not None and lon is not None:
                return lat, lon
    parts = text.split(",")
    if len(parts) < 2:
        return None, None
    return _coerce_coord(parts[0].strip()), _coerce_coord(parts[1].strip())


def _unique_pdf_filename(cod_componente: str, used_stems: dict[str, int]) -> str:
    """Asigna un nombre PDF único; añade sufijo numérico si el código se repite."""
    stem = sanitizar_nombre(str(cod_componente)) or "ubicacion"
    count = used_stems.get(stem, 0)
    used_stems[stem] = count + 1
    if count == 0:
        return f"{stem}.pdf"
    return f"{stem}_{count + 1}.pdf"


def _coerce_coord(value: Any) -> float | None:
    """Coerce una celda de lat/lon a ``float``, o ``None`` si falta o no es
    numérica. ``pd.isna`` sólo rechaza NaN/None, no strings como ``"abc"``;
    sin este guard el worker llamaba ``float(datos['lat'])`` y crasheaba con
    ValueError, abortando el batch entero de ubicaciones.
    """
    if value is None or pd.isna(value):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_excel_columns(df):
    """Detecta las columnas del Excel normalizando nombres."""
    df.columns = [str(c).strip().lower() for c in df.columns]

    col_cod = next((c for c in df.columns if 'cod' in c or 'componente' in c), None)
    col_dir = next((c for c in df.columns if 'direcci' in c), None)
    col_loc = next((c for c in df.columns if 'localidad' in c or 'urb' in c), None)
    col_dist = next((c for c in df.columns if 'distrito' in c), None)
    col_lat = next((c for c in df.columns if 'lat' in c), None)
    col_lon = next((c for c in df.columns if 'lon' in c), None)

    if not col_lat or not col_lon:
        col_coord = next((c for c in df.columns if 'coord' in c or 'link' in c), None)
        if col_coord:
            parsed = df[col_coord].apply(_parse_combined_coord_value)
            df["lat_tmp"] = parsed.apply(lambda pair: pair[0])
            df["lon_tmp"] = parsed.apply(lambda pair: pair[1])
            col_lat = 'lat_tmp'
            col_lon = 'lon_tmp'
        else:
            return None, None, None, None, None, None

    return col_cod, col_dir, col_loc, col_dist, col_lat, col_lon

def _extract_row_data(row, index, col_cod, col_dir, col_loc, col_dist, col_lat, col_lon):
    """Extrae los datos de una fila del DataFrame."""
    return {
        'cod_componente': row[col_cod] if col_cod and pd.notna(row[col_cod]) else f"ID-{index+1}",
        'direccion': row[col_dir] if col_dir and pd.notna(row[col_dir]) else "",
        'localidad': row[col_loc] if col_loc and pd.notna(row[col_loc]) else "",
        'distrito': row[col_dist] if col_dist and pd.notna(row[col_dist]) else "",
        'lat': row[col_lat],
        'lon': row[col_lon]
    }

def handle_preview_ubicacion(payload: dict) -> dict:
    """Genera vista previa WYSIWYG: compone igual que el PDF y reduce para pantalla."""
    try:
        excel_path = payload.get("excelPath")
        manual_data = payload.get("manualData")
        formato = payload.get("formato", "vertical")
        row_index = payload.get("rowIndex", 0)
        recompose_only = bool(payload.get("recomposeOnly", False))
        map_opts = {
            "provider": payload.get("provider"),
            "zoom": payload.get("zoom"),
            "api_key": payload.get("api_key")
        }
        custom_styles = payload.get("customStyles") or None

        if not excel_path and not manual_data:
            return {"success": False, "error": "Falta la ruta del Excel o datos manuales."}

        if manual_data:
            datos = {
                'cod_componente': str(manual_data.get('cod_componente', '')).strip(),
                'direccion': str(manual_data.get('direccion', '')).strip(),
                'localidad': str(manual_data.get('localidad', '')).strip(),
                'distrito': str(manual_data.get('distrito', '')).strip(),
                'lat': _coerce_coord(manual_data.get('lat')),
                'lon': _coerce_coord(manual_data.get('lon')),
            }
            total_filas = 1
            row_index = 0
        else:
            if not isinstance(excel_path, str) or not excel_path:
                return {"success": False, "error": "Falta la ruta del Excel o datos manuales."}
            df, (col_cod, col_dir, col_loc, col_dist, col_lat, col_lon) = _load_excel_data(excel_path)
            total_filas = len(df)

            if col_lat is None:
                return {"success": False, "error": "El Excel debe tener columnas 'latitud' y 'longitud'."}

            if row_index >= total_filas:
                return {"success": False, "error": "No hay mas filas para previsualizar.", "total_filas": total_filas}

            row = df.iloc[row_index]
            datos = _extract_row_data(row, row_index, col_cod, col_dir, col_loc, col_dist, col_lat, col_lon)
            excel_ctx = _sync_excel_context(excel_path)

        lat = _coerce_coord(datos["lat"])
        lon = _coerce_coord(datos["lon"])
        if lat is None or lon is None:
            return {"success": False, "error": "La fila no tiene coordenadas validas.", "total_filas": total_filas}
        datos["lat"] = lat
        datos["lon"] = lon

        lat = float(lat)
        lon = float(lon)
        excel_ctx = _manual_preview_ctx(datos) if manual_data else excel_ctx
        styles_hash = json.dumps(custom_styles, sort_keys=True) if custom_styles else ""
        composed_key = _composed_preview_key(excel_ctx, row_index, formato, styles_hash, map_opts)

        cached_preview = _preview_composed_cache.get(composed_key)
        if cached_preview is not None:
            cached_path = str(cached_preview.get("image_path") or "")
            if cached_path and Path(cached_path).is_file():
                return {"success": True, "data": cached_preview}
            with _cache_lock:
                _preview_composed_cache.pop(composed_key, None)

        if recompose_only:
            map_key = _map_cache_key(lat, lon, formato, preview=True, map_opts=map_opts)
            cached_map = _map_screenshot_cache.get(map_key) or _map_screenshot_working_cache.get(map_key)
            if cached_map is not None:
                data = _compose_and_cache_preview(
                    excel_ctx, row_index, formato, datos, cached_map, total_filas,
                    custom_styles=custom_styles, map_opts=map_opts,
                )
                return {"success": True, "data": data}

        screenshot_bytes = _get_cached_map_screenshot(lat, lon, formato, preview=True, map_opts=map_opts)
        data = _compose_and_cache_preview(
            excel_ctx, row_index, formato, datos, screenshot_bytes, total_filas,
            custom_styles=custom_styles, map_opts=map_opts,
        )

        _spawn_prefetch(
            excel_ctx, row_index, formato, datos, lat, lon, total_filas,
            custom_styles=custom_styles, map_opts=map_opts,
        )
        return {"success": True, "data": data}
    except Exception as e:
        logger.exception("Error generando preview de ubicacion")
        return {"success": False, "error": str(e)}

_CONSOLIDATED_PDF_NAME = "ubicaciones_consolidado.pdf"


def _consolidated_pdf_permission_error(path: str) -> PermissionError:
    return PermissionError(
        f"No se pudo guardar el PDF consolidado en '{path}'. "
        "Cierra el archivo si está abierto en un visor PDF o en el Explorador de Windows e intenta de nuevo."
    )


def _is_destination_locked(err: OSError) -> bool:
    """True when the destination file is locked/in-use (Windows sharing violation or EACCES)."""
    if getattr(err, "errno", None) in (13, getattr(errno, "EACCES", 13)):
        return True
    winerror = getattr(err, "winerror", None)
    return winerror in (32, 33)  # ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION


def _save_consolidated_pdf(images: list[Image.Image], output_dir: str) -> str:
    """Guarda páginas como PDF multi-hoja. Escribe primero a un temporal y
    reemplaza atómicamente para evitar PDFs parciales. Si el destino está
    bloqueado (p. ej. abierto en Edge/Adobe), intenta un nombre alternativo."""
    if not images:
        raise ValueError("No hay imágenes para guardar en el PDF consolidado.")

    first_img = images[0]
    append_imgs = images[1:] if len(images) > 1 else []
    base_path = os.path.join(output_dir, _CONSOLIDATED_PDF_NAME)
    tmp_path = base_path + ".antares-tmp"

    try:
        first_img.save(
            tmp_path,
            "PDF",
            resolution=300.0,
            save_all=True,
            append_images=append_imgs,
        )
    except Exception:
        if os.path.exists(tmp_path):
            with contextlib.suppress(OSError):
                os.remove(tmp_path)
        raise

    candidates = [base_path] + [
        os.path.join(output_dir, f"ubicaciones_consolidado_{n}.pdf")
        for n in range(2, 51)
    ]
    last_err: OSError | None = None
    for dest in candidates:
        try:
            os.replace(tmp_path, dest)
            return dest
        except OSError as err:
            last_err = err
            if not _is_destination_locked(err):
                break

    with contextlib.suppress(OSError):
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    if last_err is not None and _is_destination_locked(last_err):
        raise _consolidated_pdf_permission_error(base_path) from last_err
    if last_err is not None:
        raise last_err
    raise _consolidated_pdf_permission_error(base_path)


def handle_generar_ubicaciones(payload: dict) -> dict:
    try:
        excel_path = payload.get("excelPath")
        manual_data = payload.get("manualData")
        output_dir = payload.get("outputDir")
        formato = payload.get("formato", "vertical")
        consolidado = payload.get("consolidado", False)
        map_opts = {
            "provider": payload.get("provider"),
            "zoom": payload.get("zoom"),
            "api_key": payload.get("api_key")
        }
        custom_styles = payload.get("customStyles") or None

        if not output_dir or (not excel_path and not manual_data):
            return {"success": False, "error": "Faltan rutas de entrada/salida o datos manuales."}

        os.makedirs(output_dir, exist_ok=True)

        valid_rows: list[dict] = []

        if manual_data:
            datos = {
                'cod_componente': str(manual_data.get('cod_componente', '')).strip(),
                'direccion': str(manual_data.get('direccion', '')).strip(),
                'localidad': str(manual_data.get('localidad', '')).strip(),
                'distrito': str(manual_data.get('distrito', '')).strip(),
                'lat': _coerce_coord(manual_data.get('lat')),
                'lon': _coerce_coord(manual_data.get('lon')),
            }
            if pd.notna(datos["lat"]) and pd.notna(datos["lon"]):
                valid_rows.append(datos)
        else:
            if not isinstance(excel_path, str) or not excel_path:
                return {"success": False, "error": "Faltan rutas de entrada/salida o datos manuales."}
            df, (col_cod, col_dir, col_loc, col_dist, col_lat, col_lon) = _load_excel_data(excel_path)

            if col_lat is None:
                return {"success": False, "error": "El Excel debe tener columnas 'latitud' y 'longitud'."}

            for index, row in df.iterrows():
                datos = _extract_row_data(row, index, col_cod, col_dir, col_loc, col_dist, col_lat, col_lon)
                lat = _coerce_coord(datos["lat"])
                lon = _coerce_coord(datos["lon"])
                if lat is None or lon is None:
                    continue
                datos["lat"] = lat
                datos["lon"] = lon
                valid_rows.append(datos)

        if not valid_rows:
            return {"success": False, "error": "No hay filas con coordenadas validas para generar."}

        if not consolidado:
            used_stems: dict[str, int] = {}
            for row_data in valid_rows:
                row_data["_out_filename"] = _unique_pdf_filename(row_data["cod_componente"], used_stems)

        generados = 0
        fallidos = 0
        consolidated_images: list[Image.Image] = []

        def _render_one(d: dict) -> tuple[bool, Image.Image | None]:
            """Renderiza (y guarda en no-consolidado) una fila. Devuelve
            ``(ok, img)``: img sólo en modo consolidado y ok. Una fila que
            falle se aísla (no aborta el batch vía ex.map)."""
            logger.info(f"Procesando {d['cod_componente']} en {d['lat']}, {d['lon']}...")
            t0 = time.perf_counter()
            try:
                if consolidado:
                    return (True, render_imagen_ubicacion(d, formato, map_opts=map_opts, custom_styles=custom_styles).convert("RGB"))
                out_path = os.path.join(output_dir, d["_out_filename"])
                generar_imagen_ubicacion(d, out_path, formato, map_opts=map_opts, custom_styles=custom_styles)
                return (True, None)
            except Exception:
                logger.exception("Error renderizando ubicación %s; se omite", d["cod_componente"])
                return (False, None)
            finally:
                logger.info(
                    "Ubicacion %s renderizada en %.1fs",
                    d["cod_componente"],
                    time.perf_counter() - t0,
                )

        if valid_rows:
            max_workers = min(_MAX_RENDER_WORKERS, len(valid_rows))
            # ThreadPoolExecutor local: map() preserva orden de submission → orden
            # de páginas en el PDF consolidado. Las caches mutables ya están
            # protegidas por _cache_lock (mismo patrón que el daemon de prefetch).
            # _render_one atrapa sus propias excepciones y devuelve (False, None),
            # así que una fila que falle no aborta las demás ni el consolidado.
            with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="ubic-render") as ex:
                for ok, img in ex.map(_render_one, valid_rows):
                    if ok:
                        generados += 1
                        if consolidado and img is not None:
                            consolidated_images.append(img)
                    else:
                        fallidos += 1

        consolidated_path: str | None = None
        if consolidado and consolidated_images:
            consolidated_path = _save_consolidated_pdf(consolidated_images, output_dir)
            logger.info(f"PDF consolidado generado: {consolidated_path} ({generados} paginas)")

        return {
            "success": True,
            "data": {
                "generados": generados,
                "fallidos": fallidos,
                "outputDir": output_dir,
                "consolidado": consolidado,
                "consolidatedPath": consolidated_path,
            },
        }
    except Exception as e:
        logger.exception("Error generando ubicaciones")
        return {"success": False, "error": str(e)}

HANDLERS: dict[str, Any] = {
    "generar_ubicaciones": handle_generar_ubicaciones,
    "preview_ubicacion": handle_preview_ubicacion,
}
