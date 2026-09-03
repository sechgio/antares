from __future__ import annotations

import base64
import csv
import io
import json
from typing import Any

from backend.core.import_guard import serialized_import
from backend.handlers.common import parse_positive_int, with_locale

_CSV_COLUMNS = [
    "id",
    "run_type",
    "timestamp",
    "formato",
    "calidad",
    "ok_count",
    "err_count",
    "duration_ms",
    "app_version",
    "schema_version",
    "patron",
    "files_count",
    "options_json",
]


def _core_history() -> Any:
    with serialized_import():
        from backend.core import history

    return history


def _safe_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


@with_locale
def history_list(params: dict[str, Any]) -> dict[str, Any]:
    core = _core_history()
    limit = parse_positive_int(params.get("limit", 50), "limit", maximum=500)
    offset = _parse_history_offset(params.get("offset", 0))
    return {
        "runs": core.list_runs(
            run_type=params.get("run_type"),
            limit=limit,
            offset=offset,
            date_from=params.get("date_from"),
            date_to=params.get("date_to"),
        )
    }


def _parse_history_offset(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        msg = "offset inválido"
        raise ValueError(msg) from exc
    if parsed < 0:
        msg = "offset no puede ser negativo"
        raise ValueError(msg)
    return parsed


@with_locale
def history_get(params: dict[str, Any]) -> dict[str, Any]:
    core = _core_history()
    run_id = parse_positive_int(params.get("id"), "id")
    run = core.get_run(run_id)
    if run is None:
        msg = f"Run not found: {run_id}"
        raise ValueError(msg)
    run["files"] = json.loads(run["files_json"])
    run["options"] = json.loads(run["options_json"])
    return {"run": run}


@with_locale
def history_delete(params: dict[str, Any]) -> dict[str, bool]:
    core = _core_history()
    return {"deleted": core.delete_run(params.get("id", 0))}


@with_locale
def history_delete_many(params: dict[str, Any]) -> dict[str, int]:
    core = _core_history()
    ids = params.get("ids") or []
    deleted = 0
    for run_id in ids:
        rid = _safe_int(run_id)
        if rid is not None and core.delete_run(rid):
            deleted += 1
    return {"deleted": deleted, "requested": len(ids)}


@with_locale
def history_save(params: dict[str, Any]) -> dict[str, Any]:
    core = _core_history()
    run_id = core.save_run(
        files=params.get("files", []), options=params.get("options", {}),
        patron=params.get("patron", ""), formato=params.get("formato", ""),
        calidad=params.get("calidad", 0), resize=params.get("resize"),
        ok_count=params.get("ok_count", 0), err_count=params.get("err_count", 0),
        run_type=params.get("run_type", "conversion"),
        duration_ms=params.get("duration_ms"),
    )
    return {"id": run_id}


def history_export(params: dict[str, Any]) -> dict[str, Any]:
    core = _core_history()

    ids = params.get("ids") or []
    if ids:
        valid_ids = [rid for rid in (_safe_int(x) for x in ids) if rid is not None]
        runs = core.list_runs_by_ids(valid_ids) if valid_ids else []
    else:
        runs = core.list_runs(
            run_type=params.get("run_type"),
            limit=params.get("limit", 10_000),
            offset=0,
            date_from=params.get("date_from"),
            date_to=params.get("date_to"),
        )

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=_CSV_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for run in runs:
        try:
            files = json.loads(run.get("files_json") or "[]")
            files_count = len(files) if isinstance(files, list) else 0
        except (TypeError, ValueError):
            files_count = 0
        writer.writerow(
            {
                "id": run.get("id"),
                "run_type": run.get("run_type"),
                "timestamp": run.get("timestamp"),
                "formato": run.get("formato"),
                "calidad": run.get("calidad"),
                "ok_count": run.get("ok_count"),
                "err_count": run.get("err_count"),
                "duration_ms": run.get("duration_ms"),
                "app_version": run.get("app_version"),
                "schema_version": run.get("schema_version"),
                "patron": run.get("patron"),
                "files_count": files_count,
                "options_json": run.get("options_json"),
            }
        )
    encoded = base64.b64encode(buffer.getvalue().encode("utf-8")).decode("ascii")
    return {"csv": encoded, "count": len(runs)}


HANDLERS = {
    "history_list": history_list,
    "history_get": history_get,
    "history_delete": history_delete,
    "history_delete_many": history_delete_many,
    "history_save": history_save,
    "history_export": history_export,
}
