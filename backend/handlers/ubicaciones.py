from __future__ import annotations

import contextlib
import json
import logging
import os
import tempfile
import time
import urllib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from backend.core.ubicaciones import cache as _ubic_cache
from backend.core.ubicaciones import client as _ubic_client
from backend.core.ubicaciones import composer as _ubic_composer
from backend.core.ubicaciones import consolidator as _ubic_consolidator
from backend.core.ubicaciones.cache import (
    _cache_lock,
    _compose_and_cache_preview,
    _composed_preview_key,
    _get_cached_map_screenshot,
    _load_excel_data,
    _manual_preview_ctx,
    _map_cache_key,
    _map_screenshot_cache,
    _map_screenshot_working_cache,
    _preview_composed_cache,
    _spawn_prefetch,
    _sync_excel_context,
)
from backend.core.ubicaciones.client import (
    _MAX_MAP_ZOOM,
    _MAX_RENDER_WORKERS,
    _MIN_MAP_ZOOM,
    _coerce_coord,
    _is_na,
)
from backend.core.ubicaciones.composer import (
    _extract_row_data,
    _unique_pdf_filename,
    generar_imagen_ubicacion,
)
from backend.core.ubicaciones.consolidator import (
    _save_consolidated_writer,
    append_page_to_writer,
    close_consolidated_writer,
    create_consolidated_writer,
)
from backend.handlers.common import with_locale

logger = logging.getLogger(__name__)


def _export_legacy_ubicaciones_surface() -> None:
    module_globals = globals()
    module_globals.setdefault("urllib", urllib)
    for submodule in (_ubic_cache, _ubic_client, _ubic_composer, _ubic_consolidator):
        for name in submodule.__all__:
            module_globals.setdefault(name, getattr(submodule, name))


_export_legacy_ubicaciones_surface()


def _map_opts_from_payload(payload: dict) -> dict[str, Any]:  # allowlist: dict[str, Any]
    zoom = payload.get("zoom")
    if zoom is not None and (
        isinstance(zoom, bool)
        or not isinstance(zoom, int)
        or not _MIN_MAP_ZOOM <= zoom <= _MAX_MAP_ZOOM
    ):
        raise ValueError(f"El zoom debe ser un entero entre {_MIN_MAP_ZOOM} y {_MAX_MAP_ZOOM}.")
    return {
        "provider": payload.get("provider"),
        "zoom": zoom,
        "api_key": payload.get("api_key"),
    }


def _manual_datos(manual_data: dict) -> dict[str, Any]:  # allowlist: dict[str, Any]
    return {
        "cod_componente": str(manual_data.get("cod_componente", "")).strip(),
        "direccion": str(manual_data.get("direccion", "")).strip(),
        "localidad": str(manual_data.get("localidad", "")).strip(),
        "distrito": str(manual_data.get("distrito", "")).strip(),
        "lat": _coerce_coord(manual_data.get("lat")),
        "lon": _coerce_coord(manual_data.get("lon")),
    }


@with_locale
def handle_preview_ubicacion(payload: dict) -> dict[str, Any]:  # allowlist: dict[str, Any]
    excel_path = payload.get("excelPath")
    manual_data = payload.get("manualData")
    formato = payload.get("formato", "vertical")
    row_index = payload.get("rowIndex", 0)
    recompose_only = bool(payload.get("recomposeOnly", False))
    map_opts = _map_opts_from_payload(payload)
    custom_styles = payload.get("customStyles") or None

    if not excel_path and not manual_data:
        raise ValueError("Falta la ruta del Excel o datos manuales.")

    if manual_data:
        datos = _manual_datos(manual_data)
        total_filas = 1
        row_index = 0
    else:
        if not isinstance(excel_path, str) or not excel_path:
            raise ValueError("Falta la ruta del Excel o datos manuales.")
        df, (col_cod, col_dir, col_loc, col_dist, col_lat, col_lon) = _load_excel_data(excel_path)
        total_filas = len(df)

        if col_lat is None:
            raise ValueError("El Excel debe tener columnas 'latitud' y 'longitud'.")

        if row_index >= total_filas:
            raise ValueError("No hay mas filas para previsualizar.")

        row = df.iloc[row_index]
        datos = _extract_row_data(row, row_index, col_cod, col_dir, col_loc, col_dist, col_lat, col_lon)
        excel_ctx = _sync_excel_context(excel_path)

    lat = _coerce_coord(datos["lat"])
    lon = _coerce_coord(datos["lon"])
    if lat is None or lon is None:
        raise ValueError("La fila no tiene coordenadas validas.")
    datos["lat"] = lat
    datos["lon"] = lon

    excel_ctx = _manual_preview_ctx(datos) if manual_data else excel_ctx
    styles_hash = json.dumps(custom_styles, sort_keys=True) if custom_styles else ""
    composed_key = _composed_preview_key(excel_ctx, row_index, formato, styles_hash, map_opts)

    cached_preview = _preview_composed_cache.get(composed_key)
    if cached_preview is not None:
        cached_path = str(cached_preview.get("image_path") or "")
        if cached_path and Path(cached_path).is_file():
            return cached_preview
        with _cache_lock:
            _preview_composed_cache.pop(composed_key, None)

    if recompose_only:
        map_key = _map_cache_key(lat, lon, formato, preview=True, map_opts=map_opts)
        cached_map = _map_screenshot_cache.get(map_key) or _map_screenshot_working_cache.get(map_key)
        if cached_map is not None:
            data = _compose_and_cache_preview(
                excel_ctx,
                row_index,
                formato,
                datos,
                cached_map,
                total_filas,
                custom_styles=custom_styles,
                map_opts=map_opts,
            )
            return data

    screenshot_bytes = _get_cached_map_screenshot(lat, lon, formato, preview=True, map_opts=map_opts)
    data = _compose_and_cache_preview(
        excel_ctx,
        row_index,
        formato,
        datos,
        screenshot_bytes,
        total_filas,
        custom_styles=custom_styles,
        map_opts=map_opts,
    )

    _spawn_prefetch(
        excel_ctx,
        row_index,
        formato,
        datos,
        lat,
        lon,
        total_filas,
        custom_styles=custom_styles,
        map_opts=map_opts,
    )
    return data


@with_locale
def handle_generar_ubicaciones(payload: dict) -> dict[str, Any]:  # allowlist: dict[str, Any]
    excel_path = payload.get("excelPath")
    manual_data = payload.get("manualData")
    output_dir = payload.get("outputDir")
    formato = payload.get("formato", "vertical")
    consolidado = payload.get("consolidado", False)
    map_opts = _map_opts_from_payload(payload)
    custom_styles = payload.get("customStyles") or None

    if not output_dir or (not excel_path and not manual_data):
        raise ValueError("Faltan rutas de entrada/salida o datos manuales.")

    os.makedirs(output_dir, exist_ok=True)

    valid_rows: list[dict] = []

    if manual_data:
        datos = _manual_datos(manual_data)
        if not _is_na(datos["lat"]) and not _is_na(datos["lon"]):
            valid_rows.append(datos)
    else:
        if not isinstance(excel_path, str) or not excel_path:
            raise ValueError("Faltan rutas de entrada/salida o datos manuales.")
        df, (col_cod, col_dir, col_loc, col_dist, col_lat, col_lon) = _load_excel_data(excel_path)

        if col_lat is None:
            raise ValueError("El Excel debe tener columnas 'latitud' y 'longitud'.")

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
        raise ValueError("No hay filas con coordenadas validas para generar.")

    if not consolidado:
        used_stems: dict[str, int] = {}
        for row_data in valid_rows:
            row_data["_out_filename"] = _unique_pdf_filename(row_data["cod_componente"], used_stems)

    generados = 0
    fallidos = 0
    consolidated_writer: Any | None = None
    consolidated_temp_dir: str | None = None
    if consolidado:
        consolidated_writer = create_consolidated_writer()

    def _render_one(d: dict) -> tuple[bool, str | None]:
        logger.info(f"Procesando {d['cod_componente']} en {d['lat']}, {d['lon']}...")
        t0 = time.perf_counter()
        try:
            if not consolidado:
                out_path = os.path.join(output_dir, d["_out_filename"])
                generar_imagen_ubicacion(d, out_path, formato, map_opts=map_opts, custom_styles=custom_styles)
                return (True, None)
            if consolidated_temp_dir is None:
                raise RuntimeError("No se pudo crear el directorio temporal del PDF consolidado.")
            fd, tmp_name = tempfile.mkstemp(
                suffix=".pdf",
                prefix="antares_page_",
                dir=consolidated_temp_dir,
            )
            os.close(fd)
            try:
                generar_imagen_ubicacion(d, tmp_name, formato, map_opts=map_opts, custom_styles=custom_styles)
                return (True, tmp_name)
            except Exception:
                with contextlib.suppress(OSError):
                    os.remove(tmp_name)
                raise
        except Exception:
            logger.exception("Error renderizando ubicación %s; se omite", d["cod_componente"])
            return (False, None)
        finally:
            logger.info(
                "Ubicacion %s renderizada en %.1fs",
                d["cod_componente"],
                time.perf_counter() - t0,
            )

    temp_ctx = (
        tempfile.TemporaryDirectory(prefix="antares-ubicaciones-")
        if consolidado
        else contextlib.nullcontext()
    )
    with temp_ctx as managed_temp_dir:
        consolidated_temp_dir = managed_temp_dir
        max_workers = max(1, min(_MAX_RENDER_WORKERS, len(valid_rows)))
        with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="ubic-render") as ex:
            for ok, page_path in ex.map(_render_one, valid_rows):
                if not ok:
                    fallidos += 1
                    continue
                if consolidado and page_path is not None:
                    try:
                        append_page_to_writer(consolidated_writer, page_path)
                    except Exception:
                        logger.exception("Error agregando página al PDF consolidado; se omite")
                        fallidos += 1
                    else:
                        generados += 1
                    finally:
                        with contextlib.suppress(OSError):
                            os.remove(page_path)
                else:
                    generados += 1

    consolidated_path: str | None = None
    if consolidado and consolidated_writer is not None:
        try:
            if generados:
                consolidated_path = _save_consolidated_writer(consolidated_writer, output_dir)
                logger.info(f"PDF consolidado generado: {consolidated_path} ({generados} paginas)")
        finally:
            close_consolidated_writer(consolidated_writer)

    return {
        "generados": generados,
        "fallidos": fallidos,
        "outputDir": output_dir,
        "consolidado": consolidado,
        "consolidatedPath": consolidated_path,
    }


HANDLERS: dict[str, Any] = {  # allowlist: dict[str, Any]
    "generar_ubicaciones": handle_generar_ubicaciones,
    "preview_ubicacion": handle_preview_ubicacion,
}
