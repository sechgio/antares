from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import urllib.parse
from collections import OrderedDict
from pathlib import Path
from typing import Any

from backend.core.observability import log_event
from backend.core.ubicaciones.client import _coerce_coord, _http_get
from backend.utils.atomic_write import atomic_write_json
from backend.utils.paths import user_data_path
from backend.version import __version__ as _antares_version

logger = logging.getLogger(__name__)

_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
_GEOCODE_USER_AGENT = f"Antares/{_antares_version} (ubicaciones geocoding; +https://github.com/sechgio/antares)"
_GEOCODE_MIN_INTERVAL_S = 1.1
_GEOCODE_CACHE_FILE = "ubicaciones_geocode_cache.json"
_GEOCODE_CACHE_MAX = 2000
_GEOCODE_NEGATIVE_TTL_S = 24 * 3600
_COUNTRY_RE = re.compile(r"^[a-z]{2}(,[a-z]{2})*$")

_geocode_http_lock = threading.Lock()
_geocode_state_lock = threading.Lock()
_last_request_at = 0.0
_cache: OrderedDict[str, dict[str, float | bool]] | None = None


def _nominatim_url() -> str:
    url = os.environ.get("ANTARES_NOMINATIM_URL") or _NOMINATIM_URL
    parsed = urllib.parse.urlsplit(url)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("ANTARES_NOMINATIM_URL debe ser una URL HTTPS de búsqueda sin query ni fragmento.")
    return url


def _normalize_query(query: str) -> str:
    return re.sub(r"\s+", " ", query.strip().lower())


def normalize_country(country: Any) -> str | None:
    code = str(country or "").strip().lower()
    return code if _COUNTRY_RE.fullmatch(code) else None


def build_geocode_query(direccion: Any, localidad: Any, distrito: Any) -> str:
    parts = [str(v).strip() for v in (direccion, localidad, distrito)]
    return ", ".join(part for part in parts if part)


def _cache_path() -> Path:
    return user_data_path(_GEOCODE_CACHE_FILE)


def _load_cache() -> OrderedDict[str, dict[str, float | bool]]:
    global _cache
    if _cache is not None:
        return _cache
    _cache = OrderedDict()
    try:
        data = json.loads(_cache_path().read_text(encoding="utf-8"))
        entries = data.get("entries") if isinstance(data, dict) else None
        if isinstance(entries, dict):
            for key, value in entries.items():
                if isinstance(value, dict):
                    _cache[str(key)] = value
    except Exception:
        logger.debug("Caché de geocoding ilegible; se ignora", exc_info=True)
    return _cache


def _save_cache() -> None:
    if _cache is None:
        return
    try:
        atomic_write_json(_cache_path(), {"v": 1, "entries": dict(_cache)})
    except Exception:
        logger.debug("No se pudo persistir la caché de geocoding", exc_info=True)


def _cache_get(key: str) -> tuple[bool, tuple[float, float] | None]:
    with _geocode_state_lock:
        entries = _load_cache()
        entry = entries.get(key)
        if entry is None:
            return False, None
        if entry.get("none"):
            ts = _coerce_coord(entry.get("ts")) or 0.0
            if time.time() - ts < _GEOCODE_NEGATIVE_TTL_S:
                return True, None
            del entries[key]
            return False, None
        lat = _coerce_coord(entry.get("lat"))
        lon = _coerce_coord(entry.get("lon"))
        if lat is None or lon is None:
            del entries[key]
            return False, None
        entries.move_to_end(key)
        return True, (lat, lon)


def _cache_put(key: str, value: tuple[float, float] | None) -> None:
    with _geocode_state_lock:
        entries = _load_cache()
        entries[key] = (
            {"none": True, "ts": time.time()}
            if value is None
            else {"lat": value[0], "lon": value[1], "ts": time.time()}
        )
        entries.move_to_end(key)
        while len(entries) > _GEOCODE_CACHE_MAX:
            entries.popitem(last=False)
        _save_cache()


def _request_geocode(query: str, country: str | None) -> tuple[tuple[float, float] | None, bool]:
    global _last_request_at
    params = {"format": "jsonv2", "limit": "1", "q": query}
    if country:
        params["countrycodes"] = country
    url = f"{_nominatim_url()}?{urllib.parse.urlencode(params)}"
    wait = _GEOCODE_MIN_INTERVAL_S - (time.monotonic() - _last_request_at)
    if wait > 0:
        time.sleep(wait)
    _last_request_at = time.monotonic()
    payload = _http_get(url, {"User-Agent": _GEOCODE_USER_AGENT, "Accept": "application/json"})
    if not payload:
        return None, False
    try:
        results = json.loads(payload)
    except (TypeError, ValueError):
        logger.warning("Geocode: respuesta no JSON; se omite el contenido por privacidad")
        return None, False
    if not isinstance(results, list):
        return None, False
    if not results:
        return None, True
    first = results[0]
    if not isinstance(first, dict):
        return None, False
    lat = _coerce_coord(first.get("lat"))
    lon = _coerce_coord(first.get("lon"))
    if lat is None or lon is None or not -90 <= lat <= 90 or not -180 <= lon <= 180:
        return None, False
    return (lat, lon), True


def geocode_address(query: str, *, country: str | None = None) -> tuple[float, float] | None:
    normalized = _normalize_query(query)
    if not normalized:
        return None
    country_code = normalize_country(country)
    cache_key = f"{country_code or ''}|{normalized}"
    with _geocode_http_lock:
        hit, cached = _cache_get(cache_key)
        if hit:
            return cached
        coords, cacheable = _request_geocode(normalized, country_code)
        if cacheable:
            _cache_put(cache_key, coords)
    log_event(
        logger,
        logging.INFO if coords or cacheable else logging.WARNING,
        "ubicaciones.geocode",
        outcome="success" if coords else "not_found" if cacheable else "failed",
        message=f"Geocode {'resuelto' if coords else 'sin resultado' if cacheable else 'no disponible'}",
    )
    return coords


def _clear_geocode_state() -> None:
    global _cache, _last_request_at
    with _geocode_http_lock:
        with _geocode_state_lock:
            _cache = None
        _last_request_at = 0.0


__all__ = [
    "_GEOCODE_CACHE_MAX",
    "_GEOCODE_MIN_INTERVAL_S",
    "_GEOCODE_NEGATIVE_TTL_S",
    "_NOMINATIM_URL",
    "_clear_geocode_state",
    "_normalize_query",
    "build_geocode_query",
    "geocode_address",
    "normalize_country",
]
