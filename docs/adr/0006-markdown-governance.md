# Restricción markdown y .gitignore para docs versionados

Endurecimos que solo `AGENTS.md`, `CHANGELOG.md`, `CLAUDE.md`, `README.md` se versionan (AGENTS.md HARD RULE). Con ADRs necesitamos versionar `docs/adr/*.md` y `CONTEXT.md` sin abrir la puerta a `scratch/*.md` o `local://*.md`. Ajustamos `.gitignore` para whitelisting `!docs/adr/**` y `!CONTEXT.md`, y corregimos `AGENTS.md`/`CLAUDE.md` ignorados por `.gitignore:83-84` (bug que impedía versionar la propia guía del repo).
