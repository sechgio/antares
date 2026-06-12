"""History handlers."""
from __future__ import annotations

import base64
import csv
import io
import json
from typing import Any

from backend.handlers.common import with_locale

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


@with_locale
def history_list(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.history import list_runs
    return {
        "runs": list_runs(
            run_type=params.get("run_type"),
            limit=params.get("limit", 50),
            offset=params.get("offset", 0),
            date_from=params.get("date_from"),
            date_to=params.get("date_to"),
        )
    }


@with_locale
def history_get(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.history import get_run
    run = get_run(params.get("id", 0))
    if run:
        run["files"] = json.loads(run["files_json"])
        run["options"] = json.loads(run["options_json"])
    return {"run": run}


@with_locale
def history_delete(params: dict[str, Any]) -> dict[str, bool]:
    from backend.core.history import delete_run
    return {"deleted": delete_run(params.get("id", 0))}


@with_locale
def history_delete_many(params: dict[str, Any]) -> dict[str, int]:
    from backend.core.history import delete_run
    ids = params.get("ids") or []
    deleted = sum(1 for run_id in ids if delete_run(int(run_id)))
    return {"deleted": deleted, "requested": len(ids)}


@with_locale
def history_save(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.history import save_run
    run_id = save_run(
        files=params.get("files", []), options=params.get("options", {}),
        patron=params.get("patron", ""), formato=params.get("formato", ""),
        calidad=params.get("calidad", 0), resize=params.get("resize"),
        ok_count=params.get("ok_count", 0), err_count=params.get("err_count", 0),
        run_type=params.get("run_type", "conversion"),
        duration_ms=params.get("duration_ms"),
    )
    return {"id": run_id}


@with_locale
def history_schema(params: dict[str, Any]) -> dict[str, Any]:
    """Return the run type registry as a JSON-serializable payload.

    The frontend can use this to render dynamic filters / labels and detect
    when the backend has new run types the UI does not yet know about.
    """
    from backend.core.run_types import registry_payload
    from backend.version import __version__
    payload = registry_payload()
    payload["current_version"] = __version__
    return payload


@with_locale
def history_export(params: dict[str, Any]) -> dict[str, Any]:
    """Export historial rows to CSV. Returns ``{"csv": base64, "count": N}``.

    Selection rules (applied in order):
      1. If ``ids`` is provided and non-empty, export those rows (missing ids
         are silently dropped).
      2. Otherwise, apply the optional ``run_type`` / ``date_from`` / ``date_to``
         filter set (same semantics as ``history_list``). A large ``limit`` is
         applied to keep memory bounded.
    """
    from backend.core.history import list_runs, list_runs_by_ids

    ids = params.get("ids") or []
    if ids:
        runs = list_runs_by_ids([int(x) for x in ids])
    else:
        runs = list_runs(
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
    "history_schema": history_schema,
    "history_export": history_export,
}
