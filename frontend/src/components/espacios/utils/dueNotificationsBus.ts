
import { reportFrontendError } from '../../../utils/observability';
import { errorMessage } from '@/utils/errors';

type Listener = () => void;

const listeners = new Set<Listener>();

export function emitDueNotificationsInvalidate(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error('[due-notifications] invalidate listener failed:', err);
      reportFrontendError({
        kind: 'app_error',
        view: 'espacios',
        name: err instanceof Error ? err.name : 'ListenerError',
        message: errorMessage(err, String(err)),
      });
    }
  }
}

export function onDueNotificationsInvalidate(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
