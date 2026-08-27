export type FrontendErrorKind = 'react_error' | 'global_error' | 'unhandled_rejection';

export interface FrontendErrorReport {
  kind: FrontendErrorKind;
  view?: string;
  name?: string;
  message?: string;
  stack?: string;
  componentStack?: string | null;
}

function safeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, maxLength);
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
    };
    reporter(payload);
  } catch {
    // Diagnostics must never interfere with the renderer or its fallback UI.
  }
}
