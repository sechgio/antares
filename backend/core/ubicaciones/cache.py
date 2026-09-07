from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import logging
import os
import threading
import time
from collections import OrderedDict
from concurrent.futures import Future
from io import BytesIO
from pathlib import Path
from typing import Any, cast

from PIL import Image, ImageFont

from backend.core.ubicaciones.client import (
    _MAP_ZOOM,
    _coord_key,
    _resolve_api_key,
    _resolve_provider,
    fetch_static_map,
)
from backend.core.ubicaciones.composer import (
    _FOOTER_LAYOUT_VERSION,
    _MAP_CAPTURE_VERSION,
    _compose_ubicacion_image,
    _crop_footer_bar,
    _map_capture_size,
    _parse_excel_columns,
)
from backend.utils.paths import resource_path, user_data_path

logger = logging.getLogger(__name__)

_font_cache: OrderedDict[tuple[str, int], ImageFont.FreeTypeFont | ImageFont.ImageFont] = OrderedDict()
_footer_cache: OrderedDict[tuple[int, int, int], Image.Image | None] = OrderedDict()
_MAX_FONT_CACHE = 32
_MAX_FOOTER_CACHE = 8
_excel_cache: OrderedDict[str, tuple[tuple[int, int, int], Any, tuple[Any, ...], int]] = OrderedDict()
_MAX_EXCEL_CACHE = 8
_MAX_EXCEL_CACHE_BYTES = 64 * 1024 * 1024
_excel_cache_bytes = 0
_map_screenshot_store: OrderedDict[tuple[Any, ...], bytes] = OrderedDict()
_map_screenshot_validated: set[tuple[Any, ...]] = set()
_map_screenshot_negative_at: OrderedDict[tuple[Any, ...], float] = OrderedDict()
_map_screenshot_inflight: dict[tuple[Any, ...], Future[bytes]] = {}
_preview_composed_cache: dict[tuple[Any, ...], dict[str, Any]] = {}  # allowlist: dict[str, Any]
_preview_excel_ctx: tuple[str, tuple[int, int, int]] | None = None
_cache_lock = threading.Lock()
_MAX_MAP_CACHE = 20
_MAP_NEGATIVE_TTL_SECONDS = 30.0
_MAX_COMPOSED_CACHE = 16
_pin_cache: Image.Image | None = None


def _trim_cache(cache: dict, max_size: int) -> None:
    while len(cache) > max_size:
        if isinstance(cache, OrderedDict):
            cache.popitem(last=False)
        else:
            del cache[next(iter(cache))]


def _clear_ubicaciones_caches() -> None:
    global _preview_excel_ctx, _excel_cache_bytes
    with _cache_lock:
        _map_screenshot_store.clear()
        _map_screenshot_validated.clear()
        _map_screenshot_negative_at.clear()
        _preview_composed_cache.clear()
        _excel_cache.clear()
        _excel_cache_bytes = 0
        _font_cache.clear()
        _footer_cache.clear()
        _preview_excel_ctx = None


class _MapScreenshotCacheView:
    def __init__(self, *, validated_only: bool) -> None:
        self._validated_only = validated_only

    def clear(self) -> None:
        with _cache_lock:
            _map_screenshot_store.clear()
            _map_screenshot_validated.clear()
            _map_screenshot_negative_at.clear()

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
                _map_screenshot_negative_at.pop(key, None)
            while len(_map_screenshot_store) > _MAX_MAP_CACHE:
                old_key, _ = _map_screenshot_store.popitem(last=False)
                _map_screenshot_validated.discard(old_key)
                _map_screenshot_negative_at.pop(old_key, None)

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


def _get_footer_image(width: int, height: int) -> Image.Image | None:
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


def _get_pin_rgba() -> Image.Image | None:
    global _pin_cache
    if _pin_cache is None:
        pin_path = os.path.join(resource_path("assets/ubicaciones"), "pin.png")
        if os.path.exists(pin_path):
            with Image.open(pin_path) as opened:
                _pin_cache = opened.convert("RGBA")
    return _pin_cache


def _map_opts_fingerprint(map_opts: dict[str, Any] | None) -> tuple[Any, ...]:  # allowlist: dict[str, Any]
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
    map_opts: dict[str, Any] | None,  # allowlist: dict[str, Any]
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
    map_opts: dict[str, Any] | None = None,  # allowlist: dict[str, Any]
) -> tuple[Any, ...]:
    cap_w, cap_h = _map_capture_size(formato, preview=preview)
    return (_MAP_CAPTURE_VERSION, *_coord_key(lat, lon), formato, cap_w, cap_h, *_map_opts_fingerprint(map_opts))


def _screenshot_has_map_tiles(screenshot_bytes: bytes) -> bool:
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


def _excel_cache_key(excel_path: str) -> str:
    return os.path.normcase(os.path.abspath(excel_path))


def _excel_file_signature(excel_path: str) -> tuple[int, int, int]:
    stat = os.stat(excel_path)
    return (int(stat.st_mtime_ns), int(stat.st_size), int(stat.st_ctime_ns))


def _estimate_excel_cache_bytes(df: Any) -> int:
    try:
        return max(1, int(df.memory_usage(index=True, deep=True).sum()))
    except (AttributeError, TypeError, ValueError):
        return max(1, int(getattr(df, "nbytes", 0) or 0))


def _trim_excel_cache() -> None:
    global _excel_cache_bytes
    while len(_excel_cache) > _MAX_EXCEL_CACHE or _excel_cache_bytes > _MAX_EXCEL_CACHE_BYTES:
        _key, entry = _excel_cache.popitem(last=False)
        _excel_cache_bytes = max(0, _excel_cache_bytes - entry[3])


def _load_excel_data(excel_path: str) -> tuple[Any, tuple[Any, ...]]:
    cache_key = _excel_cache_key(excel_path)
    signature = _excel_file_signature(excel_path)
    with _cache_lock:
        cached = _excel_cache.get(cache_key)
        if cached and cached[0] == signature:
            _excel_cache.move_to_end(cache_key)
            return cached[1], cached[2]
    import pandas as pd

    df = pd.read_excel(excel_path, engine="openpyxl")
    cols = _parse_excel_columns(df)
    entry_bytes = _estimate_excel_cache_bytes(df)
    with _cache_lock:
        global _excel_cache_bytes
        previous = _excel_cache.pop(cache_key, None)
        if previous is not None:
            _excel_cache_bytes = max(0, _excel_cache_bytes - previous[3])
        if entry_bytes <= _MAX_EXCEL_CACHE_BYTES:
            _excel_cache[cache_key] = (signature, df, cols, entry_bytes)
            _excel_cache.move_to_end(cache_key)
            _excel_cache_bytes += entry_bytes
            _trim_excel_cache()
    return df, cols


def _sync_excel_context(excel_path: str) -> tuple[str, tuple[int, int, int]]:
    global _preview_excel_ctx
    ctx = (_excel_cache_key(excel_path), _excel_file_signature(excel_path))
    if _preview_excel_ctx != ctx:
        with _cache_lock:
            _preview_composed_cache.clear()
        _preview_excel_ctx = ctx
    return ctx


def _manual_preview_ctx(datos: dict) -> tuple[Any, ...]:
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


def _get_cached_map_screenshot(
    lat: float,
    lon: float,
    formato: str,
    *,
    preview: bool = False,
    map_opts: dict[str, Any] | None = None,  # allowlist: dict[str, Any]
) -> bytes:
    key = _map_cache_key(lat, lon, formato, preview=preview, map_opts=map_opts)
    with _cache_lock:
        cached = _map_screenshot_store.get(key) if key in _map_screenshot_validated else None
        if cached is not None:
            _map_screenshot_store.move_to_end(key)
            return cached

        negative_at = _map_screenshot_negative_at.get(key)
        if negative_at is not None:
            if time.monotonic() - negative_at < _MAP_NEGATIVE_TTL_SECONDS:
                negative = _map_screenshot_store.get(key)
                if negative is not None:
                    _map_screenshot_negative_at.move_to_end(key)
                    _map_screenshot_store.move_to_end(key)
                    return negative
            _map_screenshot_negative_at.pop(key, None)

        pending = _map_screenshot_inflight.get(key)
        if pending is None:
            pending = Future()
            _map_screenshot_inflight[key] = pending
            is_owner = True
        else:
            is_owner = False

    if not is_owner:
        return pending.result()

    cap_w, cap_h = _map_capture_size(formato, preview=preview)
    provider = _resolve_provider(map_opts)
    try:
        zoom = int(map_opts["zoom"]) if map_opts and map_opts.get("zoom") is not None else _MAP_ZOOM
        screenshot = fetch_static_map(
            lat,
            lon,
            cap_w,
            cap_h,
            zoom,
            provider=provider,
            api_key=_resolve_api_key(map_opts),
        )
        _map_screenshot_working_cache[key] = screenshot
        if _screenshot_has_map_tiles(screenshot):
            _map_screenshot_cache[key] = screenshot
        else:
            with _cache_lock:
                _map_screenshot_negative_at[key] = time.monotonic()
                _map_screenshot_negative_at.move_to_end(key)
                while len(_map_screenshot_negative_at) > _MAX_MAP_CACHE:
                    _map_screenshot_negative_at.popitem(last=False)
        pending.set_result(screenshot)
        return screenshot
    except BaseException as exc:
        pending.set_exception(exc)
        raise
    finally:
        with _cache_lock:
            if _map_screenshot_inflight.get(key) is pending:
                _map_screenshot_inflight.pop(key, None)


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
) -> dict[str, Any]:  # allowlist: dict[str, Any]
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
    cod = str(datos.get("cod_componente", ""))
    dir_str = str(datos.get("direccion", ""))
    loc = str(datos.get("localidad", ""))
    dist = str(datos.get("distrito", ""))
    lat_val = float(datos.get("lat", 0.0))
    lon_val = float(datos.get("lon", 0.0))
    return {
        "image": f"data:image/jpeg;base64,{base64.b64encode(raw).decode('ascii')}",
        "image_path": str(resolved),
        "cod_componente": cod,
        "direccion": dir_str,
        "localidad": loc,
        "distrito": dist,
        "datos": {
            "cod_componente": cod,
            "lat": lat_val,
            "lon": lon_val,
            "direccion": dir_str,
            "localidad": loc,
            "distrito": dist,
        },
        "total_filas": total_filas,
        "row_index": row_index,
        "formato": formato,
    }


def _compose_and_cache_preview(
    excel_ctx: tuple[str, tuple[int, int, int]] | tuple[Any, ...],
    row_index: int,
    formato: str,
    datos: dict,
    screenshot_bytes: bytes,
    total_filas: int,
    custom_styles: dict | None = None,
    map_opts: dict[str, Any] | None = None,  # allowlist: dict[str, Any]
) -> dict[str, Any]:  # allowlist: dict[str, Any]
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
    excel_ctx: tuple[str, tuple[int, int, int]] | tuple[Any, ...],
    row_index: int,
    formato: str,
    datos: dict,
    lat: float,
    lon: float,
    total_filas: int,
    custom_styles: dict | None = None,
    map_opts: dict | None = None,
) -> None:
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
            excel_ctx,
            row_index,
            alt,
            datos,
            map_bytes,
            total_filas,
            custom_styles=custom_styles,
            map_opts=map_opts,
        )
    except Exception:
        logger.debug("Prefetch orientación alterna falló", exc_info=True)


_MAX_PREFETCH_THREADS = 2
_prefetch_slots = threading.BoundedSemaphore(_MAX_PREFETCH_THREADS)


def _spawn_prefetch(*args: Any, **kwargs: Any) -> None:
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


_compose_preview = _compose_and_cache_preview

__all__ = [
    "_MAP_NEGATIVE_TTL_SECONDS",
    "_MAX_COMPOSED_CACHE",
    "_MAX_EXCEL_CACHE",
    "_MAX_EXCEL_CACHE_BYTES",
    "_MAX_FONT_CACHE",
    "_MAX_FOOTER_CACHE",
    "_MAX_MAP_CACHE",
    "_MAX_PREFETCH_THREADS",
    "_MAX_UBIC_PREVIEW_FILES",
    "_MapScreenshotCacheView",
    "_cache_lock",
    "_clear_ubicaciones_caches",
    "_compose_and_cache_preview",
    "_compose_preview",
    "_composed_preview_key",
    "_encode_preview_data",
    "_estimate_excel_cache_bytes",
    "_excel_cache",
    "_excel_cache_bytes",
    "_excel_cache_key",
    "_excel_file_signature",
    "_font_cache",
    "_footer_cache",
    "_get_cached_map_screenshot",
    "_get_font",
    "_get_footer_image",
    "_get_pin_rgba",
    "_load_excel_data",
    "_manual_preview_ctx",
    "_map_cache_key",
    "_map_opts_fingerprint",
    "_map_screenshot_cache",
    "_map_screenshot_inflight",
    "_map_screenshot_negative_at",
    "_map_screenshot_store",
    "_map_screenshot_validated",
    "_map_screenshot_working_cache",
    "_pin_cache",
    "_prefetch_alternate_formato",
    "_prefetch_slots",
    "_preview_composed_cache",
    "_preview_excel_ctx",
    "_screenshot_has_map_tiles",
    "_spawn_prefetch",
    "_sync_excel_context",
    "_trim_cache",
    "_trim_excel_cache",
    "_trim_ubicaciones_preview_files",
]
