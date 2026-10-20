type CanvasPushHealthListener = (unhealthy: boolean) => void;

const pushHealthListeners = new Set<CanvasPushHealthListener>();
let lastUnhealthy = false;

export function subscribeCanvasPushHealth(listener: CanvasPushHealthListener): () => void {
  pushHealthListeners.add(listener);
  try {
    listener(lastUnhealthy);
  } catch {
  }
  return () => {
    pushHealthListeners.delete(listener);
  };
}

export function notifyPushHealth(unhealthy: boolean): void {
  if (unhealthy === lastUnhealthy) return;
  lastUnhealthy = unhealthy;
  for (const listener of pushHealthListeners) {
    try {
      listener(unhealthy);
    } catch {
    }
  }
}
