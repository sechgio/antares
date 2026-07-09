/** In-process invalidation when Espacios mutates tareas (same window as the bell). */

type Listener = () => void;

const listeners = new Set<Listener>();

export function emitDueNotificationsInvalidate(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error('[due-notifications] invalidate listener failed:', err);
    }
  }
}

export function onDueNotificationsInvalidate(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
