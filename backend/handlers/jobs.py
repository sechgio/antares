"""Job management handlers for listing, inspecting, and canceling concurrent jobs."""
from __future__ import annotations

from typing import Any

from backend.core.jobs import get_job_manager, resolve_job_id
from backend.handlers.common import with_locale


@with_locale
def jobs_list(params: dict[str, Any]) -> dict[str, Any]:
    """List all jobs with summary state.

    Optional params:
        job_type: Filter by job type (e.g. "conversion")
    """
    mgr = get_job_manager()
    job_type = params.get("job_type")
    jobs = mgr.list_jobs(job_type=job_type)
    summaries = [job.to_dict() for job in jobs]
    running = sum(1 for j in jobs if j.state.running)
    return {
        "jobs": summaries,
        "total": len(summaries),
        "running": running,
        "max_concurrent": mgr.max_concurrent,
    }


@with_locale
def jobs_get(params: dict[str, Any]) -> dict[str, Any]:
    """Get detailed state for a specific job.

    Required params:
        job_id: The job identifier
    """
    job_id = resolve_job_id(params)
    mgr = get_job_manager()
    job = mgr.get_job(job_id)
    if job is None:
        msg = f"Job not found: {job_id}"
        raise ValueError(msg)
    return {"job": job.to_dict_detail()}


@with_locale
def jobs_cancel(params: dict[str, Any]) -> dict[str, Any]:
    """Request cancellation of a specific job.

    Required params:
        job_id: The job identifier
    """
    job_id = resolve_job_id(params)
    mgr = get_job_manager()
    return mgr.cancel_job(job_id)


@with_locale
def jobs_cleanup(params: dict[str, Any]) -> dict[str, Any]:
    """Remove completed/failed jobs from memory.

    Optional params:
        max_remaining: Keep at most this many completed jobs (default 20)
    """
    mgr = get_job_manager()
    max_remaining = params.get("max_remaining", 20)
    removed = mgr.cleanup_completed(max_remaining=max_remaining)
    return {"removed": removed}


HANDLERS = {
    "jobs_list": jobs_list,
    "jobs_get": jobs_get,
    "jobs_cancel": jobs_cancel,
    "jobs_cleanup": jobs_cleanup,
}
