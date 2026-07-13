# Plan 012: Spike + staged Electron major upgrade (behavior freeze gate)

> **Executor instructions**: This is primarily a **spike / migration plan**. Do not merge a multi-major Electron jump without the freeze checklist below. Update `plans/README.md` when done (DONE = spike report landed, or upgrade shipped with checklist green).
>
> **Drift check (run first)**: `git diff --stat 3174e83..HEAD -- package.json package-lock.json electron/ electron-builder.yml`
>
> **Behavior freeze (HARD)**: After any upgrade, Antares must keep: IPC allowlist, backend spawn/handshake, AutoIMG OAuth loopback, dialogs, auto-updater, CSP window, conversion smoke. If an Electron API used by this repo is removed, adapt with a shim that preserves app behavior — do not “simplify” product features while upgrading.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans 004–005 green recommended (security/test baseline)
- **Category**: migration
- **Planned at**: commit `3174e83`, 2026-07-13

## Why this matters

App pins `electron@^33` while current line is much newer; `npm audit` reports high advisories fixed in later majors. Staying forever on 33 increases security debt, but a blind jump to 43 will break the desktop app if done carelessly.

## Current state

- `package.json`: `"electron": "^33.0.0"`, `"electron-builder": "^25.0.0"`, `"electron-updater": "^6.8.3"`
- Main process modules under `electron/` (spawner, ipc-router, window-manager, auto-updater, autoimg-*)
- Windows-only builder (`electron-builder.yml` `win:` target)

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Audit | `npm audit --omit=dev` / full `npm audit` | record advisories |
| Tests | `npm test` | exit 0 on upgraded branch |
| Dir build | `npm run dist:dir` | succeeds on Windows |

## Scope

**In scope**:
- Spike document committed under `plans/012-electron-upgrade-notes.md` **or** a short section appended to this file’s Maintenance notes after spike
- Staged `package.json` bumps (prefer 33→34→… or jump to an LTS Electron the team chooses) with lockfile
- Fixes strictly required for compile/runtime on new Electron
- `electron-builder` bump only as required by the chosen Electron

**Out of scope**:
- Feature work, UI redesign, AutoIMG refactors
- macOS/Linux packaging (not in repo today)
- Forcing `xlsx` migration (plan 013)

## Git workflow

- Branch: `advisor/012-electron-upgrade`
- Commits: `chore(deps): bump electron to <ver>` per stage
- No push/PR unless asked.

## Steps

### Step 1: Inventory Electron API usage (read-only)

Grep `electron/` for: `BrowserWindow`, `session`, `shell`, `safeStorage`, `protocol`, `utilityProcess`, `remote`, `enableRemoteModule`, `nodeIntegration`, `contextIsolation`, `sandbox`.

Record APIs that changelog marks breaking between 33 and target.

**Verify**: written inventory in the spike notes (no code change yet).

### Step 2: Choose target and stage

Prefer upgrading to the oldest Electron major that clears the **high** advisories affecting this app, not necessarily latest. Note `electron-builder` compatibility.

**Verify**: spike notes name target version + reason.

### Step 3: Upgrade on a branch and run freeze checklist

Freeze checklist (all must pass):

1. `npm test` exit 0
2. `npm run typecheck:frontend` exit 0
3. Manual smoke (document results): `npm run dev` → login gate loads → conversion tab selects files → backend READY → AutoIMG auth status call does not crash → settings open
4. `npm run dist:dir` produces win unpackaged app

If checklist fails, fix only upgrade breakages; if product logic “needs” redesign, STOP.

## Test plan

- Full `npm test` is the automated gate.
- Manual smoke as above — required for DONE on the upgrade ship, not for spike-only DONE.

## Done criteria

**Spike-only DONE**:
- [ ] Inventory + target version written
- [ ] Risk list of breaking APIs
- [ ] `plans/README.md` notes spike complete / upgrade TODO

**Upgrade DONE** (only if operator approved ship):
- [ ] Electron bumped; freeze checklist green
- [ ] No unrelated feature diffs
- [ ] `plans/README.md` → DONE

## STOP conditions

- Upgrade requires disabling `contextIsolation` or enabling `nodeIntegration` — refuse.
- Auto-updater breaks with no shim — STOP for human decision.
- Builder cannot sign/pack on available CI — report.

## Maintenance notes

- Pair with plan 013 only after Electron stabilizes.
- Reviewer: reject PRs that mix Electron bump with feature work.
- **Spike (2026-07-13):** inventory + target + risks in `plans/012-electron-upgrade-notes.md`. Target **Electron 39.8.5+** (prefer 39.8.10); no bump shipped. Upgrade still TODO pending operator approval + freeze checklist.
