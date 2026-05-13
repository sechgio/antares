"""History handlers."""
from __future__ import annotations

import json
from typing import Any

from backend.handlers.common import with_locale


@with_locale
def history_list(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.history import list_runs
    return {"runs": list_runs(params.get("run_type"), params.get("limit", 50), params.get("offset", 0))}

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
def history_save(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.history import save_run
    run_id = save_run(
        files=params.get("files", []), options=params.get("options", {}),
        patron=params.get("patron", ""), formato=params.get("formato", ""),
        calidad=params.get("calidad", 0), resize=params.get("resize"),
        ok_count=params.get("ok_count", 0), err_count=params.get("err_count", 0),
        run_type=params.get("run_type", "conversion"),
    )
    return {"id": run_id}

HANDLERS = {
    "history_list": history_list,
    "history_get": history_get,
    "history_delete": history_delete,
    "history_save": history_save,
}
