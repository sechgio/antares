# Task 1 report: load model and scalability baseline

## Implemented

- Added `scripts/scalability_baseline.py`, an offline CLI and importable model.
- Added deterministic synthetic fixtures for JSON documents, SQLite-shaped
  records, Espacios tasks, users, spreadsheet rows, image descriptors, Canvas
  documents, and concurrent jobs.
- Defined explicit nominal counts and scale multipliers for `1x`, `5x`, and
  `10x`; the selected seed makes fixture output reproducible.
- Added `MetricCollector` and JSON serialization for nearest-rank p50/p95/p99,
  peak RSS, IPC bytes, request count, lock wait, queue wait, and errors.
- Added dynamic Python/platform/machine/runtime metadata collection.
- Added the documented offline run procedure and limitations in
  `docs/scalability-baseline.md`.
- No production application code or IPC behavior was changed. Generated
  results default to a temporary directory outside the repository.

## Files changed

- `scripts/scalability_baseline.py`
- `tests/test_scalability_baseline.py`
- `docs/scalability-baseline.md`
- `.superpowers/sdd/task-1-report.md`

## TDD evidence

RED: before implementation, the focused command failed during collection:

```text
python -m pytest tests/test_scalability_baseline.py -q
ModuleNotFoundError: No module named 'scripts.scalability_baseline'
```

GREEN: after implementation:

```text
python -m pytest tests/test_scalability_baseline.py -q
3 passed in 0.22s
```

## Verification commands and exact results

```text
ruff check scripts/scalability_baseline.py tests/test_scalability_baseline.py
All checks passed!

python -m pytest tests/test_scalability_baseline.py tests/test_benchmark_ipc_latency.py -q
8 passed in 1.85s

python scripts/scalability_baseline.py --scale 1x
C:\Users\HIDROAA\AppData\Local\Temp\antares-scalability-9s9wd3kg\baseline-1x.json
```

Full suite:

```text
npm test
Python: 936 passed, 1 skipped, 2 deselected in 31.60s
Frontend Vitest: 196 files passed, 1340 tests passed
Frontend static Vitest: 7 files passed, 22 tests passed
Exit status: 0
```

`git diff --check` and the staged diff check passed.

## Limitations and concerns

- This is a synthetic offline baseline, not a claim about actual hardware
  capacity or production latency.
- The requested live conversion, list, export, spreadsheet, Canvas sync,
  Espacios, and AutoIMG measurements remain explicitly unimplemented. They are
  documented as future integration scenarios because they require real
  services, credentials, or an Electron window.
- The current offline exercise measures JSON encode/decode of representative
  synthetic records; it does not invoke production handlers or create real
  SQLite/image/Canvas artifacts.

## Commits

- `90986d6828ee46c383da98fca0e68697cb1d7e4a` — `feat: add offline scalability baseline`

## Review-fix work

- Added seven default, named **offline synthetic** runners: conversion, list,
  export, spreadsheet, Canvas sync, Espacios, and AutoIMG.
- Replaced the generic fixture with deterministic, representative JSON
  documents, SQLite-shaped history records, Espacios task/user joins,
  spreadsheet cells/formulas, image payload metadata, Canvas pages/layers,
  and queued AutoIMG jobs at the same fixed 1x/5x/10x counts.
- Each scenario serializes a representative transformed payload. RSS is sampled
  before and after every synthetic operation; AutoIMG measures real local
  `threading.Lock` and `queue.Queue` wait time. The clock and RSS sampler are
  injectable for stable tests, and serialized results are rejected at 64 MiB.
- Added CPU model/core count and total/available memory metadata with safe
  fallbacks, then updated the baseline documentation.

## Review-fix files

- `scripts/scalability_baseline.py`
- `tests/test_scalability_baseline.py`
- `docs/scalability-baseline.md`
- `.superpowers/sdd/task-1-report.md`

## Review-fix TDD and verification evidence

RED, after adding the focused public-seam tests first:

```text
python -m pytest tests/test_scalability_baseline.py -q
2 failed, 3 passed in 0.41s
KeyError: 'scenario'
TypeError: run_offline_baseline() got an unexpected keyword argument 'rss_sampler'
```

GREEN and regression coverage:

```text
python -m pytest tests/test_scalability_baseline.py tests/test_benchmark_ipc_latency.py -q
10 passed in 0.86s

ruff check scripts/scalability_baseline.py tests/test_scalability_baseline.py
All checks passed!

python scripts/scalability_baseline.py --scale 10x
C:\Users\HIDROAA\AppData\Local\Temp\antares-scalability-7xnzhl9q\baseline-10x.json
```

The new tests execute `run_offline_baseline` at 1x and 10x, assert all seven
scenario names, all eight fixture domains and representative transformations,
the under-64-MiB serialized payload, injected sampled RSS maximum, nonnegative
metrics, and observed positive AutoIMG lock/queue waits. Final full-suite
evidence: `npm test` exited 0; Python reported `938 passed, 1 skipped,
2 deselected in 55.47s`; frontend Vitest reported `196 passed / 1340 passed`;
static Vitest reported `7 passed / 22 passed`.

## Review-fix limitations and concerns

- The seven scenarios are intentionally offline synthetic coverage, not live
  integrations. They do not start Electron or invoke production IPC handlers,
  SQLite, image codecs, Supabase, or external Espacios services.
- The local lock/queue waits prove bounded contention measurement only; their
  elapsed values are environment-dependent and not a production throughput
  claim.

## Final review remediation (HEAD 73b630e)

### Implementation

- The per-item measurement loop now catches synthetic transform and JSON
  serialization failures, records the elapsed attempt and request, samples
  RSS, and continues with later items. No exception type, message, or
  traceback is emitted in an artifact.
- MetricCollector exposes partial and caps errors at
  MAX_RECORDED_ERRORS = 100. A failed-only scenario therefore still returns a
  valid measurement.
- Every measurement has a capacity object. AutoIMG sets
  capacity.queue_maxsize and capacity.queue_peak_depth from its actual bounded
  local queue.Queue(maxsize=1). Events coordinate a full queue and blocked
  enqueue; both threads retain one-second joins.
- The fixture regression now rejects emails, common API/GitHub-token prefixes,
  bearer values, JWT-shaped values, Unix/Windows/UNC/file absolute-path
  markers, and traversal markers.

### TDD evidence

RED, after adding the new behavior tests:

    python -m pytest tests/test_scalability_baseline.py -q
    collected 0 items / 1 error
    ImportError: cannot import name 'MAX_RECORDED_ERRORS' from 'scripts.scalability_baseline'
    ============================== 1 error in 0.42s ===============================

GREEN, after the minimal implementation:

    python -m pytest tests/test_scalability_baseline.py -q
    collected 6 items
    ============================== 6 passed in 0.45s ==============================

The deterministic focused test injects both a transform failure and a JSON
serialization failure, checks continuation, the capped error count, partial,
and absence of the injected exception text from the artifact.

### Verification commands and exact results

    python -m pytest tests/test_scalability_baseline.py tests/test_benchmark_ipc_latency.py -q
    collected 11 items
    tests\test_scalability_baseline.py ......                                [ 54%]
    tests\test_benchmark_ipc_latency.py .....                                [100%]
    ============================= 11 passed in 1.53s ==============================

    ruff check scripts/scalability_baseline.py tests/test_scalability_baseline.py
    All checks passed!

    git diff --check
    Exit status: 0

    npm test
    Exit status: 0
    Python: 939 passed, 1 skipped, 2 deselected in 27.11s

The npm test command was run once. Its process exited 0; the terminal capture
was truncated after the Python summary, so no frontend pass-count is claimed
here beyond that successful exit status.

### Changed files

- scripts/scalability_baseline.py
- tests/test_scalability_baseline.py
- .superpowers/sdd/task-1-report.md

### Limitations and concerns

- These remain seven offline synthetic scenarios; no live integrations or
  production IPC behavior were changed or claimed.
- Error detail is intentionally omitted from artifacts to avoid leaking
  sensitive values. errors is a capped count (100), so it signals partial
  failure rather than an unbounded diagnostic total.
- The AutoIMG capacity metrics describe only the local synthetic queue probe;
  elapsed lock and queue waits remain environment-dependent.
