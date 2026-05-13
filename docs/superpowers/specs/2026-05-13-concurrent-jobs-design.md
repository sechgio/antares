# Concurrent Jobs System Design

## Problem

The backend currently uses a single `ProcessState` singleton (`handlers/common.py`) that allows only one conversion job at a time. If a job is running, `process_start` returns `{"started": false}`. The IPC loop is sequential — long-running handlers block all other requests.

## Solution: JobManager with ThreadPool (Approach A)

### Architecture

```
Frontend (Electron)
    │  IPC JSON-RPC
    ▼
main.py (stdin/stdout loop)
    │
    ▼
HANDLERS dict (route by method name)
    │
    ▼
JobManager (dict of Job objects)
    ├── Job(id="conv_1", thread, state)
    ├── Job(id="conv_2", thread, state)
    └── Job(id="default", thread, state)  ← backward compat
```

### Components

#### 1. `backend/core/jobs.py` — Job and JobManager

```python
@dataclass
class Job:
    id: str
    job_type: str           # "conversion", "formato", etc.
    state: ProcessState     # Reuse existing ProcessState class
    thread: threading.Thread | None
    created_at: str         # ISO timestamp
    params: dict            # Original params for reference

class JobManager:
    _jobs: dict[str, Job]
    _lock: threading.RLock
    max_concurrent: int     # Default: 4

    def create_job(params, job_type) -> str          # Returns job_id
    def get_job(job_id) -> Job | None
    def list_jobs() -> list[Job]                    # All jobs
    def cancel_job(job_id) -> bool
    def cleanup_completed(max_age=100) -> int        # Remove old jobs
```

#### 2. Modified `handlers/common.py`

- `ProcessState` remains as-is (already a dataclass with its own lock)
- Remove the module-level `process_state` singleton
- Add `get_job_manager()` function returning a process-wide singleton `JobManager`

#### 3. Modified `handlers/conversion.py`

- `process_start`: Creates a Job via JobManager instead of using the singleton
- `process_status`: Accepts optional `job_id` param, falls back to "default" job
- `process_cancel`: Accepts optional `job_id` param
- `_process_thread`: Uses job.state instead of global `process_state`

#### 4. New `handlers/jobs.py`

IPC handlers for job management:
- `jobs_list` → Returns all jobs with summary state
- `jobs_get` → Returns detailed state for one job
- `jobs_cancel` → Cancels a specific job
- `jobs_cleanup` → Removes completed/failed jobs

#### 5. Modified `handlers/__init__.py`

Register new `jobs_*` handlers.

### Backward Compatibility Strategy

1. If `job_id` is not provided in params, a default job ID `"default"` is used
2. The old `process_start`, `process_status`, `process_cancel` handlers still work identically without `job_id`
3. When a "default" job exists, `process_status` returns its state (backward compat)
4. New `jobs_*` handlers enable multi-job management

### IPC Notifications

Each job gets its own notification channel:
- `job.{job_id}.progress` — Per-job progress updates
- `job.{job_id}.complete` — Per-job completion
- `process.progress` — Still emitted for backward compat (default job)
- `process.complete` — Still emitted for backward compat (default job)

### Concurrency Limits

- `max_concurrent` jobs running at once (default: 4, configurable)
- Each job uses its own `ThreadPoolExecutor(max_workers=min(cpu_count, 4))`
- If `max_concurrent` is reached, `create_job` returns `{"started": false, "reason": "max_concurrent_reached"}`

### Thread Safety

- `JobManager._lock` protects the jobs dict
- Each `ProcessState` has its own `_lock` (already exists)
- `_db_lock` still serializes DB writes (SQLite requirement)
- IPC read loop remains single-threaded — only dispatches to handlers

### Error Handling

- If a job thread crashes, the job state is set to `running=False`, `err_count` incremented
- `cleanup_completed` removes jobs older than `max_age` entries
- `JobManager` tracks created vs. completed for monitoring

## Files to Create/Modify

| File | Action |
|------|--------|
| `backend/core/jobs.py` | **CREATE** — Job, JobManager classes |
| `backend/handlers/common.py` | **MODIFY** — Remove singleton, add get_job_manager() |
| `backend/handlers/conversion.py` | **MODIFY** — Use JobManager instead of singleton |
| `backend/handlers/jobs.py` | **CREATE** — jobs_list, jobs_get, jobs_cancel, jobs_cleanup |
| `backend/handlers/__init__.py` | **MODIFY** — Add JOBS_HANDLERS |
| `backend/main.py` | **No changes needed** — IPC loop stays the same |

## Testing Strategy

- Existing tests continue working (backward compat)
- New tests for JobManager (create, list, cancel, cleanup, max_concurrent)
- New tests for multi-job scenarios (2+ concurrent conversions)
- Thread safety tests (concurrent access to JobManager)
