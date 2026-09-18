import { errorMessage } from "@/utils/errors";

/**
 * Mensaje de error IPC con ayuda contextual para el caso clásico de
 * preload desactualizado tras HMR (método no permitido / desconocido).
 */
export function formatIpcError(error: unknown, fallback: string): string {
  const message = errorMessage(error, String(error || fallback));
  if (
    message.includes("IPC method not allowed") ||
    message.includes("Método desconocido")
  ) {
    return `${message} Cierra TODAS las ventanas de Antares y vuelve a abrir la app (Vite HMR no recarga el preload IPC).`;
  }
  return message || fallback;
}
