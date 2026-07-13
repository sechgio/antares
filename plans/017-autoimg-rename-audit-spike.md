# Plan 017: Spike AutoIMG rename audit/dry-run (no destructive reverse import)

> **Executor instructions**: Spike/design first. Do not implement bulk reverse-rename that mutates Drive until a dry-run audit exists and operator approves. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 3174e83..HEAD -- electron/autoimg-sync-engine.js electron/autoimg-ipc-methods.js frontend/src/components/autoimg/`
>
> **Behavior freeze (HARD)**: Existing NIS→SGIO `autoimg_rename_export` must remain unchanged in semantics. New work is additive (audit/dry-run). No silent Drive deletes/renames.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans 002–003 recommended (stale UI guards) before any new AutoIMG UI wiring
- **Category**: direction
- **Planned at**: commit `3174e83`, 2026-07-13

## Why this matters

AutoIMG can export renames NIS→SGIO into a Drive folder, but cannot verify round-trip / reconcile against BD_IMG from the same UI. A full reverse import is dangerous on shared Drive trees; an audit/dry-run is the safe adjacent capability.

## Current state

- UI hint: AutoIMG rename tab “NIS → SGIO”
- IPC: `autoimg_rename_export`, `autoimg_rename_dest_config` in `electron/autoimg-ipc-methods.js`
- Panel: `RenameExportPanel.tsx` — export only
- Tests: `tests/test-autoimg-rename.js` and related AutoIMG node tests

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Rename tests | `node tests/test-autoimg-rename.js` | exit 0 |
| Sync engine tests | `node tests/test-autoimg-sync-engine.js` | exit 0 |

## Scope

**In scope**:
- Spike notes: `plans/017-autoimg-rename-audit-notes.md`
- Optional later implementation (only if operator expands): read-only IPC `autoimg_rename_audit` returning planned diffs — **no writes**

**Out of scope**:
- Reverse rename that modifies Drive files
- Changing BD_IMG sheet schema
- Bootstrap pagination (PERF-03)

## Git workflow

- Branch: `advisor/017-autoimg-rename-audit-spike`
- Commit: `docs(plans): AutoIMG rename audit spike`
- No push/PR unless asked.

## Steps

### Step 1: Document current export algorithm

From `autoimg-sync-engine.js` / rename helpers: inputs, naming rules (7→8 digits), copy vs rename, skip conditions (`only_completos`).

**Verify**: notes describe algorithm with function names.

### Step 2: Propose audit output shape

Example fields (adjust to code): `expected_name`, `found_name`, `status: missing|match|conflict`, `file_id`. Pure JSON; no Drive writes.

**Verify**: shape reviewed against BD_IMG columns actually used.

### Step 3: Implementation gate

List tests to add before enabling UI (mirror `test-autoimg-rename.js`). Explicitly require dry-run default and a separate confirmation for any future write path (out of scope here).

Do not ship Drive-mutating reverse import in this plan.

## Test plan

- Spike: existing rename tests remain green (no code change).
- Future: fixture folder listing + BD_IMG rows → stable audit JSON.

## Done criteria

- [ ] Spike notes with algorithm + audit shape + test gate
- [ ] `autoimg_rename_export` behavior untouched
- [ ] `plans/README.md` → DONE for spike

## STOP conditions

- Request to “just rename back in Drive” without audit — refuse.
- BD_IMG cache incomplete for audit accuracy — note dependency on sync/bootstrap freshness; do not invent sheet writes.

## Maintenance notes

- Pair UI work with plans 002–003 so audit results are not stale-racy.
- Reviewer: any write path needs its own plan and irreversible-action UX.
