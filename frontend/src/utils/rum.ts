import { api } from '../api';

let inited = false;

function shouldSample(): boolean {
  const w = typeof window !== 'undefined' ? window : undefined;
  if (w?.__RUM_FORCE_SAMPLE === true) return true;
  if (w?.__RUM_FORCE_SAMPLE === false) return false;
  return Math.random() < 0.1;
}

type RumMetric = {
  name: string;
  value: number;
  rating: string;
  delta: number;
  id: string;
  navigationType?: string;
};

export function buildTelemetryPayload(metric: RumMetric) {
  return {
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    delta: metric.delta,
    id: metric.id,
    navigationType: metric.navigationType ?? '',
    timestamp: Date.now(),
  };
}

function logRum(context: string, error: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`[rum] ${context}`, error);
}

function sendMetric(metric: RumMetric): void {
  const payload = buildTelemetryPayload(metric);
  void api.telemetry(payload).catch((error: unknown) => {
    logRum(`telemetry unavailable for ${payload.name}`, error);
  });
}

export function initRUM(): void {
  if (inited) return;
  inited = true;
  if (typeof window === 'undefined') return;
  if (import.meta.env.MODE === 'test') return;
  if (!shouldSample()) return;
  void import('web-vitals')
    .then(({ onCLS, onINP, onLCP }) => {
      for (const [name, fn] of [
        ['CLS', onCLS],
        ['INP', onINP],
        ['LCP', onLCP],
      ] as const) {
        try {
          fn(sendMetric);
        } catch (error: unknown) {
          logRum(`${name} registration failed`, error);
        }
      }
    })
    .catch((error: unknown) => {
      logRum('web-vitals load failed', error);
    });
}

export function __resetForTests() {
  inited = false;
}
