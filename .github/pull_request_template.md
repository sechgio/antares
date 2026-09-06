## What / Why

<!-- Qué cambia y por qué. Enlaza el issue si existe. Mínimo ~120 caracteres. -->

## Risk

- [ ] Toca el protocolo IPC (`backend/ipc_protocol.py` / `electron/backend-spawner.js`)
- [ ] Toca esquema de base de datos o migraciones
- [ ] Toca concurrencia (locks, scheduler, hilos de prefetch)
- [ ] Toca empaquetado / spec de PyInstaller
- [ ] Ninguna de las anteriores

## Verification

- [ ] `npm run ci` pasa en local
- [ ] Tests añadidos/actualizados que fallan sin este cambio
- [ ] Probé la ruta negativa (entrada inválida, job cancelado, archivo ausente)

## Notes for the reviewer

<!-- Dónde mirar primero. Alguna decisión de la que no estés seguro. -->

## Checklist

- [ ] Leí mi propio diff completo antes de pedir revisión
- [ ] ≤ 400 líneas cambiadas, o justificación explícita
- [ ] Sin `any` / `# type: ignore` / `eslint-disable` nuevos sin justificar arriba
- [ ] Ningún archivo nuevo supera 500 líneas
- [ ] `CHANGELOG.md` actualizado si hay cambio visible para el usuario
- [ ] Docs/ADR actualizados si cambió una restricción arquitectónica

---

> Comentarios de revisión: `blocking:` · `suggestion:` · `nit:` · `question:` · `praise:`
