from __future__ import annotations

from backend.core.ubicaciones import cache, client, composer, consolidator
from backend.core.ubicaciones.cache import (
    _clear_ubicaciones_caches,
    _compose_and_cache_preview,
    _get_cached_map_screenshot,
)
from backend.core.ubicaciones.client import (
    _cap_fetch_size,
    _parse_combined_coord_value,
    _redact_url_for_log,
    _resolve_api_key,
    _resolve_provider,
    fetch_static_map,
)
from backend.core.ubicaciones.composer import (
    _REF_LAYOUT,
    _compose_ubicacion_image,
    _dimensions_for,
    _map_capture_size,
    _unique_pdf_filename,
    generar_imagen_ubicacion,
    render_imagen_ubicacion,
    render_ubicacion,
)
from backend.core.ubicaciones.consolidator import (
    _MAX_CONSOLIDATED_PAGE_BYTES,
    _write_consolidated_pdf,
    append_page_to_writer,
    build_consolidated_pdf,
    close_consolidated_writer,
    create_consolidated_writer,
)

__all__ = [
    "_MAX_CONSOLIDATED_PAGE_BYTES",
    "_REF_LAYOUT",
    "_cap_fetch_size",
    "_clear_ubicaciones_caches",
    "_compose_and_cache_preview",
    "_compose_ubicacion_image",
    "_dimensions_for",
    "_get_cached_map_screenshot",
    "_map_capture_size",
    "_parse_combined_coord_value",
    "_redact_url_for_log",
    "_resolve_api_key",
    "_resolve_provider",
    "_unique_pdf_filename",
    "_write_consolidated_pdf",
    "append_page_to_writer",
    "build_consolidated_pdf",
    "cache",
    "client",
    "close_consolidated_writer",
    "composer",
    "consolidator",
    "create_consolidated_writer",
    "fetch_static_map",
    "generar_imagen_ubicacion",
    "render_imagen_ubicacion",
    "render_ubicacion",
]
