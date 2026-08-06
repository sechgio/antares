"""Spreadsheet parse/export handlers (backend replacement for frontend xlsx)."""
from __future__ import annotations

import base64
import csv
import io
import os
import zipfile
from pathlib import Path
from typing import Any

from backend.handlers.common import with_locale

MAX_SPREADSHEET_BYTES = 100 * 1024 * 1024
MAX_SHEETS = 50
MAX_CELLS = 2_000_000
MAX_ZIP_RATIO = 100


def _validate_zip_bomb(path: Path) -> None:
    if path.suffix.lower() != ".xlsx":
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


def _resolve_input_path(params: dict[str, Any]) -> Path:
    # Resolved by Electron file-capabilities; fallback to legacy path for compat
    raw = params.get("_resolved_file_token_path") or params.get("file_token") or params.get("path") or params.get("excelPath")
    if not raw:
        # Also support b64 inline for panel-aviso-corte compat
        b64 = params.get("xlsx_b64")
        if b64:
            content = base64.b64decode(b64, validate=True)
            p = Path(os.environ.get("TMP", "/tmp")) / f"antares_inline_{os.getpid()}.xlsx"
            p.write_bytes(content)
            return p
        msg = "file_token o path requerido"
        raise ValueError(msg)
    p = Path(str(raw)).expanduser()
    if not p.exists():
        msg = f"No se encontró el archivo: {p}"
        raise FileNotFoundError(msg)
    if p.stat().st_size > MAX_SPREADSHEET_BYTES:
        msg = f"Archivo excede {MAX_SPREADSHEET_BYTES // (1024*1024)} MiB"
        raise ValueError(msg)
    if p.is_symlink():
        raise ValueError("symlink no permitido")
    return p


def _parse_xlsx(path: Path) -> tuple[str, list[dict[str, Any]], list[str]]:
    import openpyxl  # type: ignore

    _validate_zip_bomb(path)
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    warnings: list[str] = []
    sheets: list[dict[str, Any]] = []
    total_cells = 0
    sheet_count = 0
    for ws in wb.worksheets:
        sheet_count += 1
        if sheet_count > MAX_SHEETS:
            warnings.append(f"Se truncó a {MAX_SHEETS} hojas")
            break
        rows: list[list[Any]] = []
        for row in ws.iter_rows(values_only=True):
            if row is None:
                continue
            vals = [v if v is not None else None for v in row]
            # Trim trailing None
            while vals and vals[-1] is None:
                vals.pop()
            if not vals:
                continue
            total_cells += len(vals)
            if total_cells > MAX_CELLS:
                warnings.append("Se alcanzó el límite de celdas (2M)")
                break
            rows.append(vals)
            if total_cells > MAX_CELLS:
                break
        sheets.append({"name": ws.title, "rows": rows})
        if total_cells > MAX_CELLS:
            break
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
            vals = [sh.cell_value(r, c) if sh.cell_value(r, c) != "" else None for c in range(sh.ncols)]
            while vals and vals[-1] is None:
                vals.pop()
            if not vals:
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
            vals: list[Any] = [v if v != "" else None for v in row]
            while vals and vals[-1] is None:
                vals.pop()
            if not vals:
                continue
            total_cells += len(vals)
            if total_cells > MAX_CELLS:
                warnings.append("Se alcanzó el límite de celdas (2M)")
                break
            # Cap rows arbitrarily at 200k to avoid huge CSVs
            if len(rows) > 200_000:
                warnings.append("CSV truncado a 200k filas")
                break
            rows.append(vals)
    return (path.name, [{"name": path.stem, "rows": rows}], warnings)


@with_locale
def spreadsheet_parse(params: dict[str, Any]) -> dict[str, Any]:
    hint = str(params.get("format_hint") or "").lower()
    p = _resolve_input_path(params)
    ext = p.suffix.lower()
    fmt = hint or ext.lstrip(".")
    if fmt in ("xlsx",):
        name, sheets, warnings = _parse_xlsx(p)
    elif fmt in ("xls",):
        name, sheets, warnings = _parse_xls(p)
    elif fmt in ("csv",):
        name, sheets, warnings = _parse_csv(p)
    else:
        # Try by extension
        if ext == ".xlsx":
            name, sheets, warnings = _parse_xlsx(p)
        elif ext == ".xls":
            name, sheets, warnings = _parse_xls(p)
        elif ext == ".csv":
            name, sheets, warnings = _parse_csv(p)
        else:
            msg = f"Formato no soportado: {ext or fmt}"
            raise ValueError(msg)
    return {"workbookName": name, "sheets": sheets, "warnings": warnings}


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
    "spreadsheet_export_volantes_template": spreadsheet_export_volantes_template,
}
