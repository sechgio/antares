"""Spreadsheet parse/export handlers (backend replacement for frontend xlsx)."""
from __future__ import annotations

import base64
import contextlib
import csv
import io
import json
import os
import tempfile
import threading
import uuid
import zipfile
from collections import OrderedDict
from datetime import date, datetime, time
from pathlib import Path
from typing import Any

from backend.handlers.common import with_locale

MAX_SPREADSHEET_BYTES = 100 * 1024 * 1024
# Temp files for b64 inline payloads: unique per call (concurrency-safe) and
# deleted by spreadsheet_parse after parsing — never left in %TEMP%.
_INLINE_TEMP_PREFIX = "antares_inline_"
_INLINE_B64_CHUNK_CHARS = 1024 * 1024  # divisible by 4; ~768 KiB decoded per block
MAX_SHEETS = 50
MAX_CELLS = 2_000_000
MAX_ZIP_RATIO = 100
# Keep small workbooks inline on IPC; larger grids spill to a temp JSON file.
INLINE_RESULT_MAX_BYTES = 512 * 1024
DEFAULT_GET_ROWS_LIMIT = 500
MAX_GET_ROWS_LIMIT = 5_000
_SUPPORTED_FORMATS = frozenset({"xlsx", "xls", "csv"})

# ─── Spill cache ────────────────────────────────────────────────────────────
# La paginación (spreadsheet_get_rows) releía y re-parseaba el JSON completo
# del spill en CADA página (O(archivo) por request, hasta MAX_SPREADSHEET_BYTES).
# LRU acotado por número de entradas y por tamaño de entrada: un spill de
# 100 MB nunca queda retenido en RAM. La clave incluye (mtime_ns, size) para
# que una reescritura invalide; un spill borrado por file_token_read_json
# (Electron) falla en el stat() antes de consultar el cache — nunca se sirven
# datos obsoletos.
_SPILL_CACHE_MAX_ENTRIES = 2
_SPILL_CACHE_MAX_ENTRY_BYTES = 8 * 1024 * 1024

_spill_cache: OrderedDict[tuple[str, int, int], dict[str, Any]] = OrderedDict()
_spill_cache_lock = threading.Lock()


def _clear_spreadsheet_caches() -> None:
    """Clear all in-memory static caches in spreadsheet handler."""
    with _spill_cache_lock:
        _spill_cache.clear()


def _spill_dir() -> Path:
    out = Path(tempfile.gettempdir()) / "antares-spreadsheet-results"
    out.mkdir(parents=True, exist_ok=True)
    return out


def _write_sheet_cache(name: str, sheets: list[dict[str, Any]], warnings: list[str]) -> Path:
    payload = {"workbookName": name, "sheets": sheets, "warnings": warnings}
    out_path = _spill_dir() / f"{uuid.uuid4().hex}.json"
    out_path.write_text(json.dumps(payload, ensure_ascii=False, default=str), encoding="utf-8")
    return out_path


def _load_sheet_cache(path: Path) -> dict[str, Any]:
    if not path.is_file():
        msg = "cache de spreadsheet no encontrado"
        raise FileNotFoundError(msg)
    if path.is_symlink():
        raise ValueError("symlink no permitido")
    try:
        st = path.stat()
    except OSError as exc:
        raise FileNotFoundError(str(exc)) from exc
    key = (str(path.resolve()), st.st_mtime_ns, st.st_size)
    with _spill_cache_lock:
        cached = _spill_cache.get(key)
        if cached is not None:
            _spill_cache.move_to_end(key)
            return cached
    if st.st_size > MAX_SPREADSHEET_BYTES:
        msg = "cache de spreadsheet demasiado grande"
        raise ValueError(msg)
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    if not isinstance(data, dict) or not isinstance(data.get("sheets"), list):
        msg = "cache de spreadsheet corrupto"
        raise ValueError(msg)
    if st.st_size <= _SPILL_CACHE_MAX_ENTRY_BYTES:
        with _spill_cache_lock:
            _spill_cache[key] = data
            _spill_cache.move_to_end(key)
            while len(_spill_cache) > _SPILL_CACHE_MAX_ENTRIES:
                _spill_cache.popitem(last=False)
    return data


def _resolve_cache_path(params: dict[str, Any]) -> Path:
    raw = (
        params.get("_resolved_file_token_path")
        or params.get("cache_token")
        or params.get("result_path")
        or params.get("path")
    )
    if not raw:
        msg = "cache_token o result_path requerido"
        raise ValueError(msg)
    p = Path(str(raw)).expanduser()
    # Only allow reads from our spill directory (or capability-resolved paths).
    spill = _spill_dir().resolve()
    try:
        resolved = p.resolve()
    except OSError as exc:
        raise FileNotFoundError(str(exc)) from exc
    if params.get("_resolved_file_token_path"):
        return resolved
    if spill not in resolved.parents and resolved.parent != spill:
        msg = "ruta de cache fuera del directorio permitido"
        raise ValueError(msg)
    return resolved


def _serialize_cell(value: Any) -> Any:
    """Make cell values JSON-safe for IPC (openpyxl may return datetime/date)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.time() == time(0, 0):
            return value.date().isoformat()
        return value.isoformat(sep=" ", timespec="seconds")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, time):
        return value.isoformat(timespec="seconds")
    return value


def _trim_row(values: list[Any]) -> list[Any] | None:
    while values and values[-1] is None:
        values.pop()
    return values or None


def _validate_zip_bomb(path: Path) -> None:
    try:
        with path.open("rb") as fh:
            header = fh.read(4)
        if header != b"PK\x03\x04":
            return
    except OSError:
        return
    try:
        with zipfile.ZipFile(path) as zf:
            total_compressed = sum(i.compress_size for i in zf.infolist())
            total_uncompressed = sum(i.file_size for i in zf.infolist())
            if total_compressed > 0 and total_uncompressed / total_compressed > MAX_ZIP_RATIO:
                msg = "Posible zip bomb detectado"
                raise ValueError(msg)
            if total_uncompressed > MAX_SPREADSHEET_BYTES * 10:
                msg = "Archivo descomprimido demasiado grande"
                raise ValueError(msg)
    except zipfile.BadZipFile as exc:
        msg = f"Archivo xlsx corrupto: {exc}"
        raise ValueError(msg) from exc


def _decode_inline_base64_to_fd(encoded: str, fd: int) -> None:
    """Decode an inline payload without materializing the whole file in RAM."""
    max_encoded_chars = ((MAX_SPREADSHEET_BYTES + 2) // 3) * 4
    if len(encoded) > max_encoded_chars:
        msg = f"Archivo excede {MAX_SPREADSHEET_BYTES // (1024*1024)} MiB"
        raise ValueError(msg)

    total = 0
    for start in range(0, len(encoded), _INLINE_B64_CHUNK_CHARS):
        chunk = encoded[start : start + _INLINE_B64_CHUNK_CHARS]
        if "=" in chunk and start + len(chunk) < len(encoded):
            raise ValueError("Payload base64 inválido")
        decoded = base64.b64decode(chunk, validate=True)
        total += len(decoded)
        if total > MAX_SPREADSHEET_BYTES:
            msg = f"Archivo excede {MAX_SPREADSHEET_BYTES // (1024*1024)} MiB"
            raise ValueError(msg)
        written = 0
        while written < len(decoded):
            count = os.write(fd, decoded[written:])
            if count <= 0:
                raise OSError("No se pudo escribir el payload temporal")
            written += count


def _resolve_input_path(params: dict[str, Any]) -> tuple[Path, bool]:
    """Resuelve la entrada a parsear. Devuelve ``(path, is_temp)``: ``is_temp``
    es True solo cuando el archivo fue creado aquí para un payload b64 inline
    (el único que la llamada puede borrar tras parsear)."""
    # Resolved by Electron file-capabilities; fallback to legacy path for compat
    raw = params.get("_resolved_file_token_path") or params.get("file_token") or params.get("path") or params.get("excelPath")
    if not raw:
        # Also support b64 inline for panel-aviso-corte compat
        b64 = params.get("xlsx_b64")
        if b64:
            import tempfile

            fd, tmp_name = tempfile.mkstemp(suffix=".xlsx", prefix=_INLINE_TEMP_PREFIX)
            tmp_path = Path(tmp_name)
            try:
                try:
                    _decode_inline_base64_to_fd(b64, fd)
                finally:
                    os.close(fd)
            except Exception:
                # Never leave a half-written temp file behind (e.g. disk full).
                with contextlib.suppress(OSError):
                    tmp_path.unlink(missing_ok=True)
                raise
            if tmp_path.stat().st_size == 0:
                with contextlib.suppress(OSError):
                    tmp_path.unlink(missing_ok=True)
                msg = "El archivo está vacío"
                raise ValueError(msg)
            return tmp_path, True
        msg = "file_token o path requerido"
        raise ValueError(msg)
    p = Path(str(raw)).expanduser()
    if not p.exists():
        raw_name = params.get("_resolved_file_token_name")
        hint = f" ({raw_name})" if raw_name else ""
        msg = f"No se encontró el archivo{hint}: {p}"
        raise FileNotFoundError(msg)
    if p.stat().st_size > MAX_SPREADSHEET_BYTES:
        msg = f"Archivo excede {MAX_SPREADSHEET_BYTES // (1024*1024)} MiB"
        raise ValueError(msg)
    if p.is_symlink():
        raise ValueError("symlink no permitido")
    if p.stat().st_size == 0:
        msg = "El archivo está vacío"
        raise ValueError(msg)
    return p, False


def _detect_format_from_content(path: Path) -> str | None:
    try:
        with path.open("rb") as f:
            header = f.read(8)
        if header[:4] == b"PK\x03\x04":
            return "xlsx"
        if header[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
            return "xls"
        header_text = header.decode("utf-8", errors="ignore").strip()
        if "," in header_text or ";" in header_text:
            return "csv"
    except OSError:
        return None
    return None


def _resolve_format(params: dict[str, Any], path: Path) -> tuple[str, str]:
    """Return (fmt, token_name). Prefer format_hint, then original name, then sniff."""
    hint = str(params.get("format_hint") or "").lower().lstrip(".")
    token_name = str(params.get("_resolved_file_token_name") or "").strip()
    token_ext = Path(token_name).suffix.lower().lstrip(".") if token_name else ""
    path_ext = path.suffix.lower().lstrip(".")
    # Ignore staging leftovers like ".tmp"
    if path_ext == "tmp":
        path_ext = ""

    for candidate in (hint, token_ext, path_ext):
        if candidate in _SUPPORTED_FORMATS:
            return candidate, token_name

    detected = _detect_format_from_content(path)
    if detected:
        return detected, token_name

    shown = hint or token_ext or path.suffix or "desconocido"
    msg = f"Formato no soportado: {shown}"
    raise ValueError(msg)


def _parse_xlsx(path: Path) -> tuple[str, list[dict[str, Any]], list[str]]:
    import openpyxl  # type: ignore

    _validate_zip_bomb(path)
    # A file-like object does not depend on the staging suffix and avoids a
    # second in-memory copy of the complete workbook.
    with path.open("rb") as source:
        wb = openpyxl.load_workbook(source, read_only=True, data_only=True)
        warnings: list[str] = []
        sheets: list[dict[str, Any]] = []
        total_cells = 0
        sheet_count = 0
        try:
            for ws in wb.worksheets:
                sheet_count += 1
                if sheet_count > MAX_SHEETS:
                    warnings.append(f"Se truncó a {MAX_SHEETS} hojas")
                    break
                rows: list[list[Any]] = []
                for row in ws.iter_rows(values_only=True):
                    if row is None:
                        continue
                    vals = _trim_row([_serialize_cell(v) for v in row])
                    if vals is None:
                        continue
                    total_cells += len(vals)
                    if total_cells > MAX_CELLS:
                        warnings.append("Se alcanzó el límite de celdas (2M)")
                        break
                    rows.append(vals)
                sheets.append({"name": ws.title, "rows": rows})
                if total_cells > MAX_CELLS:
                    break
        finally:
            with contextlib.suppress(Exception):
                wb.close()
    return (path.name, sheets, warnings)


def _parse_xls(path: Path) -> tuple[str, list[dict[str, Any]], list[str]]:
    import xlrd  # type: ignore

    book = xlrd.open_workbook(str(path))
    warnings: list[str] = []
    sheets: list[dict[str, Any]] = []
    total_cells = 0
    if book.nsheets > MAX_SHEETS:
        warnings.append(f"Se truncó a {MAX_SHEETS} hojas")
    for idx in range(min(book.nsheets, MAX_SHEETS)):
        sh = book.sheet_by_index(idx)
        rows: list[list[Any]] = []
        for r in range(sh.nrows):
            vals = _trim_row(
                [_serialize_cell(sh.cell_value(r, c)) if sh.cell_value(r, c) != "" else None for c in range(sh.ncols)],
            )
            if vals is None:
                continue
            total_cells += len(vals)
            if total_cells > MAX_CELLS:
                warnings.append("Se alcanzó el límite de celdas (2M)")
                break
            rows.append(vals)
        sheets.append({"name": sh.name, "rows": rows})
        if total_cells > MAX_CELLS:
            break
    return (path.name, sheets, warnings)


def _parse_csv(path: Path) -> tuple[str, list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    rows: list[list[Any]] = []
    total_cells = 0
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        for row in reader:
            vals = _trim_row([v if v != "" else None for v in row])
            if vals is None:
                continue
            total_cells += len(vals)
            if total_cells > MAX_CELLS:
                warnings.append("Se alcanzó el límite de celdas (2M)")
                break
            if len(rows) > 200_000:
                warnings.append("CSV truncado a 200k filas")
                break
            rows.append(vals)
    return (path.name, [{"name": path.stem, "rows": rows}], warnings)


@with_locale
def spreadsheet_parse(params: dict[str, Any]) -> dict[str, Any]:
    p, is_temp = _resolve_input_path(params)
    try:
        fmt, token_name = _resolve_format(params, p)
        if fmt == "xlsx":
            name, sheets, warnings = _parse_xlsx(p)
        elif fmt == "xls":
            name, sheets, warnings = _parse_xls(p)
        else:
            name, sheets, warnings = _parse_csv(p)
    finally:
        # b64 inline payloads live in a per-call temp file; never leave it in
        # %TEMP%. Best-effort: a Windows lock must not fail a successful parse.
        # Only delete files this handler created (is_temp) — a user file named
        # like a temp must never be unlinked.
        if is_temp:
            with contextlib.suppress(OSError):
                p.unlink(missing_ok=True)
    if token_name:
        name = token_name
    payload: dict[str, Any] = {"workbookName": name, "sheets": sheets, "warnings": warnings}
    encoded = json.dumps(payload, ensure_ascii=False, default=str)
    if len(encoded.encode("utf-8")) <= INLINE_RESULT_MAX_BYTES:
        return payload

    out_path = _write_sheet_cache(name, sheets, warnings)
    return {
        "workbookName": name,
        "sheets": [],
        "warnings": warnings,
        "result_path": str(out_path),
        "sheet_meta": [{"name": s["name"], "rowCount": len(s["rows"])} for s in sheets],
    }


@with_locale
def spreadsheet_get_rows(params: dict[str, Any]) -> dict[str, Any]:
    """Return a page of rows from a spilled spreadsheet_parse cache."""
    cache_path = _resolve_cache_path(params)
    data = _load_sheet_cache(cache_path)
    sheets: list[dict[str, Any]] = data["sheets"]
    if not sheets:
        return {"name": "", "rows": [], "offset": 0, "limit": 0, "total": 0, "has_more": False}

    sheet_name = params.get("sheet") or params.get("sheet_name")
    sheet_index = params.get("sheet_index")
    chosen: dict[str, Any] | None = None
    if isinstance(sheet_name, str) and sheet_name:
        chosen = next((s for s in sheets if s.get("name") == sheet_name), None)
    elif sheet_index is not None:
        try:
            idx = int(sheet_index)
        except (TypeError, ValueError) as exc:
            raise ValueError("sheet_index inválido") from exc
        if 0 <= idx < len(sheets):
            chosen = sheets[idx]
    else:
        chosen = sheets[0]

    if chosen is None:
        msg = "hoja no encontrada en el cache"
        raise ValueError(msg)

    raw_rows = chosen.get("rows")
    rows: list[Any] = raw_rows if isinstance(raw_rows, list) else []
    try:
        offset = max(0, int(params.get("offset") or 0))
    except (TypeError, ValueError) as exc:
        raise ValueError("offset inválido") from exc
    try:
        limit = int(params.get("limit") or DEFAULT_GET_ROWS_LIMIT)
    except (TypeError, ValueError) as exc:
        raise ValueError("limit inválido") from exc
    limit = max(1, min(limit, MAX_GET_ROWS_LIMIT))

    page = rows[offset : offset + limit]
    total = len(rows)
    return {
        "name": str(chosen.get("name") or ""),
        "rows": page,
        "offset": offset,
        "limit": limit,
        "total": total,
        "has_more": offset + len(page) < total,
    }


@with_locale
def spreadsheet_export_volantes_template(params: dict[str, Any]) -> dict[str, Any]:
    output_path = str(params.get("output_path") or params.get("path") or "").strip() or None
    resolved = str(params.get("_resolved_output_path") or output_path or "").strip() or output_path
    try:
        import pandas as pd  # type: ignore
    except ImportError as exc:
        msg = "pandas no está instalado."
        raise ImportError(msg) from exc

    columns = ["item", "sgio", "distrito", "fecha", "hora_inicio", "hora_fin", "reservorio", "sector", "zonas_afectadas"]
    data = [[1, "454654001", "ATE VITARTE", "2026-02-26", "08:00", "20:00", "CR-121 HUASCAR", "SECTOR 411", "AH UPIS Huascar, AH Belen, AH Vista Alegre, AH San Lorenzo"]]
    df = pd.DataFrame(data, columns=columns)

    if resolved:
        from pathlib import Path as _P

        from backend.utils.validators import sanitizar_nombre as _sn
        safe = _sn(_P(resolved).name) or _P(resolved).name
        if not safe.lower().endswith(".xlsx"):
            safe += ".xlsx"
        dest = _P(resolved).parent / safe
        if dest.is_symlink() or dest.parent.is_symlink():
            raise ValueError("symlink no permitido en ruta de salida")
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() and not params.get("overwrite"):
            raise FileExistsError(f"El archivo ya existe: {dest}")
        df.to_excel(dest, index=False, engine="openpyxl")
        return {"path": str(dest), "filename": dest.name}

    # Inline base64 fallback
    buf = io.BytesIO()
    df.to_excel(buf, index=False, engine="openpyxl")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return {"content_b64": b64, "filename": "plantilla-volantes.xlsx"}


HANDLERS = {
    "spreadsheet_parse": spreadsheet_parse,
    "spreadsheet_get_rows": spreadsheet_get_rows,
    "spreadsheet_export_volantes_template": spreadsheet_export_volantes_template,
}
