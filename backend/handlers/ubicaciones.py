import base64
import logging
import math
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from typing import Any, cast

import pandas as pd
from PIL import Image, ImageDraw, ImageFont

from backend.utils.paths import resource_path
from backend.utils.validators import sanitizar_nombre

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
_PIN_TIP_RATIO = 0.884  # punta del pin.png medida en assets/ubicaciones/pin.png
_MAP_OVERLAY_ALPHA = 120
_BG_RGB = (246, 246, 246)

# ── Asset caches (fonts, footers, excel) ─────────────────────────────────────
_font_cache: dict[tuple[str, int], ImageFont.FreeTypeFont | ImageFont.ImageFont] = {}
_footer_cache: dict[tuple[int, int, int], Image.Image | None] = {}
_excel_cache: dict[str, tuple[float, pd.DataFrame, tuple[Any, ...]]] = {}
_map_screenshot_cache: dict[tuple[Any, ...], bytes] = {}
_preview_composed_cache: dict[tuple[int, int, tuple[str, float], int, str], dict[str, Any]] = {}
_preview_excel_ctx: tuple[str, float] | None = None
# Guarda las caches mutadas desde el thread daemon de prefetch (B1): sin lock,
# _trim_cache + __setitem__ concurrentes pueden lanzar RuntimeError o corromper
# el orden LRU.
_cache_lock = threading.Lock()
_MAX_MAP_CACHE = 40
_MAX_COMPOSED_CACHE = 80
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
_OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
_GOOGLE_STATIC_URL = "https://maps.googleapis.com/maps/api/staticmap"
_HTTP_USER_AGENT = "ANTARES/0.10 (ubicaciones static map; +https://github.com/sechgio/antares)"
_HTTP_TIMEOUT = 12


def _get_font(bold: bool, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    key = ("arialbd" if bold else "arial", size)
    if key not in _font_cache:
        try:
            _font_cache[key] = ImageFont.truetype(f"{key[0]}.ttf", size)
        except Exception:
            try:
                _font_cache[key] = ImageFont.truetype("arial.ttf", size)
            except Exception:
                _font_cache[key] = ImageFont.load_default()
    return _font_cache[key]


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


def _get_footer_image(width: int, height: int) -> Image.Image | None:
    """Pega logo_footer.png en barra negra; escala por ancho (como plantillas JPG)."""
    key = (_FOOTER_LAYOUT_VERSION, width, height)
    if key not in _footer_cache:
        assets_dir = resource_path("assets/ubicaciones")
        logo_path = os.path.join(assets_dir, "logo_footer.png")
        if not os.path.exists(logo_path):
            logo_path = os.path.join(assets_dir, "footer_horizontal.png")
        if os.path.exists(logo_path):
            src = Image.open(logo_path).convert("RGBA")
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
            _footer_cache[key] = footer
        else:
            _footer_cache[key] = None
    return _footer_cache[key]


def _map_cache_key(lat: float, lon: float, formato: str, *, preview: bool) -> tuple[Any, ...]:
    cap_w, cap_h = _map_capture_size(formato, preview=preview)
    return (_MAP_CAPTURE_VERSION, *_coord_key(lat, lon), formato, cap_w, cap_h)


def _screenshot_has_map_tiles(screenshot_bytes: bytes) -> bool:
    """Rechaza capturas con cuadrícula gris sin calles cargadas."""
    img = Image.open(BytesIO(screenshot_bytes)).convert("RGB")
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
    img = Image.open(BytesIO(screenshot_bytes)).convert("RGB")
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


def _resolve_google_key(map_opts: dict[str, Any] | None) -> str | None:
    if map_opts and map_opts.get("google_maps_key"):
        return str(map_opts["google_maps_key"])
    return os.environ.get("ANTARES_GOOGLE_MAPS_KEY") or None


def _cap_fetch_size(width: int, height: int) -> tuple[int, int]:
    """Scale (width, height) down so the long side <= _MAP_FETCH_MAX_DIM, preserving aspect."""
    longest = max(width, height)
    if longest <= _MAP_FETCH_MAX_DIM:
        return max(1, width), max(1, height)
    scale = _MAP_FETCH_MAX_DIM / longest
    return max(1, round(width * scale)), max(1, round(height * scale))


def _http_get(url: str, headers: dict[str, str], timeout: int = _HTTP_TIMEOUT) -> bytes | None:
    """HTTP GET returning body bytes, or None on any network/HTTP error."""
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # trusted map endpoints
            return cast(bytes, resp.read())
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        logger.debug("HTTP GET failed for %s: %s", url, exc)
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


def _fetch_osm_tiles_map(lat: float, lon: float, width: int, height: int, zoom: int) -> Image.Image:
    """Compose OSM raster tiles centered on (lat, lon) into an RGB image of (width, height)."""
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
    for ty in range(tile_y0, tile_y1 + 1):
        if ty < 0 or ty >= n:  # out of range near the poles
            continue
        for tx in range(tile_x0, tile_x1 + 1):
            tx_mod = tx % n  # wrap longitude
            url = _OSM_TILE_URL.format(z=zoom, x=tx_mod, y=ty)
            tile_bytes = _http_get(url, headers)
            if not tile_bytes:
                continue
            try:
                tile = Image.open(BytesIO(tile_bytes)).convert("RGB")
                canvas.paste(tile, ((tx - tile_x0) * _OSM_TILE_SIZE, (ty - tile_y0) * _OSM_TILE_SIZE))
            except Exception:
                logger.debug("Tile decode failed for %s", url, exc_info=True)
    offset_x = round(left - tile_x0 * _OSM_TILE_SIZE)
    offset_y = round(top - tile_y0 * _OSM_TILE_SIZE)
    return canvas.crop((offset_x, offset_y, offset_x + width, offset_y + height))


def _fetch_google_static_map(lat: float, lon: float, width: int, height: int, zoom: int, key: str) -> Image.Image:
    """Fetch a Google Static Maps image centered on (lat, lon). Uses scale=2 for detail."""
    # Google caps a single tile at 640x640; scale=2 yields up to 1280x1280 pixels.
    req_w = min(width, 640)
    req_h = min(height, 640)
    params = (
        f"?center={lat},{lon}&zoom={zoom}&size={req_w}x{req_h}&scale=2"
        f"&maptype=roadmap&format=png&key={urllib.parse.quote(key)}"
    )
    url = _GOOGLE_STATIC_URL + params
    data = _http_get(url, {"User-Agent": _HTTP_USER_AGENT})
    if not data:
        return Image.new("RGB", (width, height), (215, 215, 215))
    try:
        return Image.open(BytesIO(data)).convert("RGB")
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
    google_key: str | None = None,
) -> bytes:
    """Return a PNG map image (capped fetch size) for (lat, lon) using the chosen provider.

    On any failure, returns a gray placeholder so downstream composition still renders.
    """
    fetch_w, fetch_h = _cap_fetch_size(width, height)
    try:
        if provider == "google":
            if not google_key:
                logger.warning("Google Static Maps seleccionado pero falta ANTARES_GOOGLE_MAPS_KEY; usando fallback.")
                return _fallback_map_bytes(fetch_w, fetch_h)
            img = _fetch_google_static_map(lat, lon, fetch_w, fetch_h, zoom, google_key)
        else:
            img = _fetch_osm_tiles_map(lat, lon, fetch_w, fetch_h, zoom)
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
    cached = _excel_cache.get(excel_path)
    if cached and cached[0] == mtime:
        return cached[1], cached[2]
    df = pd.read_excel(excel_path, engine="openpyxl")
    cols = _parse_excel_columns(df)
    _excel_cache[excel_path] = (mtime, df, cols)
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


def _trim_cache(cache: dict, max_size: int) -> None:
    while len(cache) > max_size:
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
    key = _map_cache_key(lat, lon, formato, preview=preview)
    # El caché sólo guarda capturas que ya pasaron _screenshot_has_map_tiles
    # (ver gate de escritura más abajo), así que no re-validamos en cada hit.
    cached = _map_screenshot_cache.get(key)
    if cached is not None:
        return cached
    cap_w, cap_h = _map_capture_size(formato, preview=preview)
    provider = _resolve_provider(map_opts)
    screenshot = fetch_static_map(
        lat, lon, cap_w, cap_h, _MAP_ZOOM,
        provider=provider, google_key=_resolve_google_key(map_opts),
    )
    if _screenshot_has_map_tiles(screenshot):
        with _cache_lock:
            _map_screenshot_cache[key] = screenshot
            _trim_cache(_map_screenshot_cache, _MAX_MAP_CACHE)
    return screenshot


def _encode_preview_data(
    preview_img: Image.Image,
    datos: dict,
    *,
    row_index: int,
    total_filas: int,
    formato: str,
) -> dict[str, Any]:
    buf = BytesIO()
    preview_img.save(buf, format="JPEG", quality=88, optimize=True, subsampling=0)
    img_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return {
        "image": f"data:image/jpeg;base64,{img_b64}",
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
) -> dict[str, Any]:
    preview_img = _compose_ubicacion_image(datos, formato, screenshot_bytes, preview=True)
    data = _encode_preview_data(
        preview_img,
        datos,
        row_index=row_index,
        total_filas=total_filas,
        formato=formato,
    )
    with _cache_lock:
        _preview_composed_cache[(_FOOTER_LAYOUT_VERSION, _MAP_CAPTURE_VERSION, excel_ctx, row_index, formato)] = data
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
) -> None:
    """Pre-compone la orientación opuesta en background (solo Pillow, sin Playwright)."""
    try:
        alt = "horizontal" if formato == "vertical" else "vertical"
        cache_key = (_FOOTER_LAYOUT_VERSION, _MAP_CAPTURE_VERSION, excel_ctx, row_index, alt)
        if cache_key in _preview_composed_cache:
            return
        map_bytes = _map_screenshot_cache.get(_map_cache_key(lat, lon, alt, preview=True))
        if map_bytes is None:
            return
        _compose_and_cache_preview(excel_ctx, row_index, alt, datos, map_bytes, total_filas)
    except Exception:
        logger.debug("Prefetch orientación alterna falló", exc_info=True)

# pin.png is a static asset; cache the decoded RGBA image to avoid re-reading
# and re-decoding on every Excel row during batch export.
_pin_cache: Image.Image | None = None


def _get_pin_rgba() -> Image.Image | None:
    """Return the cached pin.png as RGBA, loading it once on first access."""
    global _pin_cache
    if _pin_cache is None:
        pin_path = os.path.join(resource_path("assets/ubicaciones"), "pin.png")
        if os.path.exists(pin_path):
            _pin_cache = Image.open(pin_path).convert("RGBA")
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
) -> Image.Image:
    """Compone mapa + textos + pin + footer. Preview y export usan la misma lógica
    escalada proporcionalmente (preview ≈ miniatura fiel del PDF exportado)."""
    spec = _REF_LAYOUT[formato]
    out_w, out_h, footer_height = _dimensions_for(formato, preview=preview)
    scale = out_w / int(spec["out_w"])

    final_img = Image.new("RGB", (out_w, out_h), _BG_RGB)

    map_height = out_h - footer_height
    mapa = Image.open(BytesIO(screenshot_bytes)).convert("RGBA")
    resample = Image.Resampling.LANCZOS
    target_map_size = (out_w, map_height)
    if mapa.size != target_map_size:
        mapa = mapa.resize(target_map_size, resample)

    overlay = Image.new("RGBA", (out_w, map_height), (*_BG_RGB, _MAP_OVERLAY_ALPHA))
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

    font_large = _get_font(True, max(10, round(int(spec["font_large"]) * scale)))
    font_medium = _get_font(True, max(8, round(int(spec["font_medium"]) * scale)))

    cod = str(datos.get("cod_componente", ""))
    dir_str = str(datos.get("direccion", ""))
    loc = str(datos.get("localidad", ""))
    dist = str(datos.get("distrito", ""))

    y_start = round(int(spec["y_start"]) * scale)
    line_spacing = round(int(spec["line_spacing"]) * scale)
    line_gap = float(spec["line_gap"])
    stroke_w_large = max(1, round(int(spec["stroke_large"]) * scale))
    stroke_w_medium = max(1, round(int(spec["stroke_medium"]) * scale))

    y_text = y_start
    bbox_cod = draw.textbbox((0, 0), cod, font=font_large)
    w_cod = bbox_cod[2] - bbox_cod[0]
    draw.text(
        ((out_w - w_cod) // 2, y_text),
        cod,
        fill=(0, 0, 0),
        font=font_large,
        stroke_width=stroke_w_large,
        stroke_fill=(255, 255, 255),
    )

    y_text += line_spacing
    bbox_dir = draw.textbbox((0, 0), dir_str, font=font_medium)
    w_dir = bbox_dir[2] - bbox_dir[0]
    if w_dir > out_w * 0.8:
        draw.text(
            (int(out_w * 0.1), y_text),
            dir_str,
            fill=(0, 0, 0),
            font=font_medium,
            stroke_width=stroke_w_medium,
            stroke_fill=(255, 255, 255),
        )
    else:
        draw.text(
            ((out_w - w_dir) // 2, y_text),
            dir_str,
            fill=(0, 0, 0),
            font=font_medium,
            stroke_width=stroke_w_medium,
            stroke_fill=(255, 255, 255),
        )

    y_text += round(line_spacing * line_gap)
    bbox_loc = draw.textbbox((0, 0), loc, font=font_medium)
    w_loc = bbox_loc[2] - bbox_loc[0]
    draw.text(
        ((out_w - w_loc) // 2, y_text),
        loc,
        fill=(0, 0, 0),
        font=font_medium,
        stroke_width=stroke_w_medium,
        stroke_fill=(255, 255, 255),
    )

    y_text += round(line_spacing * line_gap)
    bbox_dist = draw.textbbox((0, 0), dist, font=font_medium)
    w_dist = bbox_dist[2] - bbox_dist[0]
    draw.text(
        ((out_w - w_dist) // 2, y_text),
        dist,
        fill=(0, 0, 0),
        font=font_medium,
        stroke_width=stroke_w_medium,
        stroke_fill=(255, 255, 255),
    )

    pin = _get_pin_rgba()
    if pin is not None:
        new_pin_w = int(out_w * float(spec["pin_scale"]))
        new_pin_h = int(pin.height * (new_pin_w / pin.width))
        pin_resized = pin.resize((new_pin_w, new_pin_h), resample)
        pin_x = (out_w - new_pin_w) // 2
        pin_y = (map_height // 2) - int(new_pin_h * _PIN_TIP_RATIO)
        final_img.paste(pin_resized, (pin_x, pin_y), mask=pin_resized)

    return final_img


def render_ubicacion(
    datos: dict,
    formato: str,
    *,
    preview: bool = False,
    map_opts: dict[str, Any] | None = None,
) -> Image.Image:
    """Pipeline único: captura mapa + composición WYSIWYG (preview o export)."""
    lat = float(datos["lat"])
    lon = float(datos["lon"])
    screenshot_bytes = _get_cached_map_screenshot(lat, lon, formato, preview=preview, map_opts=map_opts)
    return _compose_ubicacion_image(datos, formato, screenshot_bytes, preview=preview)


def render_imagen_ubicacion(
    datos: dict,
    formato: str,
    map_opts: dict[str, Any] | None = None,
) -> Image.Image:
    """Renderiza la imagen final A4 con mapa, textos, pin y footer."""
    return render_ubicacion(datos, formato, preview=False, map_opts=map_opts)


def generar_imagen_ubicacion(
    datos: dict,
    output_path: str,
    formato: str,
    map_opts: dict[str, Any] | None = None,
) -> None:
    """Genera la imagen y la guarda como PDF."""
    final_img = render_imagen_ubicacion(datos, formato, map_opts=map_opts)
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
            def parse_lat(val):
                try:
                    return float(str(val).split(',')[0].strip())
                except Exception:
                    return 0.0
            def parse_lon(val):
                try:
                    return float(str(val).split(',')[1].strip())
                except Exception:
                    return 0.0
            df['lat_tmp'] = df[col_coord].apply(parse_lat)
            df['lon_tmp'] = df[col_coord].apply(parse_lon)
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
        formato = payload.get("formato", "vertical")
        row_index = payload.get("rowIndex", 0)
        recompose_only = bool(payload.get("recomposeOnly", False))
        map_opts = {"provider": payload.get("provider"), "google_maps_key": payload.get("google_maps_key")}

        if not excel_path:
            return {"success": False, "error": "Falta la ruta del Excel."}

        df, (col_cod, col_dir, col_loc, col_dist, col_lat, col_lon) = _load_excel_data(excel_path)

        if col_lat is None:
            return {"success": False, "error": "El Excel debe tener columnas 'latitud' y 'longitud'."}

        if row_index >= len(df):
            return {"success": False, "error": "No hay mas filas para previsualizar."}

        row = df.iloc[row_index]
        datos = _extract_row_data(row, row_index, col_cod, col_dir, col_loc, col_dist, col_lat, col_lon)

        if pd.isna(datos['lat']) or pd.isna(datos['lon']):
            return {"success": False, "error": "La fila no tiene coordenadas validas."}

        lat = float(datos['lat'])
        lon = float(datos['lon'])
        excel_ctx = _sync_excel_context(excel_path)
        composed_key = (_FOOTER_LAYOUT_VERSION, _MAP_CAPTURE_VERSION, excel_ctx, row_index, formato)

        cached_preview = _preview_composed_cache.get(composed_key)
        if cached_preview is not None:
            return {"success": True, "data": cached_preview}

        if recompose_only:
            map_key = _map_cache_key(lat, lon, formato, preview=True)
            cached_map = _map_screenshot_cache.get(map_key)
            if cached_map is not None:
                data = _compose_and_cache_preview(
                    excel_ctx, row_index, formato, datos, cached_map, len(df),
                )
                return {"success": True, "data": data}

        screenshot_bytes = _get_cached_map_screenshot(lat, lon, formato, preview=True, map_opts=map_opts)
        data = _compose_and_cache_preview(
            excel_ctx, row_index, formato, datos, screenshot_bytes, len(df),
        )

        threading.Thread(
            target=_prefetch_alternate_formato,
            args=(excel_ctx, row_index, formato, datos, lat, lon, len(df)),
            daemon=True,
        ).start()

        return {"success": True, "data": data}
    except Exception as e:
        logger.exception("Error generando preview de ubicacion")
        return {"success": False, "error": str(e)}

def handle_generar_ubicaciones(payload: dict) -> dict:
    try:
        excel_path = payload.get("excelPath")
        output_dir = payload.get("outputDir")
        formato = payload.get("formato", "vertical")
        consolidado = payload.get("consolidado", False)
        map_opts = {"provider": payload.get("provider"), "google_maps_key": payload.get("google_maps_key")}

        if not excel_path or not output_dir:
            return {"success": False, "error": "Faltan rutas de entrada/salida."}

        os.makedirs(output_dir, exist_ok=True)

        df, (col_cod, col_dir, col_loc, col_dist, col_lat, col_lon) = _load_excel_data(excel_path)

        if col_lat is None:
            return {"success": False, "error": "El Excel debe tener columnas 'latitud' y 'longitud'."}

        generados = 0
        fallidos = 0
        consolidated_images: list[Image.Image] = []

        # Pre-extraer datos de filas válidas en el thread principal: preserva el
        # orden de páginas del consolidado y filtra NaN y coordenadas no
        # numéricas antes de paralelizar (un float() que falle en el worker
        # abortaría el batch entero vía ex.map).
        valid_rows: list[dict] = []
        for index, row in df.iterrows():
            datos = _extract_row_data(row, index, col_cod, col_dir, col_loc, col_dist, col_lat, col_lon)
            lat = _coerce_coord(datos["lat"])
            lon = _coerce_coord(datos["lon"])
            if lat is None or lon is None:
                continue
            datos["lat"] = lat
            datos["lon"] = lon
            valid_rows.append(datos)

        def _render_one(d: dict) -> tuple[bool, Image.Image | None]:
            """Renderiza (y guarda en no-consolidado) una fila. Devuelve
            ``(ok, img)``: img sólo en modo consolidado y ok. Una fila que
            falle se aísla (no aborta el batch vía ex.map)."""
            logger.info(f"Procesando {d['cod_componente']} en {d['lat']}, {d['lon']}...")
            t0 = time.perf_counter()
            try:
                if consolidado:
                    return (True, render_imagen_ubicacion(d, formato, map_opts=map_opts).convert("RGB"))
                out_filename = _output_pdf_filename(d["cod_componente"])
                out_path = os.path.join(output_dir, out_filename)
                generar_imagen_ubicacion(d, out_path, formato, map_opts=map_opts)
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

        if consolidado and consolidated_images:
            consolidated_path = os.path.join(output_dir, "ubicaciones_consolidado.pdf")
            # Save first image, append the rest as additional pages
            first_img = consolidated_images[0]
            append_imgs = consolidated_images[1:] if len(consolidated_images) > 1 else []
            first_img.save(
                consolidated_path,
                "PDF",
                resolution=300.0,
                save_all=True,
                append_images=append_imgs,
            )
            logger.info(f"PDF consolidado generado: {consolidated_path} ({generados} paginas)")

        return {
            "success": True,
            "data": {
                "generados": generados,
                "fallidos": fallidos,
                "outputDir": output_dir,
                "consolidado": consolidado,
            },
        }
    except Exception as e:
        logger.exception("Error generando ubicaciones")
        return {"success": False, "error": str(e)}

HANDLERS: dict[str, Any] = {
    "generar_ubicaciones": handle_generar_ubicaciones,
    "preview_ubicacion": handle_preview_ubicacion,
}
