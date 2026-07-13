# Plan 010: Redact map API keys from ubicaciones HTTP logs

> **Executor instructions**: Follow step by step. Update `plans/README.md` when done.
>
> **Drift check**:
> `git diff --stat 1395878..HEAD -- backend/handlers/ubicaciones.py tests/test_ubicaciones_static_map.py`
>
> **Functional safety (HARD RULE)**: Map tiles, Google Static Maps, OSM, compose
> and export must behave the same. Only change **what is written to logs**
> (and optionally a pure redaction helper). Never log raw API keys. Do not
> change URL construction used for actual HTTP requests except via a logging
> helper that redacts when printing.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `1395878`, 2026-07-13

## Why this matters

Map provider keys from IPC/`ANTARES_*` env are interpolated into request URLs.
On failure, `logger.debug("HTTP GET failed for %s", url, ...)` and tile decode
errors log the **full URL including `key=` / `access_token=`**. Support dumps
and stderr capture can leak secrets. Redacting logs does not change fetch
behavior.

## Functional invariants

| Invariant | How to verify |
|-----------|----------------|
| HTTP still uses full URL with key | `_http_get` still receives real URL |
| Cache fingerprint still hashes key (no raw key in cache key) | Existing cache key logic unchanged |
| Failed map fetch still falls back to gray placeholder | Existing tests |
| No secret values in test assertions (use fake keys only) | Tests use `test-key` / `x` |

## Current state

```python
# backend/handlers/ubicaciones.py ~374-434
def _http_get(url: str, headers: dict[str, str], timeout: int = _HTTP_TIMEOUT) -> bytes | None:
    ...
    except (...) as exc:
        logger.debug("HTTP GET failed for %s: %s", url, exc)
...
url = url_template.format(..., key=urllib.parse.quote(api_key or ""))
...
logger.debug("Tile decode failed for %s", url, exc_info=True)
```

Google Static Maps also builds `...&key=...` (~448-458). Decode failure there
already avoids logging the URL (good) — keep that.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Ubicaciones map tests | `python -m pytest tests/test_ubicaciones_static_map.py tests/test_ubicaciones_compose.py -v --tb=short` | all pass |
| Lint | `python -m ruff check backend/handlers/ubicaciones.py` | exit 0 |

## Scope

**In scope**:
- `backend/handlers/ubicaciones.py` — logging helpers + call sites that log URLs
- `tests/test_ubicaciones_static_map.py` — assert redaction if practical

**Out of scope**:
- Moving keys out of URL for providers that require query keys
- Electron secure storage (already done elsewhere)
- Changing map providers / zoom / compose layout

## Git workflow

- Branch: `advisor/010-redact-map-api-keys-logs`
- Commit: `fix(security): redact map API keys from ubicaciones logs`

## Steps

### Step 1: Add `_redact_url_for_log(url: str) -> str`

Pure function near HTTP helpers:

- Parse with `urllib.parse.urlparse` / `parse_qs` or regex.
- Replace query values for keys named like `key`, `access_token`, `api_key`,
  `token` (case-insensitive) with `***`.
- Return a string safe for logs. On parse failure, return host+path only or
  `"<url redacted>"` — never the original if it contains `key=`.

Unit-test via small pure tests in the existing test file:

```python
assert "secret" not in _redact_url_for_log("https://x/?key=secret&z=1")
assert "key=***" in _redact_url_for_log(...) or "redacted" in ...
```

### Step 2: Use helper in all log sites that print map URLs

At minimum:

- `_http_get` failure log
- Tile decode failure log
- Any other `logger.*(..., url, ...)` in this module for map fetches

**Keep** the real `url` argument to `_http_get` / downloads unchanged.

### Step 3: Run map tests

**Verify**: pytest commands green; manual grep:

```
rg "logger\.(debug|info|warning|error).*url" backend/handlers/ubicaciones.py
```

Every log of a URL uses redaction.

## Test plan

| Case | Expected |
|------|----------|
| URL with `key=abc` | log form has no `abc` |
| URL without secrets | still readable host/path |
| Existing static map mocks | still pass |

## Done criteria

- [ ] No log path prints raw map API key
- [ ] HTTP requests still include the real key
- [ ] Tests pass; no functional map test regressions
- [ ] README DONE

## STOP conditions

- Redaction breaks URL construction for real requests (you mixed log helper into fetch)
- Provider requires logging full URL for debugging you cannot replace with host+status

## Maintenance notes

- Never add `logger.debug("%s", url)` for authenticated map URLs again.
- Reviewer: search for `key=` in log format strings under `ubicaciones.py`.
