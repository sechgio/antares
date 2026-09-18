import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const telemetry = vi.fn().mockResolvedValue(undefined);

vi.mock('../api', () => ({
  api: { telemetry: (...args: unknown[]) => telemetry(...args) },
}));

const onCLS = vi.fn();
const onINP = vi.fn();
const onLCP = vi.fn();

vi.mock('web-vitals', () => ({ onCLS, onINP, onLCP }));

declare global {
  interface Window {
    __RUM_FORCE_SAMPLE?: boolean;
  }
}

async function importFresh() {
  vi.resetModules();
  return import('./rum');
}

describe('rum', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__RUM_FORCE_SAMPLE;
    vi.unstubAllEnvs();
  });

  it('buildTelemetryPayload añade timestamp y navigationType por defecto', async () => {
    const { buildTelemetryPayload } = await importFresh();
    const payload = buildTelemetryPayload({
      name: 'LCP', value: 1200, rating: 'good', delta: 50, id: 'm1',
    });
    expect(payload).toMatchObject({
      name: 'LCP', value: 1200, rating: 'good', delta: 50, id: 'm1',
      navigationType: '',
    });
    expect(payload.timestamp).toBeGreaterThan(0);
  });

  it('initRUM no hace nada en MODE=test', async () => {
    const { initRUM } = await importFresh();
    window.__RUM_FORCE_SAMPLE = true;
    initRUM();
    await Promise.resolve();
    expect(onCLS).not.toHaveBeenCalled();
  });

  it('initRUM muestrea y registra las tres métricas fuera de test', async () => {
    vi.stubEnv('MODE', 'production');
    const { initRUM } = await importFresh();
    window.__RUM_FORCE_SAMPLE = true;
    initRUM();
    await vi.waitFor(() => expect(onCLS).toHaveBeenCalled());
    expect(onINP).toHaveBeenCalled();
    expect(onLCP).toHaveBeenCalled();
    // una métrica enviada por el callback llega a api.telemetry
    const send = onCLS.mock.calls[0][0] as (m: unknown) => void;
    send({ name: 'CLS', value: 0.1, rating: 'good', delta: 0.1, id: 'x' });
    await vi.waitFor(() => expect(telemetry).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'CLS', value: 0.1 }),
    ));
  });

  it('initRUM sin muestreo no carga web-vitals', async () => {
    vi.stubEnv('MODE', 'production');
    const { initRUM } = await importFresh();
    window.__RUM_FORCE_SAMPLE = false;
    initRUM();
    await Promise.resolve();
    expect(onCLS).not.toHaveBeenCalled();
  });

  it('initRUM solo se inicializa una vez', async () => {
    vi.stubEnv('MODE', 'production');
    const { initRUM } = await importFresh();
    window.__RUM_FORCE_SAMPLE = true;
    initRUM();
    initRUM();
    await vi.waitFor(() => expect(onCLS).toHaveBeenCalled());
    expect(onCLS).toHaveBeenCalledTimes(1);
  });
});
