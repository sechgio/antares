# Plan 012 — Electron major upgrade spike notes

> **Spike only** (2026-07-13). No `package.json` Electron bump. No ship. Operator approval required before any staged upgrade.
>
> Worktree: `.worktrees/advisor-012-electron-upgrade` · Branch: `advisor/012-electron-upgrade` · Base: `bd0c48f`

## Drift check

```text
git diff --stat 3174e83..HEAD -- package.json package-lock.json electron/ electron-builder.yml
```

Observed (vs plan’s `3174e83`): `electron/backend-spawner.js`, `electron/google-sheets-service.js`, minor `package.json` delta from later merges. **Electron still `^33.0.0`** — proceed.

## Current versions (lockfile / package.json)

| Package | package.json | Resolved (lockfile) |
|---------|--------------|---------------------|
| `electron` | `^33.0.0` | **33.4.11** |
| `electron-builder` | `^25.0.0` | **25.1.8** |
| `electron-updater` | `^6.8.3` | **6.8.3** |

## `npm audit` summary (no secrets)

**Full audit** (`npm audit`): **20** issues — 2 critical, 13 high, 4 moderate, 1 low.

**Electron (direct, high aggregate)**:
- npm range: `electron <=39.8.4`
- `fixAvailable`: `electron@43.1.0` (semver-major; audit’s default “force” target — **not** the spike recommendation)
- HIGH-severity Electron advisories in the report:
  - [GHSA-532v-xpq5-8h95](https://github.com/advisories/GHSA-532v-xpq5-8h95) — offscreen child-window paint UAF (`<39.8.1`)
  - [GHSA-8337-3p73-46f4](https://github.com/advisories/GHSA-8337-3p73-46f4) — WebContents permission-callback UAF (`<38.8.6`)
  - [GHSA-jjp3-mq3x-295m](https://github.com/advisories/GHSA-jjp3-mq3x-295m) — PowerMonitor UAF (`<38.8.6`)
  - [GHSA-9wfr-w7mm-pc7f](https://github.com/advisories/GHSA-9wfr-w7mm-pc7f) — undocumented `commandLineSwitches` webPreference (`<38.8.6`)
- Many additional moderate/low Electron GHSAs also clear at **≥39.8.5** on the 39.x line.

**Prod-only** (`npm audit --omit=dev`): **1 moderate** (`js-yaml`). Electron is a **devDependency**, so Electron CVEs do not appear in `--omit=dev` — still relevant to the shipped desktop binary.

**Builder toolchain**: `electron-builder` / `app-builder-lib` / `tar` / `@electron/rebuild` contribute HIGH/CRITICAL noise; `npm audit fix --force` suggests `electron-builder@26.15.3` (breaking). Separate from runtime Electron, but pair when shipping.

## 1. API inventory (`electron/`)

Grep targets: `BrowserWindow`, `session`, `shell`, `safeStorage`, `protocol`, `utilityProcess`, `remote`, `enableRemoteModule`, `nodeIntegration`, `contextIsolation`, `sandbox`.

| API / preference | Used? | Where / how |
|------------------|-------|-------------|
| `BrowserWindow` | **Yes** | `main.js`, `window-manager.js`, `dialog-handlers.js` (PDF helper window), `ipc-router.js` (passed into dialogs) |
| `session` | **Yes** | `window-manager.js` (`webContents.session.webRequest.onHeadersReceived` CSP); `dialog-handlers.js` (`session.fromPartition` + `webRequest.onBeforeRequest` for PDF) |
| `shell` | **Yes** | `window-manager.js` (`shell.openExternal`); `autoimg-handlers.js` (`shell.openExternal` for OAuth) |
| `safeStorage` | **No** | AutoIMG uses custom AES-GCM in `autoimg-secure-storage.js` via `app.getPath('userData')` |
| `protocol` | **No** | No custom protocol registration |
| `utilityProcess` | **No** | Backend is child process via `backend-spawner.js`, not `utilityProcess` |
| `remote` / `enableRemoteModule` | **No** | Not present |
| `nodeIntegration` | **Explicit false** | Main + PDF windows |
| `contextIsolation` | **Explicit true** | Main + PDF windows |
| `sandbox` | **Explicit true** | Main + PDF windows; preload relies on sandboxed constraints + `additionalArguments` |

**Related APIs in use (not in the grep list, but upgrade-relevant):**

| API | Where |
|-----|-------|
| `app`, `Menu`, `screen` | `main.js`, `window-manager.js` |
| `ipcMain` / `ipcRenderer` / `contextBridge` / `webUtils` | `ipc-router.js`, `auto-updater.js`, `preload.js` (`webUtils.getPathForFile` — Electron 32+ `File.path` replacement already adopted) |
| `dialog` | `ipc-router.js` → `dialog-handlers.js` |
| `webContents.printToPDF` | `dialog-handlers.js` |
| `webContents.setBackgroundThrottling(false)` | `window-manager.js` |
| `electron-updater` | `auto-updater.js` |

**Security posture to preserve on any upgrade (STOP if violated):** keep `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Do not re-enable remote.

## 2. Chosen target major + reason

**Target: Electron 39.x — pin / caret at least `39.8.5`, prefer latest 39 patch (registry: `39.8.10` as of spike).**

**Reason:** Per plan (“oldest major that clears HIGH advisories”), npm audit marks `electron <=39.8.4` vulnerable. **39.8.5** is the first release on the oldest remaining major that clears that aggregate range (and the 39.8.1+ HIGH offscreen UAF). Jumping to 43 (audit’s force target) is unnecessary for advisory clearance and maximizes breaking surface.

**App-relevance of HIGH advisories on 33.4.11:**

| Advisory | Likely Antares impact |
|----------|------------------------|
| Permission-callback UAF | Possible (WebContents present) |
| PowerMonitor UAF | Low — no `powerMonitor` usage found |
| Offscreen paint UAF | None — no offscreen / shared texture |
| `commandLineSwitches` webPreference | None — uses `additionalArguments`, not that preference |

Clearing the **package** HIGH finding still requires ≥39.8.5 even when some CVEs are N/A.

**Not chosen:** Electron 34–38 (leave HIGH/aggregate findings); Electron 40–43 (clear advisories but larger Chromium/API jump without spike benefit).

## 3. Risk list — breaking / behavior changes 33 → 39

From [Electron breaking changes](https://www.electronjs.org/docs/latest/breaking-changes). Focused on APIs Antares uses or Windows packaging.

| Major | Change | Antares risk |
|-------|--------|--------------|
| **34** | Menu bar hidden in fullscreen on Windows | Low — custom frameless UI / `autoHideMenuBar` already |
| **35** | `WebRequestFilter.urls`: empty `[]` no longer means “all URLs”; use `<all_urls>` | **Low** — filters use explicit `urls: ['*://*/*']` / `file://*/*`, not `[]`. Re-test CSP + PDF `webRequest` interceptors |
| **35** | Dialog `defaultPath` portal behavior (Linux) | N/A — Windows-only packaging |
| **35** | `session.setPreloads` deprecated | N/A — preload via `webPreferences.preload` |
| **36** | `app.commandLine` lowercases switches; not passed to child processes | Low unless future flags added; backend spawn does not rely on Electron CLI forwarding |
| **36** | GTK 4 default on GNOME | N/A for Windows ship |
| **37** | `ProtocolResponse.session = null` removed | N/A — no custom `protocol` handlers |
| **37** | `utilityProcess` rejection/`exit` behavior | N/A — unused |
| **38** | Wayland / ozone env defaults | N/A for Windows; Linux users of unpackaged builds only |
| **38** | macOS 11 unsupported | N/A — no macOS target in `electron-builder.yml` |
| **39** | `window.open` popups always resizable | Low — no elevated `setWindowOpenHandler` child windows found |
| **39** | Shared-texture OSR paint shape | N/A — no OSR |
| **Chromium/Node** | Embedded Chromium + Node bump across 33→39 | **Medium** — native modules, `printToPDF`, CSP `webRequest`, `electron-updater` handshake, asar layout |

**Freeze checklist risks (when shipping later):**
1. Auto-updater + unsigned Windows (`verifyUpdateCodeSignature: false`) must keep working — STOP if updater breaks with no shim.
2. Sandboxed preload + `--allowed-ipc-methods=` / `--app-is-packaged=` injection must keep working.
3. Backend spawn/handshake and IPC allowlist must remain unchanged in product behavior.
4. PDF path (`session.fromPartition` + `printToPDF`) is the highest API-surface risk in-repo.

## 4. electron-builder compatibility note

- Today: **electron-builder 25.1.8** with Electron **33.4.11**, Windows NSIS + portable only (`electron-builder.yml`).
- electron-builder majors are **not** 1:1 with Electron majors; 25.x can often package newer Electron, but:
  - electron-builder **26.5+** includes explicit Electron **>38** packaging fixes (Wayland/snap — Linux-centric).
  - Full `npm audit` already wants **electron-builder ≥26.15.x** for transitive `tar` / rebuild HIGH/CRITICAL.
- **Spike recommendation when shipping Electron 39:** bump `electron-builder` to **^26** (validate `npm run dist:dir` on Windows) and keep `electron-updater@^6.8.x` (already aligned with builder 26). Do **not** bump builder alone in this spike.
- ASAR fuses (`embeddedAsarIntegrityValidation` / `onlyLoadAppFromAsar`) are **not** enabled in this repo — ASAR integrity GHSA is lower practical impact until fuses are turned on.

## Upgrade TODO (not done — no ship approval)

1. Operator approves ship of Electron **39.8.x** (+ builder 26).
2. Branch bump → lockfile → freeze checklist from `plans/012-electron-major-upgrade.md` (`npm test`, typecheck, manual smoke, `dist:dir`).
3. Fix only upgrade breakages; refuse if isolation/sandbox must be weakened.

## Verification performed this spike

| Check | Result |
|-------|--------|
| Drift: Electron still `^33` | Pass |
| Grep API inventory | Pass — notes above |
| `npm audit` + `--omit=dev` | Recorded |
| `package.json` / lockfile Electron version | 33.4.11 — **unchanged** |
| Electron major bump | **Not performed** (spike-only) |
