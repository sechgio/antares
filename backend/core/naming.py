"""Resolución de renombrado con catálogo, compartida por preview y process.

Una sola implementación del esqueleto que antes vivía duplicado en
``backend/handlers/conversion.py``: parseo de nombres, elección de la
estrategia de BD, preferencia de stem y resolución por archivo. preview y
process consumen este módulo, de modo que la paridad (lo que la UI promete
es lo que el disco escribe) es por construcción.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.core.renamer import RenamerEngine
from backend.utils.validators import parse_filename_parts


def record_group_key(datos: dict[str, Any] | None, key_column: str, fallback: str) -> str:
    """Calcula la clave estable de fila usada por el modo ``record``."""
    raw_value = datos.get(key_column) if key_column and datos else None
    value = str(raw_value or fallback).strip()
    return value.casefold()


def apply_catalog_rename(
    engine: RenamerEngine,
    path: str | Path,
    datos: dict[str, Any] | None,
    codigo: str,
    parsed_sequence: str,
    key_column: str,
) -> str:
    """Aplica el renombrado con catálogo pasando el grupo de fila al motor."""
    return engine.aplicar(
        path,
        datos_bd=datos,
        codigo_manual=codigo,
        file_seq=parsed_sequence,
        sequence_group=record_group_key(datos, key_column, codigo),
    )


@dataclass(frozen=True)
class RenamePlan:
    """Resolución de un lote: nombres por archivo y artefactos del modo lote.

    ``items`` consume process y los modos de catálogo de preview; los
    artefactos (``codigos_manuales``, ``file_seqs``, ``sequence_groups``,
    ``lookup``) alimentan ``RenamerEngine.preview_lote`` en el modo lote de
    preview, que conserva su propia restauración de estado.
    """

    items: list[tuple[str, str, bool]]
    codigos_manuales: dict[str, str]
    file_seqs: dict[str, str]
    sequence_groups: dict[str, str]
    lookup: Callable[[str], dict[str, Any] | None] | None


def resolve_rename_plan(
    files: list[str],
    engine: RenamerEngine,
    *,
    key_column: str = "",
    use_column_rename: bool = False,
    global_offset: int = 0,
    lookup_batch: Callable[[list[str]], dict[str, Any]] | None = None,
) -> RenamePlan:
    """Resuelve el renombrado con catálogo para un lote.

    Estrategias (misma precedencia que los callers): ``key_column`` gana,
    le sigue ``use_column_rename`` (posicional por índice global) y el modo
    lote por defecto (búsqueda multi-campo). ``lookup_batch`` es la búsqueda
    de lote inyectable (en tests, un fake; en producción,
    ``buscar_lote_por_codigos``). La preferencia de stem — el stem completo
    del catálogo gana sobre el código parseado y fuerza secuencia "1" — se
    aplica solo a los modos de catálogo, no al posicional.

    El engine se muta (contadores de secuencia avanzan): preview lo aísla
    con su snapshot, process necesita la mutación entre chunks.
    """
    codigos_manuales: dict[str, str] = {}
    file_seqs: dict[str, str] = {}
    codigos_list: list[str] = []
    stems: list[str] = []
    for f in files:
        p = Path(f)
        code, seq = parse_filename_parts(p.name)
        codigos_manuales[p.name] = code
        codigos_list.append(code)
        stems.append(p.stem)
        file_seqs[p.name] = seq
    search_keys = list(set(codigos_list + stems))

    if key_column:
        from backend.core.database import buscar_por_columna

        db_cache: dict[str, Any] = buscar_por_columna(search_keys, key_column)
    elif use_column_rename:
        from backend.core.database import obtener_todos

        records = obtener_todos(limit=len(files), offset=global_offset)
        db_cache = {str(global_offset + i): rec for i, rec in enumerate(records)}
    else:
        if lookup_batch is None:
            from backend.core.database import buscar_lote_por_codigos

            lookup_batch = buscar_lote_por_codigos
        db_cache = lookup_batch(search_keys)

    if not use_column_rename:
        for f in files:
            name = Path(f).name
            stem = Path(f).stem
            if stem in db_cache:
                codigos_manuales[name] = stem
                file_seqs[name] = "1"

    items: list[tuple[str, str, bool]] = []
    sequence_groups: dict[str, str] = {}
    for index, f in enumerate(files):
        p = Path(f)
        name = p.name
        code = codigos_manuales[name]
        if use_column_rename:
            datos = db_cache.get(str(global_offset + index))
        else:
            datos = db_cache.get(code) or db_cache.get(p.stem)
        if datos:
            sequence_groups[name] = record_group_key(datos, key_column, code)
            nombre_nuevo = apply_catalog_rename(
                engine, p, datos, code, file_seqs[name], key_column
            )
            items.append((f, nombre_nuevo, True))
        else:
            items.append((f, RenamerEngine._preserve_original_name(p), False))

    lookup = db_cache.get if not key_column and not use_column_rename else None
    return RenamePlan(
        items=items,
        codigos_manuales=codigos_manuales,
        file_seqs=file_seqs,
        sequence_groups=sequence_groups,
        lookup=lookup,
    )
