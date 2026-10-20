## What / Why


## Risk

- [ ] Toca el protocolo IPC (`backend/ipc_protocol.py` / `electron/backend-spawner.js`)
- [ ] Toca esquema de base de datos o migraciones
- [ ] Toca concurrencia (locks, scheduler, hilos de prefetch)
- [ ] Toca empaquetado / spec de PyInstaller
- [ ] Ninguna de las anteriores

## Verification

- [ ] `npm run ci` pasa en local
- [ ] Probé la ruta negativa (entrada inválida, job cancelado, archivo ausente)

## Notes for the reviewer


## Checklist

- [ ] Leí mi propio diff completo antes de pedir revisión
- [ ] Sin `any` / `# type: ignore` / `eslint-disable` nuevos sin justificar arriba
- [ ] `CHANGELOG.md` actualizado si hay cambio visible para el usuario
- [ ] Docs/ADR actualizados si cambió una restricción arquitectónica


---

> Comentarios de revisión: `blocking:` · `suggestion:` · `nit:` · `question:` · `praise:`
