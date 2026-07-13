# Plan 013: Spike replacing vulnerable `xlsx` without breaking Excel import flows

> **Executor instructions**: Spike first; do not rip out `xlsx` app-wide in one PR. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 3174e83..HEAD -- frontend/package.json frontend/src/`
>
> **Behavior freeze (HARD)**: Padron / Volantes / Ubicaciones / any sheet import must keep accepting the same user Excel templates (same columns, same row mapping). Prefer parsing via existing Python (`openpyxl`/`pandas`) over introducing a second JS parser if that preserves behavior with less risk.

## Status

- **Priority**: P3
- **Effort**: M–L
- **Risk**: MED
- **Depends on**: none (sequencing after 012 optional)
- **Category**: migration
- **Planned at**: commit `3174e83`, 2026-07-13

## Why this matters

`frontend` depends on `xlsx@^0.18.5` with **high** advisories and no upstream fix. Spreadsheets are parsed in the privileged Electron renderer.

## Current state

- Dependency: `frontend/package.json` `"xlsx"`
- Call sites include `frontend/src/components/padron/excel.ts`, `VolantesView.tsx`, `UbicacionesView.tsx`, and additional imports (enumerate during spike with `rg "from 'xlsx'|from \"xlsx\"|require\\('xlsx'\\)" frontend/src`)

Python already parses Excel in backend for conversion DB import — reuse where IPC already exists.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| List call sites | `rg "xlsx" frontend/src --glob "!**/node_modules/**"` | inventory |
| Frontend tests | `cd frontend && npx vitest run` | pass |
| Audit | `cd frontend && npm audit` | record `xlsx` status |

## Scope

**In scope**:
- Spike notes: call-site inventory, recommended strategy (A/B/C), effort
- Optional pilot migration of **one** low-risk call site behind unchanged UI
- Do not remove `xlsx` until all call sites migrated and golden fixtures pass

**Strategies to evaluate**:
- **A**: Route reads through Python handlers (`openpyxl`) via existing IPC — best alignment with desktop architecture
- **B**: Replace with `exceljs` (or maintained alternative) in renderer
- **C**: SheetJS Pro paid build (only if operator approves license) — mention as option, do not purchase in-plan

**Out of scope**:
- Redesigning padron/volantes UX
- Changing Excel template column names users rely on

## Git workflow

- Branch: `advisor/013-xlsx-migration-spike`
- Commit: `chore: spike notes for xlsx replacement` and later `refactor(<area>): parse excel via ...`
- No push/PR unless asked.

## Steps

### Step 1: Inventory + fixture collection

List every import. For each, note: read vs write, runs in renderer, sample file location under `tests/` or `formatos/` if any.

**Verify**: inventory checked into spike notes under `plans/` (append to this file or `plans/013-xlsx-notes.md`).

### Step 2: Pick pilot

Choose the smallest call site with existing tests. Implement replacement preserving output structure byte-for-byte at the JSON/object level the UI consumes.

**Verify**: targeted vitest/pytest green; manual open of one real template.

### Step 3: Roll out or stop

If pilot preserves behavior, schedule follow-up PRs per module. If not, STOP with recommendation (e.g. “keep xlsx but only parse in a sandboxed worker / move to Python”).

Removing the dependency is DONE only when `rg` shows zero `xlsx` usage and `frontend/package.json` dropped it, with audits clean of that advisory.

## Test plan

- Golden fixtures per migrated module (minimal xlsx committed if license-clean; otherwise generate in test tmp).
- Existing padron/ubicaciones tests must stay green.

## Done criteria

**Spike DONE**:
- [ ] Inventory + recommended strategy written
- [ ] Operator can decide A/B/C

**Migration DONE** (later):
- [ ] No `xlsx` dependency
- [ ] All former call sites behavior-preserved with tests
- [ ] `plans/README.md` → DONE

## STOP conditions

- Replacement changes cell typing (dates/numbers) breaking renames — halt roll-out.
- Writing `.xlsx` in renderer has no safe library equivalent — keep write path separate from read path decision.

## Maintenance notes

- Prefer one parsing stack (Python) long-term for security and consistency.
- Reviewer: reject drive-by template format changes.
