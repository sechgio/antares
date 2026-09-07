from __future__ import annotations

import logging
import math
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from typing import Any, cast

from PIL import Image

from backend.version import __version__ as _antares_version

logger = logging.getLogger(__name__)

_MAX_RENDER_WORKERS = 4
_COORD_PRECISION = 5

_MAP_ZOOM = 18
_MIN_MAP_ZOOM = 0
_MAX_MAP_ZOOM = 22
_MAP_PROVIDER_DEFAULT = "osm"
_MAP_FETCH_MAX_DIM = 1024
_OSM_TILE_SIZE = 256
_XYZ_PROVIDERS = {
    "osm": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    "mapbox": "https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token={key}",
    "maptiler": "https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key={key}",
    "stadia": "https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}.png?api_key={key}",
    "geoapify": "https://maps.geoapify.com/v1/tile/osm-carto/{z}/{x}/{y}.png?apiKey={key}",
    "thunderforest": "https://tile.thunderforest.com/atlas/{z}/{x}/{y}.png?apikey={key}",
}
_GOOGLE_STATIC_URL = "https://maps.googleapis.com/maps/api/staticmap"
_HTTP_USER_AGENT = f"Antares/{_antares_version} (ubicaciones static map; +https://github.com/sechgio/antares)"
_HTTP_TIMEOUT = 12

_COMBINED_COORD_URL_PATTERNS = (
    re.compile(r"[@?](-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)"),
    re.compile(r"[?&]q=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)"),
    re.compile(r"[?&]center=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)"),
)


def _resolve_provider(map_opts: dict[str, Any] | None) -> str:  # allowlist: dict[str, Any]
    if map_opts and map_opts.get("provider"):
        return str(map_opts["provider"]).lower()
    return os.environ.get("ANTARES_MAP_PROVIDER", _MAP_PROVIDER_DEFAULT).lower()


def _resolve_api_key(map_opts: dict[str, Any] | None) -> str | None:  # allowlist: dict[str, Any]
    if map_opts:
        if map_opts.get("api_key"):
            return str(map_opts["api_key"])
        if map_opts.get("google_maps_key"):
            return str(map_opts["google_maps_key"])
    return os.environ.get("ANTARES_MAPS_API_KEY") or os.environ.get("ANTARES_GOOGLE_MAPS_KEY") or None


def _cap_fetch_size(width: int, height: int) -> tuple[int, int]:
    longest = max(width, height)
    if longest <= _MAP_FETCH_MAX_DIM:
        return max(1, width), max(1, height)
    scale = _MAP_FETCH_MAX_DIM / longest
    return max(1, round(width * scale)), max(1, round(height * scale))


def _redact_url_for_log(url: str) -> str:
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


def _http_get(
    url: str,
    headers: dict[str, str],
    timeout: int = _HTTP_TIMEOUT,
    deadline: float | None = None,
) -> bytes | None:
    _TRANSIENT_CODES = frozenset((408, 429, 500, 502, 503, 504))
    start = time.monotonic() if deadline is not None else None
    while True:
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return cast(bytes, resp.read())
        except urllib.error.HTTPError as exc:
            is_transient = exc.code in _TRANSIENT_CODES
            if not is_transient or deadline is None:
                logger.debug("HTTP GET failed for %s: %s", _redact_url_for_log(url), exc)
                return None
            retry_after = 0.0
            try:
                if exc.headers is not None:
                    raw = exc.headers.get("Retry-After")
                    if raw is not None:
                        retry_after = float(str(raw).strip())
                        if not math.isfinite(retry_after) or retry_after < 0:
                            retry_after = 0.0
            except Exception:
                retry_after = 0.0
            last_exc: Exception = exc
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            if deadline is None:
                logger.debug("HTTP GET failed for %s: %s", _redact_url_for_log(url), exc)
                return None
            last_exc = exc
            retry_after = 0.0
        except Exception as exc:
            logger.debug("HTTP GET failed for %s: %s", _redact_url_for_log(url), exc)
            return None
        assert start is not None and deadline is not None
        elapsed = time.monotonic() - start
        remaining = deadline - elapsed
        if remaining <= 0:
            logger.debug("HTTP GET deadline exceeded for %s: %s", _redact_url_for_log(url), last_exc)
            return None
        sleep_for = retry_after if retry_after > 0 else 0.0
        if sleep_for > remaining:
            sleep_for = remaining
        time.sleep(sleep_for)


def _fallback_map_bytes(width: int, height: int) -> bytes:
    img = Image.new("RGB", (max(1, width), max(1, height)), (215, 215, 215))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _lonlat_to_webmercator_pixel(lon: float, lat: float, zoom: int) -> tuple[float, float]:
    n = 2 ** zoom
    x = (lon + 180.0) / 360.0 * n * _OSM_TILE_SIZE
    lat_rad = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n * _OSM_TILE_SIZE
    return x, y


def _fetch_xyz_tiles_map(
    lat: float,
    lon: float,
    width: int,
    height: int,
    zoom: int,
    url_template: str,
    api_key: str = "",
) -> Image.Image:
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
    width = max(1, int(width))
    height = max(1, int(height))
    longest = max(width, height)
    if longest <= 640:
        return width, height
    scale = 640 / longest
    return max(1, round(width * scale)), max(1, round(height * scale))


def _fetch_google_static_map(lat: float, lon: float, width: int, height: int, zoom: int, key: str) -> Image.Image:
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

            if provider != "osm" and not api_key:
                logger.warning(
                    "Proveedor %s requiere una llave API pero no se proporcionó. La petición de mapa probablemente fallará.",
                    provider,
                )

            img = _fetch_xyz_tiles_map(lat, lon, fetch_w, fetch_h, zoom, url_template, api_key or "")
        img = img.resize((fetch_w, fetch_h), Image.Resampling.LANCZOS) if img.size != (fetch_w, fetch_h) else img
        buf = BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except Exception:
        logger.exception("fetch_static_map falló para %s,%s; usando placeholder", lat, lon)
        return _fallback_map_bytes(fetch_w, fetch_h)


def _is_na(value: Any) -> bool:
    if value is None:
        return True
    try:
        return bool(math.isnan(float(value)))
    except (TypeError, ValueError):
        return False


def _coerce_coord(value: Any) -> float | None:
    if _is_na(value):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coord_key(lat: float, lon: float) -> tuple[float, float]:
    return (round(lat, _COORD_PRECISION), round(lon, _COORD_PRECISION))


def _parse_combined_coord_value(val: Any) -> tuple[float | None, float | None]:
    if _is_na(val):
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


__all__ = [
    "_COMBINED_COORD_URL_PATTERNS",
    "_COORD_PRECISION",
    "_GOOGLE_STATIC_URL",
    "_HTTP_TIMEOUT",
    "_HTTP_USER_AGENT",
    "_MAP_FETCH_MAX_DIM",
    "_MAP_PROVIDER_DEFAULT",
    "_MAP_ZOOM",
    "_MAX_MAP_ZOOM",
    "_MAX_RENDER_WORKERS",
    "_MIN_MAP_ZOOM",
    "_OSM_TILE_SIZE",
    "_XYZ_PROVIDERS",
    "_cap_fetch_size",
    "_coerce_coord",
    "_coord_key",
    "_fallback_map_bytes",
    "_fetch_google_static_map",
    "_fetch_xyz_tiles_map",
    "_google_static_map_size",
    "_http_get",
    "_is_na",
    "_lonlat_to_webmercator_pixel",
    "_parse_combined_coord_value",
    "_redact_url_for_log",
    "_resolve_api_key",
    "_resolve_provider",
    "fetch_static_map",
]
