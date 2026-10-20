from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from backend.core.editor.jobs import (
    cancel_editor_job,
    list_export_history,
    start_effect_job,
    start_export_job,
    start_import_job,
)
from backend.core.editor.jobs import (
    editor_job_status as core_job_status,
)
from backend.core.editor.store import EditorContractError, get_editor_store
from backend.core.jobs import get_job_manager
from backend.core.observability import log_event

logger = logging.getLogger(__name__)


def _require(params: dict[str, Any], key: str) -> Any:  # allowlist: dict[str, Any]
    value = params.get(key)
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ValueError(f"{key} es requerido")
    return value


def editor_bootstrap(params: dict[str, Any]) -> dict[str, Any]:  # allowlist: dict[str, Any]
    store = get_editor_store()
    from backend.core.editor.toolchain import ToolchainError, capabilities, resolve_toolchain

    try:
        caps = capabilities(resolve_toolchain())
        toolchain_ok = caps["ok"]
    except ToolchainError:
        caps = None
        toolchain_ok = False
    projects = store.list_projects()[:20]
    log_event(logger, 20, "editor.bootstrap", projects=len(projects), toolchain_ok=toolchain_ok)
    return {
        "schemaVersion": 1,
        "projects": projects,
        "toolchain": {
            "available": toolchain_ok,
            "missingFilters": caps["missingFilters"] if caps else None,
            "missingEncoders": caps["missingEncoders"] if caps else None,
        },
    }


def editor_project_create(params: dict[str, Any]) -> dict[str, Any]:  # allowlist: dict[str, Any]
    name = params.get("name")
    request_id = params.get("requestId")
    return get_editor_store().create(
        str(name) if name else "Proyecto sin título",
        request_id=str(request_id) if request_id else None,
    )


def editor_project_get(params: dict[str, Any]) -> dict[str, Any]:  # allowlist: dict[str, Any]
    project_id = str(_require(params, "projectId"))
    doc = get_editor_store().get(project_id)
    if doc is None:
        raise EditorContractError("el proyecto no existe")
    return {"project": doc}


def editor_project_save(params: dict[str, Any]) -> dict[str, Any]:  # allowlist: dict[str, Any]
    document = _require(params, "document")
    expected_revision = _require(params, "expectedRevision")
    request_id = params.get("requestId")
    return get_editor_store().save(
        document,
        expected_revision=int(expected_revision),
        request_id=str(request_id) if request_id else None,
    )


def editor_project_duplicate(params: dict[str, Any]) -> dict[str, Any]:  # allowlist: dict[str, Any]
    project_id = str(_require(params, "projectId"))
    name = params.get("name")
    request_id = params.get("requestId")
    return get_editor_store().duplicate(
        project_id,
        str(name) if name else None,
        request_id=str(request_id) if request_id else None,
    )


def editor_project_delete(params: dict[str, Any]) -> dict[str, Any]:  # allowlist: dict[str, Any]
    project_id = str(_require(params, "projectId"))
    return get_editor_store().delete(project_id)


def editor_assets_import_start(params: dict[str, Any]) -> dict[str, Any]:  # allowlist: dict[str, Any]
    files = params.get("files")
    if not isinstance(files, list) or not files:
        raise ValueError("files debe ser una lista no vacía de file_token")
    tokens = [str(t) for t in files]
    request_id = params.get("requestId")
    return start_import_job(
        get_job_manager(),
        tokens,
        request_id=str(request_id) if request_id else None,
    )


def editor_job_status(params: dict[str, Any]) -> dict[str, Any]:  # allowlist: dict[str, Any]
    job_id = str(_require(params, "jobId"))
    return editor_job_status_impl(job_id)


def editor_job_status_impl(job_id: str) -> dict[str, Any]:  # allowlist: dict[str, Any]
    try:
        return core_job_status(job_id, get_job_manager())
    except KeyError as exc:
        raise ValueError(f"job desconocido: {job_id}") from exc


def editor_job_cancel(params: dict[str, Any]) -> dict[str, Any]:  # allowlist: dict[str, Any]
    job_id = str(_require(params, "jobId"))
    try:
        return cancel_editor_job(job_id, get_job_manager())
    except KeyError as exc:
        raise ValueError(f"job ajeno al editor: {job_id}") from exc


def editor_export_start(params: dict[str, Any]) -> dict[str, Any]:  # allowlist: dict[str, Any]
    document = _require(params, "document")
    output_path = params.get("outputPath")
    request_id = params.get("requestId")
    return start_export_job(
        get_job_manager(),
        document,
        output=Path(output_path) if output_path else None,
        request_id=str(request_id) if request_id else None,
    )


def editor_effect_start(params: dict[str, Any]) -> dict[str, Any]:  # allowlist: dict[str, Any]
    document = _require(params, "document")
    effect_type = str(_require(params, "effectType"))
    clip_id = params.get("clipId")
    request_id = params.get("requestId")
    return start_effect_job(
        get_job_manager(),
        document,
        effect_type,
        clip_id=str(clip_id) if clip_id else None,
        request_id=str(request_id) if request_id else None,
    )


def editor_exports_history(params: dict[str, Any]) -> dict[str, Any]:  # allowlist: dict[str, Any]
    limit = int(params.get("limit", 50))
    return {"exports": list_export_history(limit)}


HANDLERS = {
    "editor_bootstrap": editor_bootstrap,
    "editor_project_create": editor_project_create,
    "editor_project_get": editor_project_get,
    "editor_project_save": editor_project_save,
    "editor_project_duplicate": editor_project_duplicate,
    "editor_project_delete": editor_project_delete,
    "editor_assets_import_start": editor_assets_import_start,
    "editor_effect_start": editor_effect_start,
    "editor_export_start": editor_export_start,
    "editor_exports_history": editor_exports_history,
    "editor_job_cancel": editor_job_cancel,
    "editor_job_status": editor_job_status,
}
