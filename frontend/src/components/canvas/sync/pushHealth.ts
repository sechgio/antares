// Permite observar la salud de la cola sin cargar canvasCloudSync ni Supabase.
type CanvasPushHealthListener = (unhealthy: boolean) => void;

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
