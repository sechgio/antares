from __future__ import annotations

import csv
import io
import re
import unicodedata
from collections.abc import Callable, Mapping
from typing import Any

from openpyxl import load_workbook

ReportRow = dict[str, Any]  # allowlist: tabular imports accept heterogeneous spreadsheet values
NormalizeValue = Callable[[str], str]


def normalize_tabular_header(value: str, *, strip_quotes: bool) -> str:
    if not value:
        return ""
    text = str(value).strip().lower().replace("\ufeff", "")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(character for character in text if not unicodedata.combining(character))
    text = re.sub(r"\b(de|del|la|el)\b", "", text)
    separators = r'''[\s_\.:\-°/()"']+''' if strip_quotes else r"[\s_\.:\-°/()]+"
    return re.sub(separators, "", text)


def normalize_tabular_key(
    value: str,
    column_mapping: Mapping[str, str],
    normalize_header: NormalizeValue,
) -> str:
    mapped = column_mapping.get(normalize_header(value))
    if mapped:
        return mapped
    text = str(value or "").strip().lower().replace("\ufeff", "")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(character for character in text if not unicodedata.combining(character))
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_")


def import_reports(
    filename: str,
    content: bytes,
    *,
    parse_csv: Callable[[bytes], list[ReportRow]],
    parse_xlsx: Callable[[bytes], list[ReportRow]],
    transform_row: Callable[[ReportRow, int], ReportRow],
    to_int: Callable[[Any, int], int],
) -> list[ReportRow]:
    lower_name = filename.lower()
    if lower_name.endswith(".csv"):
        rows = parse_csv(content)
    elif lower_name.endswith((".xlsx", ".xls")):
        rows = parse_xlsx(content)
    else:
        msg = "Formato no soportado. Use archivos .csv o .xlsx"
        raise ValueError(msg)
    if not rows:
        msg = "El archivo esta vacio o no tiene datos validos"
        raise ValueError(msg)

    reports: list[ReportRow] = []
    used_numbers: set[int] = set()
    next_report_number = 1

    for row in rows:
        explicit_number = to_int(row.get("informe_id"), 0)
        if explicit_number > 0 and explicit_number not in used_numbers:
            report_number = explicit_number
        else:
            while next_report_number in used_numbers:
                next_report_number += 1
            report_number = next_report_number

        used_numbers.add(report_number)
        next_report_number = max(next_report_number, report_number) + 1
        reports.append(transform_row(row, report_number))

    return reports


def parse_csv_rows(
    content: bytes,
    *,
    column_mapping: Mapping[str, str],
    normalize_key: NormalizeValue,
) -> list[ReportRow]:
    text: str | None = None
    for encoding in ("utf-8-sig", "utf-8", "latin-1", "cp1252", "iso-8859-1"):
        try:
            text = content.decode(encoding)
            break
        except UnicodeDecodeError:
            continue

    if text is None:
        msg = "No se pudo decodificar el archivo CSV"
        raise ValueError(msg)

    def read_rows(delimiter: str) -> list[ReportRow]:
        reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
        parsed_rows: list[ReportRow] = []
        for row in reader:
            normalized = {normalize_key(key): value for key, value in row.items() if key is not None}
            if any(str(value or "").strip() for value in normalized.values()):
                parsed_rows.append(normalized)
        return parsed_rows

    rows_by_delimiter = {delimiter: read_rows(delimiter) for delimiter in (";", ",", "\t")}

    def mapped_column_count(rows: list[ReportRow]) -> int:
        if not rows:
            return 0
        return sum(key in column_mapping.values() for key in rows[0] if key)

    mapped_columns = {delimiter: mapped_column_count(rows) for delimiter, rows in rows_by_delimiter.items()}
    best_column_count = max(mapped_columns.values())
    if best_column_count >= 1:
        for preferred_delimiter in (";", "\t", ","):
            rows = rows_by_delimiter[preferred_delimiter]
            if mapped_columns[preferred_delimiter] == best_column_count and rows:
                return rows

    return next((rows for rows in rows_by_delimiter.values() if rows), [])


def parse_xlsx_rows(
    content: bytes,
    *,
    column_mapping: Mapping[str, str],
    normalize_header: NormalizeValue,
    normalize_key: NormalizeValue,
) -> list[ReportRow]:
    try:
        workbook = load_workbook(io.BytesIO(content), data_only=True)
    except Exception as err:
        msg = f"Error al abrir el archivo Excel: {err}"
        raise ValueError(msg) from err

    best_rows: list[ReportRow] = []
    best_sheet_score = -1

    for worksheet in workbook.worksheets:
        worksheet_rows = list(worksheet.iter_rows(values_only=True))
        if not worksheet_rows:
            continue

        header_index = -1
        best_score = -1
        for index, values in enumerate(worksheet_rows[:10]):
            non_empty = [value for value in values if value is not None and str(value).strip() != ""]
            if not non_empty:
                continue
            score = sum(normalize_header(str(value)) in column_mapping for value in non_empty)
            if score > best_score:
                best_score = score
                header_index = index

        if header_index == -1 or best_score <= 0:
            for index, values in enumerate(worksheet_rows[:10]):
                if any(value is not None and str(value).strip() != "" for value in values):
                    header_index = index
                    break

        if header_index == -1:
            continue

        keys = [normalize_key(str(header or "")) for header in worksheet_rows[header_index]]
        rows: list[ReportRow] = []
        consecutive_empty = 0
        for values in worksheet_rows[header_index + 1 :]:
            row = {keys[index]: values[index] for index in range(min(len(keys), len(values))) if keys[index]}
            if any(value is not None and str(value or "").strip() != "" for value in row.values()):
                rows.append(row)
                consecutive_empty = 0
            else:
                consecutive_empty += 1
                if consecutive_empty >= 50:
                    break

        if rows and best_score > best_sheet_score:
            best_sheet_score = best_score
            best_rows = rows

    return best_rows
