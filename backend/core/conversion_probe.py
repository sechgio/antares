from __future__ import annotations

import contextlib
import logging
from pathlib import Path
from typing import Any, cast

from backend.core.observability import log_event
from backend.core.renamer import RenamerEngine, SequenceMode
from backend.utils.validators import parse_filename_parts

logger = logging.getLogger(__name__)

_SEQUENCE_MODES = {"record", "global", "filename"}


@contextlib.contextmanager
def _engine_snapshot(engine: RenamerEngine):
    seq_backup = engine.secuencia
    record_sequences_backup = engine._record_sequences.copy()
    try:
        yield
    finally:
        engine.secuencia = seq_backup
        engine._record_sequences = record_sequences_backup


def _resolve_sequence_mode(params: dict[str, Any]) -> SequenceMode:
    requested = params.get("sequence_mode")
    if isinstance(requested, str) and requested in _SEQUENCE_MODES:
        return cast(SequenceMode, requested)
    return "filename" if params.get("use_filename_seq", True) else "global"


def _resolve_file_mapping(params: dict[str, Any]) -> tuple[dict[str, str] | None, str]:  # allowlist: dict[str, Any]
    """El `mapping` inline gana; si falta, parsea `mapping_path` con id/rename column.

    Compartido por `preview` y `_run_conversion_job` para que ambos elijan
    la misma fuente de renombrado.
    """
    file_mapping = params.get("mapping") or None
    mapping_path = params.get("mapping_path") or ""
    if mapping_path and not file_mapping:
        from backend.core.database import parse_id_rename_mapping

        file_mapping = parse_id_rename_mapping(
            mapping_path,
            id_column=params.get("id_column") or None,
            rename_column=params.get("rename_column") or None,
        )
    return file_mapping, mapping_path


def _probe_key_columns(
    files: list[str],
    columns: list[str],
    sample_size: int = 30,
) -> tuple[str, int, list[tuple[str, int]], bool]:
    from backend.core.database import contar_por_columna

    sample_files = files[:sample_size]
    codigos: list[str] = []
    stems: list[str] = []
    for f in sample_files:
        p = Path(f)
        code, _ = parse_filename_parts(p.name)
        codigos.append(code)
        stems.append(p.stem)
    search_keys = list(set(codigos + stems))
    if not search_keys:
        return columns[0], -1, [], False

    best_col = columns[0]
    best_count = -1
    per_column: list[tuple[str, int]] = []
    for col in columns:
        try:
            count = contar_por_columna(search_keys, col)
        except Exception as exc:
            log_event(
                logger,
                logging.WARNING,
                "conversion.catalog_probe_failed",
                outcome="failed",
                message=f"No se pudo sondear la columna de catálogo {col}: {exc}",
                exc_info=True,
            )
            count = -1
        per_column.append((col, count))
        if count > best_count:
            best_count = count
            best_col = col
    return best_col, best_count, per_column, True


def _resolve_key_column(
    key_column: str | None,
    files: list[str],
    db_columns: list[str] | None = None,
    *,
    sample_size: int = 30,
    probe_result: tuple[str, int, list[tuple[str, int]], bool] | None = None,
) -> str:
    from backend.core.config_fields import get_field_names

    columns = db_columns if db_columns is not None else get_field_names()
    if not columns:
        return key_column  # type: ignore[return-value]
    if len(columns) == 1:
        return columns[0]

    if probe_result is None:
        probe_result = _probe_key_columns(files, columns, sample_size=sample_size)
    best_col, best_count, per_column, had_keys = probe_result
    if not had_keys:
        return best_col
    if key_column and key_column in columns:
        user_count = dict(per_column).get(key_column, -1)
        if user_count >= 0 and user_count >= best_count and user_count > 0:
            return key_column
    return best_col


def _preview_detect_fields(
    files: list[str],
    db_cols: list[str],
) -> tuple[dict[str, Any], tuple[str, int, list[tuple[str, int]], bool] | None]:
    if len(db_cols) <= 1:
        return {}, None
    probe = _probe_key_columns(files, db_cols)
    best_col, best_count, _, had_keys = probe
    if not had_keys:
        return {"detected_key_column": best_col, "detected_key_column_matches": 0}, probe
    return {
        "detected_key_column": best_col,
        "detected_key_column_matches": best_count,
    }, probe
