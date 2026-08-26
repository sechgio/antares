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
milliseconds; peak RSS sampled before and after each synthetic operation; IPC
bytes; request count; lock wait in milliseconds; queue wait in milliseconds;
and errors. AutoIMG uses a local `threading.Lock` and `queue.Queue` to record
actual bounded contention waits. The result also contains schema version,
scale, seed, Python version, platform, machine, runtime, CPU model/core count,
and total/available memory when available (otherwise safe zero/unavailable
fallbacks are used). Hardware values are recorded dynamically when the command
runs; this document makes no hardware performance claim.

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

The default command executes seven named **offline synthetic** scenario
runners: conversion, list, export, spreadsheet, Canvas sync, Espacios, and
AutoIMG. They transform representative JSON document, SQLite-shaped record,
task/user, spreadsheet row, image-metadata, Canvas-layer, and queued-job
fixtures, then JSON encode/decode the result. The fixture generator has fixed
1x/5x/10x counts, uses no real paths or payload blobs, and rejects a serialized
result at or above 64 MiB.

This is explicitly not live-integration coverage. It does not invoke Electron,
production IPC handlers, SQLite, image codecs, Supabase, or external Espacios
services, and it needs no credentials, private files, or external services.
Live integration measurements remain outside Task 1 and require a separately
authorized environment.
