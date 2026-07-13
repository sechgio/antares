# Plan 015: Cap inbound IPC message size like outbound

> **Executor instructions**: Follow step by step. Update `plans/README.md` when done.
>
> **Drift check**:
> `git diff --stat 1395878..HEAD -- backend/ipc_protocol.py tests/test_ipc.py tests/test_ipc_validation.py`
>
> **Functional safety (HARD RULE)**: All **normal** IPC messages under the
> existing 64 MiB default must behave identically. Only oversized lines are
> rejected. Do not lower the default without product approval. Prefer reusing
> `_MAX_PAYLOAD_SIZE` / `ANTARES_IPC_MAX_PAYLOAD_SIZE`. Large exports that
> already use disk paths remain the right pattern — do not break small base64
> previews that currently succeed.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `1395878`, 2026-07-13

## Why this matters

Outbound responses are capped (`_MAX_PAYLOAD_SIZE`, default 64 MiB). Inbound
`read_message` uses unbounded `sys.stdin.readline()` then `json.loads`. A
huge line can OOM the backend. Cap inbound to the same budget for symmetry.

## Functional invariants

| Invariant | How to verify |
|-----------|----------------|
| Valid small JSON-RPC lines still parse to `IPCMessage` | Existing `test_ipc*` |
| Oversize line returns `_SKIP` or safe error without crash | New test |
| Env override still controls size | Same env var |
| Unknown method / validation errors unchanged for normal messages | Existing tests |

## Current state

```python
# backend/ipc_protocol.py
_MAX_PAYLOAD_SIZE = int(os.environ.get("ANTARES_IPC_MAX_PAYLOAD_SIZE", str(64 * 1024 * 1024)))
...
def read_message() -> IPCMessage | None:
    line = sys.stdin.readline()  # unbounded
    ...
    data = json.loads(line)
```

Outbound already checks `len(json_str.encode('utf-8')) > _MAX_PAYLOAD_SIZE`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| IPC tests | `python -m pytest tests/test_ipc.py tests/test_ipc_validation.py -v --tb=short` | all pass |
| Lint | `python -m ruff check backend/ipc_protocol.py` | exit 0 |

## Scope

**In scope**:
- `backend/ipc_protocol.py` — `read_message` size gate
- `tests/test_ipc_validation.py` or `tests/test_ipc.py`

**Out of scope**:
- Changing handler payloads to force disk-only (unless a test fails at 64 MiB —
  STOP)
- Electron pipe framing changes
- Lowering default below 64 MiB

## Git workflow

- Branch: `advisor/015-ipc-inbound-payload-cap`
- Commit: `fix(security): cap inbound IPC line size`

## Steps

### Step 1: Test with monkeypatched stdin

Write a test that feeds a line longer than a **small** test limit:

Option A (preferred): temporarily monkeypatch `_MAX_PAYLOAD_SIZE` to e.g. 1024
and feed a 2k line → expect `_SKIP` (or documented behavior) and no exception
escape.

Option B: don't allocate 64 MiB in CI — always use patched limit.

Also assert a normal small message still works under the same patch.

### Step 2: Implement size check before `json.loads`

After reading `line`:

```python
if len(line.encode("utf-8")) > _MAX_PAYLOAD_SIZE:  # or len(line) if UTF-8 safe enough
    logger.error("Inbound IPC payload too large: %d bytes (max: %d)", ...)
    return _SKIP  # match parse-error path: no id to reply
```

Be careful: if `line` is str, `len(line)` is codepoints; prefer encoding for
consistency with outbound.

Document that oversized messages do not get a correlated JSON-RPC error
(same as other parse failures) unless you can extract `id` safely from a
prefix — **do not** try to parse partial multi-GB JSON. `_SKIP` is fine.

### Step 3: Run IPC suite

**Verify**: commands green.

## Test plan

| Case | Expected |
|------|----------|
| line > patched max | `_SKIP`, process continues |
| normal version request | still works |
| empty/EOF | still None |

## Done criteria

- [ ] Inbound size gate uses same max as outbound
- [ ] Tests cover oversize without allocating 64 MiB
- [ ] Existing IPC tests pass
- [ ] README DONE

## STOP conditions

- Legitimate FE messages exceed 64 MiB and start failing — STOP; do not raise
  limit silently; report which method.
- readline cannot be bounded without rewriting the whole framing protocol.

## Maintenance notes

- Prefer path-based transfer for huge blobs (already the pattern for some
  handlers).
- Reviewer: ensure no double-encoding bugs on Windows newlines.
