type FrontendErrorKind =
  | 'react_error'
  | 'global_error'
  | 'unhandled_rejection'
  | 'toast_error'
  | 'api_error'
  | 'app_error'
  | 'sync_error'
  | 'storage_error'
  | 'worker_error';

interface FrontendErrorReport {
  kind: FrontendErrorKind;
  view?: string;
  name?: string;
  message?: string;
  stack?: string;
  componentStack?: string | null;
  requestId?: string;
}

type FrontendEventLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
type FrontendEventOutcome = 'success' | 'partial' | 'degraded' | 'failed' | 'timeout' | 'cancelled' | 'rejected';

type FrontendEventName =
  | 'canvas.realtime'
  | 'canvas.quit_flush'
  | 'canvas.push'
  | 'canvas.cloud_sync'
  | 'espacios.sync'
  | 'storage.local'
  | 'worker.error';

interface FrontendEventReport {
  event: FrontendEventName;
  level?: FrontendEventLevel;
  view?: string;
  status?: string;
  outcome?: FrontendEventOutcome;
  durationMs?: number;
  count?: number;
  reason?: string;
  requestId?: string;
}

// Mismas categorías que SENSITIVE_TEXT_RE de electron/app-log.js: la redacción
// se aplica en origen para que secretos y PII no crucen el canal IPC.
const SENSITIVE_TEXT_RE: RegExp[] = [
  /(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret|token|cookie)\s*[:=]\s*)(?:"[^",;]*"?|'[^',;]*'?|[^\s,;"']+)/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /(?:[A-Za-z]:\\|\\\\|\/(?:Users|home|tmp|var|private|opt|mnt|workspace)\/)[^\s"'`]+/g,
];

function redactSensitiveText(value: string): string {
  let text = value;
  for (const pattern of SENSITIVE_TEXT_RE) {
    text = text.replace(pattern, (...matches: unknown[]) =>
      typeof matches[1] === 'string' ? `${matches[1]}[REDACTED]` : '[REDACTED]',
    );
  }
  return text;
}

function safeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const redacted = redactSensitiveText(value);
  const text = redacted.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, maxLength);
  return text || undefined;
}

function safeToken(value: unknown): string | undefined {
  const text = safeText(value, 80)?.replace(/[^a-zA-Z0-9_.:-]/g, '_');
  return text || undefined;
}

export function reportFrontendError(report: FrontendErrorReport): void {
  try {
    const reporter = window.electronAPI?.reportRendererError;
    if (typeof reporter !== 'function') return;
    const payload: Record<string, unknown> = {
      kind: report.kind,
      view: safeToken(report.view) ?? 'unknown',
      name: safeText(report.name, 120),
      message: safeText(report.message, 2000),
      stack: safeText(report.stack, 3000),
      componentStack: safeText(report.componentStack, 2000),
      request_id: safeToken(report.requestId),
    };
    reporter(payload);
  } catch {
  }
}

export function reportFrontendEvent(report: FrontendEventReport): void {
  try {
    const reporter = window.electronAPI?.reportRendererEvent;
    if (typeof reporter !== 'function') return;
    const fields: Record<string, unknown> = {
      view: safeToken(report.view) ?? 'canvas',
    };
    const status = safeToken(report.status);
    const reason = safeToken(report.reason);
    const requestId = safeToken(report.requestId);
    if (status) fields.status_class = status;
    if (requestId) fields.request_id = requestId;
    if (report.outcome) fields.outcome = report.outcome;
    if (typeof report.durationMs === 'number' && Number.isFinite(report.durationMs) && report.durationMs >= 0) {
      fields.duration_ms = Math.round(report.durationMs);
    }
    const count = report.count;
    if (typeof count === 'number' && Number.isInteger(count) && count >= 0) fields.count = count;
    if (reason) fields.reason = reason;
    reporter(report.event, fields, report.level ?? 'INFO');
  } catch {
  }
}
