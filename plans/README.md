# Implementation Plans — dead code cleanup (015–023)

Planned and implemented against dead-code audit on 2026-07-14.
Branch: `advisor/015-023-dead-code`.

| Plan | Title | Status |
|------|-------|--------|
| 015 | Remove unused FE deps + no-op prop-types babel plugin | DONE |
| 016 | Prune dead statusConfig exports | DONE |
| 017 | Remove orphan conversion image-preview stack | DONE |
| 018 | Remove orphan AutoIMG ScannerPanel UI (FE-only) | DONE |
| 019 | Remove dead Python helpers + unused exception classes | DONE |
| 020 | Remove UI-unused IPC methods | DONE |
| 021 | Remove orphan formatos catalog/duplicates + unused icons | DONE |
| 022 | Wire restart-budget spawner test into npm test | DONE |
| 023 | Retire unwired generate scripts / document brand generator | DONE |

## Verification

```bash
npm run lint:python
npm run typecheck:frontend
node tests/test-electron-ipc-allowlist.js
cd backend && python -m pytest ../tests -v -m "not slow"
cd frontend && npx vitest run
```
