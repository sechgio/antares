# IPC JSON-RPC por stdio con 3 lanes

Decidimos JSON-RPC 2.0 line-delimited por stdin/stdout entre Python y Electron, con `electron/ipc-router.js` como router agnóstico y `backend/main.py:HEAVY_METHODS/CANVAS_METHODS/SYNC_METHODS`. WorkScheduler (`backend/core/scheduler.py`) aísla light (min 16 queue), canvas (1 worker, queue 2) y heavy (heavy_workers+heavy_queue). `warm_core`/`warm_post_ready` evita deadlock de imports C-ext bajo Windows (AGENTS.md Transport).

Consecuencia: `sync` responde inline (liveness), `canvas_save` corre en lane light con presupuesto reducido en low-RAM (<1 GiB → `max(4, light_workers)`).
