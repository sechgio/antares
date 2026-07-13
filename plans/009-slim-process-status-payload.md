# Plan 009: Slim `process_status` payload without dropping UI fields

> **Executor instructions**: Follow this plan step by step. STOP on ambiguity.
> Update `plans/README.md` when done.
>
> **Drift check**:
> `git diff --stat 1395878..HEAD -- backend/core/jobs.py backend/handlers/conversion.py tests/test_jobs.py frontend/src/types.ts frontend/src/hooks/useProcessRunner.ts`
>
> **Functional safety (HARD RULE)**: Frontend conversion progress UI must keep
> working: `running`, `progress`, `current_file`, `ok_count`, `err_count`,
> `logs` must remain. Do **not** remove those fields. Only stop shipping the
> full original `params` (especially `files: string[]` of thousands of paths)
> on every status poll. `process_status` stays in `SYNC_METHODS`.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW–MED (IPC shape; FE treats `params` as optional)
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `1395878`, 2026-07-13

## Why this matters

`process_status` runs on the IPC **reader thread** (`SYNC_METHODS`) so health
checks stay green. Today it returns `job.to_dict_detail()`, which embeds full
`params` including the entire `files` list. Large batches re-serialize
megabytes of paths on every poll and delay other IPC. The FE
`ProcessStatus` type marks `params` optional and conversion UI does not depend
on re-reading the file list from status.

## Functional invariants

| Invariant | How to verify |
|-----------|----------------|
| Status still reports running/progress/ok/err/logs | Unit tests + FE type still satisfied |
| Cancel + complete still work | No change to cancel/complete notifications |
| `jobs_get` / multi-job detail (if any) may keep full detail | Only change **conversion** `process_status` path unless jobs API also needs slim |
| FE mocks without `params` still valid | `ProcessStatus.params?` optional in `types.ts` |

## Current state

```python
# handlers/conversion.py process_status
job = mgr.get_job(job_id)
if job:
    return job.to_dict_detail()
```

```python
# core/jobs.py to_dict_detail
return {
    **self.to_dict(),
    "logs": [dict(log) for log in self.state.logs],
    "params": self.params,   # includes files: [...]
    "result": self.result,
}
```

```ts
// frontend/src/types.ts ProcessStatus
params?: Record<string, unknown>;  // optional
// useProcessRunner only uses progress/running/logs-style fields from poll
```

```python
# tests/test_jobs.py
def test_to_dict_detail_includes_logs_and_params(...):
    assert d["params"] == {"files": ["a.jpg"]}
```

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Jobs tests | `python -m pytest tests/test_jobs.py -v --tb=short` | all pass |
| Handlers | `python -m pytest tests/test_handlers.py -v --tb=short` | all pass |
| FE typecheck (if FE types touched) | `npm run typecheck:frontend` | exit 0 |

## Scope

**In scope**:
- `backend/handlers/conversion.py` — `process_status` response shape
- Optionally `backend/core/jobs.py` — add `to_dict_status()` helper if cleaner
- `tests/test_jobs.py` and/or conversion handler tests
- **Only if needed**: comment in `frontend/src/types.ts` that `params` may omit `files`

**Out of scope**:
- Changing `jobs_list` / full job history payloads unless identical bug
- Removing `logs` (capped at 100 already)
- Frontend rewrite of process runner
- Removing `params` from `Job` storage itself

## Git workflow

- Branch: `advisor/009-slim-process-status`
- Commit: `perf(conversion): omit bulk file list from process_status`

## Steps

### Step 1: Confirm FE does not read status.params

Search `frontend/src` for `status.params` / `.params` on process status.
If something **requires** full `files` from status, STOP and report (plan
invalid without FE work).

Expected: no hard dependency (params optional; mocks omit it).

### Step 2: Define slim status shape (additive-safe)

`process_status` should return at least:

```python
{
  **job.to_dict(),           # id, running, progress, total, counts, cancel_requested, ...
  "logs": [...],             # keep
  "result": job.result,      # keep
  # Optional slim params summary — NOT full files list:
  "params": {
    "file_count": len(job.params.get("files") or []),
    "destino": job.params.get("destino"),
    "formato": job.params.get("formato"),
    # include other non-list scalars already used for display if any — none required by FE today
  },
}
```

**Do not** include `files`, `mapping`, or large objects.

Prefer implementing in `process_status` only so `to_dict_detail()` remains for
any caller that still wants full detail (e.g. jobs debug).

### Step 3: Update tests

- Change `test_to_dict_detail_includes_logs_and_params` only if you change
  `to_dict_detail` (prefer **not** changing it).
- Add `test_process_status_omits_files_list` that calls
  `conversion.process_status` with a job whose params have many files and
  asserts `"files" not in (result.get("params") or {})` and progress fields
  present.

### Step 4: Run verification suite

**Verify**: commands table green.

## Test plan

| Case | Expected |
|------|----------|
| Status with 1000 files in job.params | response has no files list; has progress fields |
| Idle / missing job | existing empty-state dict unchanged |
| to_dict_detail (if left alone) | still has full params for other use |

## Done criteria

- [ ] `process_status` never returns full `files` array
- [ ] `running` / `progress` / `logs` / counts still present
- [ ] FE typecheck green if types touched; else no FE changes
- [ ] Tests updated; README DONE

## STOP conditions

- FE or Electron code path requires `status.params.files`
- Slim shape breaks a Node integration test you cannot fix within scope
- Temptation to move `process_status` off SYNC — do not

## Maintenance notes

- If UI later needs re-display of start options mid-job, pass a dedicated
  `jobs_get` detail call, not poll payload.
- Reviewer: grep FE for `params.files` on status.
