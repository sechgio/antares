# Scalability baseline (Task 1)

This baseline is an offline load model. It creates deterministic synthetic
records and measures JSON encode/decode work in the current Python process. It
does not read private files, use credentials, call Google or Supabase, or
require Electron.

## Load model

The scale multiplier applies to each domain's 1× nominal count:

| Domain | Unit | 1× | 5× | 10× |
| --- | --- | ---: | ---: | ---: |
| JSON documents | synthetic JSON documents | 20 | 100 | 200 |
| SQLite records | synthetic SQLite-shaped records | 100 | 500 | 1000 |
| Espacios tasks | synthetic Espacios tasks | 25 | 125 | 250 |
| Users | synthetic user records | 10 | 50 | 100 |
| Spreadsheet rows | synthetic spreadsheet rows | 100 | 500 | 1000 |
| Images | synthetic image payload descriptors | 20 | 100 | 200 |
| Canvas documents | synthetic Canvas documents | 10 | 50 | 100 |
| Concurrent jobs | synthetic queued jobs | 8 | 40 | 80 |

The generator uses an explicit seed (default `1`) and stable synthetic IDs.
Fixtures contain no tokens, emails, real paths, or private documents.

## Metrics and metadata

Each scenario records nearest-rank latency `p50`, `p95`, and `p99` in
milliseconds; peak observed RSS in bytes; IPC bytes; request count; lock wait
in milliseconds; queue wait in milliseconds; and errors. The result also
contains schema version, scale, seed, Python version, platform, machine, and
runtime. Hardware values are recorded dynamically when the command runs; this
document makes no hardware performance claim.

## Run

From the repository root:

```text
python scripts/scalability_baseline.py --scale 1x
python scripts/scalability_baseline.py --scale 5x --seed 17
python scripts/scalability_baseline.py --scale 10x --output <ignored-artifact-path>/baseline-10x.json
```

Without `--output`, the JSON is written to a temporary directory outside the
repository. Keep checked-in source free of generated results.

## Scenario coverage and limitations

The default command covers deterministic offline fixture generation and the
measurement schema for all eight domains above. The following verification
scenarios are named for future integration runs: conversion, list, export,
spreadsheet, Canvas sync, Espacios, and AutoIMG. Their real service/Electron
measurements are intentionally **not implemented in Task 1** and no live
measurements are claimed here. They require explicit integration environments
and credentials; they must remain separate from the safe offline default.
