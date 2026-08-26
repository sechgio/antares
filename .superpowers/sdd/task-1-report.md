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
