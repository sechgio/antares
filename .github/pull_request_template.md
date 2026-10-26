## What / Why

<!-- Qué cambia y por qué, en 2-4 líneas. Enlaza el issue/PR relacionado si existe. -->

## Screenshots

<!-- Obligatorio si toca UI: arrastra aquí capturas o un GIF corto (claro/oscuro si aplica). Si no hay cambios visibles, borra esta sección. -->

| Antes | Después |
| --- | --- |
|  |  |

## Risk

- [ ] IPC (`backend/ipc_protocol.py` / `electron/backend-spawner.js`)
- [ ] Base de datos o migraciones
- [ ] Concurrencia (locks, scheduler, prefetch)
- [ ] Empaquetado / PyInstaller
- [ ] Ninguna de las anteriores

## Verification

- [ ] `npm run ci` pasa en local y probé la ruta negativa
- [ ] Revisé mi diff completo; sin `any` / `# type: ignore` / `eslint-disable` sin justificar
- [ ] `CHANGELOG.md` y docs/ADR actualizados si aplica

> Revisión: `blocking:` · `suggestion:` · `nit:` · `question:` · `praise:`
