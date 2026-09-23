// Señal de salud de la cola de push cloud. Vive fuera de canvasCloudSync
// (módulo lazy que arrastra supabase) para que los hooks de UI puedan
// suscribirse sin cargar el sync completo ni depender de dynamic import.
export type CanvasPushHealthListener = (unhealthy: boolean) => void;

const pushHealthListeners = new Set<CanvasPushHealthListener>();
let lastUnhealthy = false;

export function subscribeCanvasPushHealth(listener: CanvasPushHealthListener): () => void {
  pushHealthListeners.add(listener);
  try {
    listener(lastUnhealthy);
  } catch {
    // Un listener roto no debe romper la suscripción de los demás.
  }
  return () => {
    pushHealthListeners.delete(listener);
  };
}

export function notifyPushHealth(unhealthy: boolean): void {
  // Solo transiciones: un push sano no debe pisar 'syncing'/'synced' en el badge.
  if (unhealthy === lastUnhealthy) return;
  lastUnhealthy = unhealthy;
  for (const listener of pushHealthListeners) {
    try {
      listener(unhealthy);
    } catch {
      // Los listeners alimentan estado de UI: un fallo ahí no debe romper el
      // bucle de sync.
    }
  }
}
