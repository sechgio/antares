from __future__ import annotations

import contextlib
import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any


class SpreadsheetResultBuilder:
    def __init__(self, workbook_name: str, *, inline_max_bytes: int, spill_dir: Path) -> None:
        self.workbook_name = workbook_name
        self.inline_max_bytes = inline_max_bytes
        self.spill_dir = spill_dir
        self.sheets: list[dict[str, Any]] = []  # allowlist: dict[str, Any]
        self.sheet_meta: list[dict[str, Any]] = []  # allowlist: dict[str, Any]
        self._buffered_row_bytes = 0
        self._conn: sqlite3.Connection | None = None
        self._path: Path | None = None

    def start_sheet(self, name: str) -> int:
        sheet_index = len(self.sheet_meta)
        self.sheet_meta.append({"name": name, "rowCount": 0})
        if self._conn is None:
            self.sheets.append({"name": name, "rows": []})
        return sheet_index

    def append_row(self, sheet_index: int, row: list[Any]) -> None:
        encoded = json.dumps(row, ensure_ascii=False, default=str)
        encoded_bytes = len(encoded.encode("utf-8"))
        if self._conn is None and self._buffered_row_bytes + encoded_bytes > self.inline_max_bytes:
            self._open_spill()

        row_index = int(self.sheet_meta[sheet_index]["rowCount"])
        if self._conn is None:
            self.sheets[sheet_index]["rows"].append(row)
            self._buffered_row_bytes += encoded_bytes
        else:
            self._conn.execute(
                "INSERT INTO rows (sheet_index, row_index, row_json) VALUES (?, ?, ?)",
                (sheet_index, row_index, encoded),
            )
        self.sheet_meta[sheet_index]["rowCount"] = row_index + 1

    def finish(self, warnings: list[str]) -> dict[str, Any]:  # allowlist: dict[str, Any]
        if self._conn is None:
            payload: dict[str, Any] = {  # allowlist: dict[str, Any]
                "workbookName": self.workbook_name,
                "sheets": self.sheets,
                "warnings": warnings,
            }
            encoded = json.dumps(payload, ensure_ascii=False, default=str)
            if len(encoded.encode("utf-8")) <= self.inline_max_bytes:
                return payload
            self._open_spill()

        assert self._conn is not None
        assert self._path is not None
        try:
            self._conn.executemany(
                "INSERT INTO metadata (key, value) VALUES (?, ?)",
                (
                    ("workbookName", self.workbook_name),
                    ("warnings", json.dumps(warnings, ensure_ascii=False)),
                ),
            )
            self._conn.executemany(
                "INSERT INTO sheets (sheet_index, name, row_count) VALUES (?, ?, ?)",
                (
                    (sheet_index, str(meta["name"]), int(meta["rowCount"]))
                    for sheet_index, meta in enumerate(self.sheet_meta)
                ),
            )
            self._conn.commit()
        except Exception:
            self.abort()
            raise
        finally:
            if self._conn is not None:
                self._conn.close()
                self._conn = None

        return {
            "workbookName": self.workbook_name,
            "sheets": [],
            "warnings": warnings,
            "result_path": str(self._path),
            "sheet_meta": self.sheet_meta,
        }

    def abort(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None
        if self._path is not None:
            with contextlib.suppress(OSError):
                self._path.unlink(missing_ok=True)

    def _open_spill(self) -> None:
        if self._conn is not None:
            return
        self._path = self.spill_dir / f"{uuid.uuid4().hex}.sqlite3"
        try:
            self._conn = sqlite3.connect(self._path)
            self._conn.executescript(
                """
                CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
                CREATE TABLE sheets (
                    sheet_index INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    row_count INTEGER NOT NULL
                );
                CREATE TABLE rows (
                    sheet_index INTEGER NOT NULL,
                    row_index INTEGER NOT NULL,
                    row_json TEXT NOT NULL,
                    PRIMARY KEY (sheet_index, row_index)
                ) WITHOUT ROWID;
                """,
            )
            for sheet_index, sheet in enumerate(self.sheets):
                rows = sheet["rows"]
                self._conn.executemany(
                    "INSERT INTO rows (sheet_index, row_index, row_json) VALUES (?, ?, ?)",
                    (
                        (sheet_index, row_index, json.dumps(row, ensure_ascii=False, default=str))
                        for row_index, row in enumerate(rows)
                    ),
                )
            self.sheets.clear()
            self._buffered_row_bytes = 0
        except Exception:
            self.abort()
            raise


def is_indexed_sheet_cache(path: Path) -> bool:
    try:
        with path.open("rb") as fh:
            return fh.read(16) == b"SQLite format 3\x00"
    except OSError:
        return False


def load_indexed_sheet_page(
    path: Path,
    *,
    sheet_name: str | None,
    sheet_index: Any,
    offset: int,
    limit: int,
) -> dict[str, Any]:  # allowlist: dict[str, Any]
    if not path.is_file():
        raise FileNotFoundError("cache de spreadsheet no encontrado")
    if path.is_symlink():
        raise ValueError("symlink no permitido")

    resolved = path.resolve()
    conn = sqlite3.connect(f"{resolved.as_uri()}?mode=ro", uri=True)
    try:
        chosen: tuple[int, str, int] | None = None
        if sheet_name:
            chosen = conn.execute(
                "SELECT sheet_index, name, row_count FROM sheets WHERE name = ? ORDER BY sheet_index LIMIT 1",
                (sheet_name,),
            ).fetchone()
        elif sheet_index is not None:
            try:
                idx = int(sheet_index)
            except (TypeError, ValueError) as exc:
                raise ValueError("sheet_index inválido") from exc
            chosen = conn.execute(
                "SELECT sheet_index, name, row_count FROM sheets WHERE sheet_index = ?",
                (idx,),
            ).fetchone()
        else:
            chosen = conn.execute(
                "SELECT sheet_index, name, row_count FROM sheets ORDER BY sheet_index LIMIT 1",
            ).fetchone()

        if chosen is None:
            count = conn.execute("SELECT COUNT(*) FROM sheets").fetchone()[0]
            if count == 0:
                return {"name": "", "rows": [], "offset": 0, "limit": 0, "total": 0, "has_more": False}
            raise ValueError("hoja no encontrada en el cache")

        chosen_index, chosen_name, total = chosen
        encoded_rows = conn.execute(
            """
            SELECT row_json
            FROM rows
            WHERE sheet_index = ? AND row_index >= ? AND row_index < ?
            ORDER BY row_index
            """,
            (chosen_index, offset, offset + limit),
        ).fetchall()
        rows = [json.loads(row[0]) for row in encoded_rows]
        return {
            "name": chosen_name,
            "rows": rows,
            "offset": offset,
            "limit": limit,
            "total": total,
            "has_more": offset + len(rows) < total,
        }
    except sqlite3.DatabaseError as exc:
        raise ValueError("cache de spreadsheet corrupto") from exc
    finally:
        conn.close()
