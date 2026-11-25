### Changed

- Las notas de release se escriben por PR en `changelog.d/<rama>.md` en lugar de editar `CHANGELOG.md` directamente, eliminando los conflictos de merge entre PRs abiertos; `bump-version.js` consolida los fragmentos en la entrada de versión y `review-policy` exige fragmento o etiqueta `no-changelog`.
- Las instrucciones de agentes distinguen reglas innegociables (datos de usuario, contratos, seguridad) de defaults negociables, exigen verificar las acciones reversas y los silencios de los comandos de comprobación, y prohíben matar procesos por patrón.
- Las guardas de calidad nuevas requieren fixtures positivos y negativos verificados por tests, empezando por `check_any_guard.py`; el hook pre-commit valida la paridad del catálogo IPC y el formato de los fragmentos cuando se stagean.
