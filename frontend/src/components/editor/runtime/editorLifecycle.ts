/**
 * Ciclo de vida ligero del editor (L2, plan §4.3).
 *
 * Registra callbacks de flush para que el shell pueda pedir guardar
 * antes de abandonar la sesión, sin importar el compositor pesado.
 * El flush es best-effort: un timeout no es un guardado exitoso.
 */

export type EditorFlushHandler = () => Promise<void> | void;

const flushHandlers = new Set<EditorFlushHandler>();

export function registerEditorFlushHandler(handler: EditorFlushHandler): () => void {
  flushHandlers.add(handler);
  return () => {
    flushHandlers.delete(handler);
  };
}

/** Ejecuta todos los flush registrados. Nunca lanza: cada handler
 *  captura sus propios errores y el llamante decide qué reportar. */
export async function flushEditorSessions(): Promise<{ flushed: number; errors: string[] }> {
  const errors: string[] = [];
  let flushed = 0;
  for (const handler of [...flushHandlers]) {
    try {
      await handler();
      flushed += 1;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { flushed, errors };
}

/** true si hay al menos una sesión con flush pendiente. */
export function hasEditorFlushHandlers(): boolean {
  return flushHandlers.size > 0;
}
