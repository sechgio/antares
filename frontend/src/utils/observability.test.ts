import { describe, expect, it, vi } from 'vitest';
import { reportFrontendError, reportFrontendEvent } from './observability';

describe('frontend observability', () => {
  it('sends a bounded, normalized report through preload', () => {
    const reportRendererError = vi.fn();
    window.electronAPI = { ...window.electronAPI!, reportRendererError };

    reportFrontendError({
      kind: 'react_error',
      view: 'canvas/editor',
      name: 'TypeError',
      message: 'boom\nnext line',
      stack: 'x'.repeat(5000),
      componentStack: ' at Canvas',
    });

    expect(reportRendererError).toHaveBeenCalledTimes(1);
    expect(reportRendererError.mock.calls[0][0]).toMatchObject({
      kind: 'react_error',
      view: 'canvas_editor',
      message: 'boom next line',
    });
    expect(reportRendererError.mock.calls[0][0].stack).toHaveLength(3000);
  });

  it('fails open when preload does not expose the reporting channel', () => {
    window.electronAPI = { ...window.electronAPI!, reportRendererError: undefined };
    expect(() => reportFrontendError({ kind: 'global_error', message: 'boom' })).not.toThrow();
  });

  it('reports toast_error and api_error with normalized fields', () => {
    const reportRendererError = vi.fn();
    window.electronAPI = { ...window.electronAPI!, reportRendererError };

    reportFrontendError({
      kind: 'toast_error',
      view: 'toast',
      name: 'ToastError',
      message: 'Operación fallida',
    });

    expect(reportRendererError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'toast_error',
        view: 'toast',
        name: 'ToastError',
        message: 'Operación fallida',
      }),
    );

    reportFrontendError({
      kind: 'api_error',
      view: 'api:canvas_save',
      name: 'AntaresAPIError[TIMEOUT]',
      message: 'IPC timeout: canvas_save',
    });

    expect(reportRendererError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'api_error',
        view: 'api:canvas_save',
        name: 'AntaresAPIError[TIMEOUT]',
        message: 'IPC timeout: canvas_save',
      }),
    );
  });

  it('reports bounded canvas realtime metrics without document content', async () => {
    const module = await import('./observability');
    const reportFrontendEvent = (module as typeof module & {
      reportFrontendEvent?: (report: unknown) => void;
    }).reportFrontendEvent;
    expect(reportFrontendEvent).toEqual(expect.any(Function));

    const reportRendererEvent = vi.fn();
    window.electronAPI = { ...window.electronAPI!, reportRendererEvent };
    reportFrontendEvent?.({
      event: 'canvas.realtime',
      status: 'live',
      count: 2,
      durationMs: 12.4,
      reason: 'reconnect',
    });

    expect(reportRendererEvent).toHaveBeenCalledWith('canvas.realtime', {
      view: 'canvas',
      status_class: 'live',
      count: 2,
      duration_ms: 12,
      reason: 'reconnect',
    }, 'INFO');
  });

  it('forwards request_id on error reports and new event names', () => {
    const reportRendererError = vi.fn();
    const reportRendererEvent = vi.fn();
    window.electronAPI = { ...window.electronAPI!, reportRendererError, reportRendererEvent };

    reportFrontendError({
      kind: 'api_error',
      view: 'api:canvas_save',
      name: 'AntaresAPIError[TIMEOUT]',
      message: 'IPC timeout: canvas_save',
      requestId: 'req-123-abc',
    });

    expect(reportRendererError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'api_error',
        request_id: 'req-123-abc',
      }),
    );

    reportFrontendEvent({
      event: 'canvas.push',
      level: 'WARN',
      outcome: 'degraded',
      reason: 'lww_rpc_v2_missing',
    });
    expect(reportRendererEvent).toHaveBeenCalledWith('canvas.push', {
      view: 'canvas',
      outcome: 'degraded',
      reason: 'lww_rpc_v2_missing',
    }, 'WARN');
  });

  it('forwards requestId as request_id on renderer events', () => {
    const reportRendererEvent = vi.fn();
    window.electronAPI = { ...window.electronAPI!, reportRendererEvent };

    reportFrontendEvent({
      event: 'canvas.cloud_sync',
      outcome: 'success',
      requestId: 'req-sync-42',
    });

    expect(reportRendererEvent).toHaveBeenCalledWith('canvas.cloud_sync', {
      view: 'canvas',
      outcome: 'success',
      request_id: 'req-sync-42',
    }, 'INFO');
  });
});

describe('frontend observability — redacción de secretos y PII', () => {
  function captureMessage(report: Parameters<typeof reportFrontendError>[0]): string {
    const reportRendererError = vi.fn();
    window.electronAPI = { ...window.electronAPI!, reportRendererError };
    reportFrontendError(report);
    return String(reportRendererError.mock.calls[0]?.[0]?.message ?? '');
  }

  it('redacta JWTs (incluye claves anon/service de Supabase) en message y stack', () => {
    const jwt = ['eyJhbGciOiJIUzI1NiJ9','eyJpc3MiOiJzdXBhYmFzZSJ9','abcdefghijklmnopqrstuvwxyz'].join('.');
    const message = captureMessage({
      kind: 'api_error',
      message: `falló auth con ${jwt}`,
      stack: `Error\n  en fn (${jwt})`,
    });
    expect(message).not.toContain(jwt);
    expect(message).toContain('[REDACTED]');

    const reportRendererError = vi.fn();
    window.electronAPI = { ...window.electronAPI!, reportRendererError };
    reportFrontendError({ kind: 'api_error', message: 'x', stack: `stack ${jwt}` });
    expect(String(reportRendererError.mock.calls[0][0].stack)).not.toContain(jwt);
  });

  it('redacta tokens Bearer conservando el esquema', () => {
    const message = captureMessage({
      kind: 'sync_error',
      message: 'Authorization: Bearer abcdef123456.token+más= falló',
    });
    expect(message).not.toContain('abcdef123456');
    expect(message).toContain('Bearer [REDACTED]');
  });

  it('redacta api keys y tokens en pares clave=valor', () => {
    const message = captureMessage({
      kind: 'api_error',
      message: 'GET https://x.supabase.co/rest/v1/t?apikey=sb_secret_123456 falló',
    });
    expect(message).not.toContain('sb_secret_123456');
    expect(message).toContain('apikey=[REDACTED]');
  });

  it('redacta emails de usuarios', () => {
    const message = captureMessage({
      kind: 'sync_error',
      message: 'sesión de usuario@empresa.com expirada',
    });
    expect(message).not.toContain('usuario@empresa.com');
    expect(message).toContain('[REDACTED]');
  });

  it('redacta rutas de usuario Windows y POSIX', () => {
    const win = captureMessage({
      kind: 'storage_error',
      message: 'no se pudo leer C:\\Users\\USUARIO\\Desktop\\antares\\data\\x.sqlite',
    });
    expect(win).not.toContain('USUARIO');
    expect(win).not.toContain('x.sqlite');

    const posix = captureMessage({
      kind: 'storage_error',
      message: 'fallo en /Users/alice/proyectos/secreto.png',
    });
    expect(posix).not.toContain('alice');
  });

  it('no altera mensajes benignos', () => {
    const message = captureMessage({
      kind: 'api_error',
      message: 'IPC timeout: canvas_save',
    });
    expect(message).toBe('IPC timeout: canvas_save');
  });

  it('redacta antes de truncar: un JWT al final no queda parcialmente expuesto', () => {
    const jwt = ['eyJhbGciOiJIUzI1NiJ9','eyJpc3MiOiJzdXBhYmFzZSJ9','abcdefghijklmnopqrstuvwxyz'].join('.');
    // Sin redacción previa al truncado, el corte en 2000 dejaría un fragmento del JWT.
    const long = `${'a'.repeat(1980)} ${jwt}`;
    const message = captureMessage({ kind: 'app_error', message: long });
    expect(message).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(message).not.toContain('eyJpc3MiOiJzdXBhYmFzZSJ9');
    expect(message).toContain('[REDACTED]');
    expect(message.length).toBeLessThanOrEqual(2000);
  });
});
