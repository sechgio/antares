# Plan 014: Characterization tests for plugin AST gate and formatos PDF strategies

> **Executor instructions**: Follow step by step. Update `plans/README.md` when done.
>
> **Drift check**:
> `git diff --stat 1395878..HEAD -- backend/core/plugins.py backend/core/formatos.py backend/core/format_strategies tests/test_plugins.py tests/test_formatos_handlers.py`
>
> **Functional safety (HARD RULE)**: This plan is **tests-first / tests-only**
> unless a tiny bugfix is required for a test to assert current intended
> behavior. Prefer **zero production code changes**. If a production bug is
> discovered, STOP and report — do not expand scope into a large formats
> refactor. Do not change PDF stamp placement or plugin allowlists in this
> plan.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (tests only)
- **Depends on**: none (but enables safer later security/debt plans)
- **Category**: tests
- **Planned at**: commit `1395878`, 2026-07-13

## Why this matters

1. **Plugins**: `_is_safe_plugin` is the only automated gate before
   `exec_module` in-process. Existing tests never assert blocked APIs are
   rejected — a regression can load dangerous plugins silently.
2. **Formatos**: handler tests mock `generate_pdf`, so real strategy code
   (`legacy_xobject`, `visual_overlay`, simple overlay) can break without
   CI noticing. Characterization tests lock current behavior without changing
   it.

## Functional invariants

| Invariant | How to verify |
|-----------|----------------|
| Production code paths unchanged (preferred) | `git diff` only tests (+fixtures) |
| Safe plugin still loads | Existing happy-path plugin test |
| Blocked plugins do not register formats | New tests |
| PDF generate with fixture produces stable page count / non-empty PDF | New tests; use tiny fixture |

## Current state

```python
# backend/core/plugins.py — _is_safe_plugin AST walk; load_plugins_from_dir
# tests/test_plugins.py — load success, underscore skip, missing register, broken raise
```

```python
# tests/test_formatos_handlers.py — monkeypatches generate_pdf to b"%PDF-large"
# Real: backend/core/formatos.py generate_pdf → format_strategies/*
```

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Plugin tests | `python -m pytest tests/test_plugins.py -v --tb=short` | all pass |
| Formatos tests | `python -m pytest tests/test_formatos_handlers.py tests/test_formatos_*.py -v --tb=short` | all pass |
| Full python (optional) | `python -m pytest tests -m "not slow" -q` | green |

## Scope

**In scope**:
- `tests/test_plugins.py` (extend)
- `tests/test_formatos_strategies.py` (new) and/or extend `test_formatos_handlers.py`
- Minimal PDF fixtures under `tests/fixtures/` if needed (tiny blank PDF bytes)
- **Production code**: only if a pure-test approach is impossible — then
  STOP first

**Out of scope**:
- Tightening the plugin blocklist/allowlist (security plan later)
- Redesigning format strategies
- WeasyPrint tools
- Electron allowlist

## Git workflow

- Branch: `advisor/014-characterization-plugins-formatos`
- Commit: `test: characterize plugin AST gate and formatos PDF strategies`

## Steps

### Step 1: Plugin AST negative tests

Extend `tests/test_plugins.py` with table-driven cases. For each blocked
source written as `bad_plugin.py` with a `register` function:

| Source pattern | Expected |
|----------------|----------|
| `import os` / `from os import path` | not loaded; format not registered |
| `eval("1")` or `exec(...)` | blocked |
| attribute `__class__` / other blocked dunder | blocked |
| `class X(metaclass=Something):` | blocked (ClassDef keywords) |

Also keep one **allowed** plugin (current HEICTST style) still loading.

Assert registry does not contain the blocked format name after
`load_plugins_from_dir`.

If `_is_safe_plugin` is not exported, test via `load_plugins_from_dir` only
(black-box) — preferred.

**Verify**: tests pass on current code (characterization). If a case you
thought was blocked is **allowed** by current AST walk, document actual
behavior in the test name (`test_currently_allows_...`) or assert current
behavior honestly — do not silently change production to make tests “nice”.

### Step 2: Formatos strategy characterization

1. Create a minimal valid PDF fixture (blank single page) in
   `tests/fixtures/minimal.pdf` **or** generate with pypdf in the test setup
   (prefer generate in test to avoid binary churn if that's repo style).
2. Call real `generate_pdf` / strategy with a tiny correlative range
   (`desde=1`, `hasta=1` or `2`) and a strategy already used by catalog.
3. Assert:
   - return bytes start with `%PDF`
   - page count matches range (via pypdf `PdfReader`)
   - no exception

If legacy XObject requires a special template not in repo, **xfail** or skip
that strategy with a clear reason; still cover visual_overlay or simple path
that works with blank PDF.

4. Add **one** handler-level test **without** mocking `generate_pdf` that
   writes to `tmp_path` and checks file size > 0 — only if path wiring is
   straightforward; otherwise unit-level `generate_pdf` is enough.

**Verify**: new tests pass without production changes.

### Step 3: Ensure suite green

Run full formatos + plugins pytest commands.

## Test plan

| Area | Cases |
|------|--------|
| Plugins | allow, import os, eval, dunder, metaclass |
| Formatos | real generate min page count, handler optional |

## Done criteria

- [ ] Plugin negative tests exist and pass
- [ ] At least one real (non-mocked) formatos PDF generation test
- [ ] Prefer zero production diff; if any, only trivial bugfix with explanation
- [ ] README DONE

## STOP conditions

- Generating PDF requires network, WeasyPrint, or huge templates
- You feel forced to refactor strategies to make tests pass
- Plugin sandbox behavior is so weak that honest tests would document RCE —
  still write characterization tests; do **not** expand into full sandbox
  rewrite here (file a follow-up)

## Maintenance notes

- Any change to `_BLOCKED_*` or strategies must update these tests.
- Reviewer: ensure tests don't ship huge binary fixtures.
