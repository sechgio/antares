export const STATUS_LABEL: Record<string, string> = {
  done: 'completado',
  empty: 'sin resultados',
  limit: 'límite de pasos',
  token_budget: 'presupuesto agotado',
  invalid: 'contrato incumplido',
  partial: 'parcial',
  failed: 'falló',
  denied: 'rechazada',
  interrupted: 'interrumpida',
  queued: 'en cola',
  pending: 'pendiente',
  submitted: 'enviada',
  working: 'trabajando',
  delivered: 'entregado',
  cancelled: 'cancelado',
  exited: 'completado',
  timed_out: 'tiempo agotado',
  running: 'en curso',
  error: 'error',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}
