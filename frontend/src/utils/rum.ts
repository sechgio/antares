/**
 * RUM: web-vitals sampled 10% → api.telemetry() → backend stderr.
 * Dynamic import so unsampled sessions pay 0KB; onLCP/onINP/onCLS only.
 */
import { api } from '../api';

let inited = false;

function shouldSample(): boolean {
  const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
  if (w?.__RUM_FORCE_SAMPLE === true) return true;
  if (w?.__RUM_FORCE_SAMPLE === false) return false;
  return Math.random() < 0.1;
}
function sendMetric(metric: {
  name: string;
  value: number;
  rating: string;
  delta: number;
  id: string;
  navigationType?: string;
}) {
  const payload = {
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    delta: metric.delta,
    id: metric.id,
    navigationType: metric.navigationType ?? '',
    url: typeof location !== 'undefined' ? location.href.slice(0, 500) : '',
    timestamp: Date.now(),
  };
  // Fire-and-forget — RUM never blocks UI. Errors are swallowed.
  // eslint-disable-next-line no-console
  void api.telemetry(payload).catch(() => {
    // Fallback: at least surface in devtools / Electron stderr when IPC missing.
    // `console.error` is NOT stripped by terser pure_funcs (only log/info/debug).
    // eslint-disable-next-line no-console
    console.error(`[rum] ${payload.name}=${payload.value} rating=${payload.rating} id=${payload.id}`);
  });
}

export function initRUM(): void {
  if (inited) return;
  inited = true;

  // Don't run in Vitest/JSDOM or SSR.
  if (typeof window === 'undefined') return;
  try {
    // @ts-ignore — import.meta.env is Vite-injected
    if (import.meta.env?.MODE === 'test') return;
  } catch {}

  if (!shouldSample()) return;

  // Dynamic import keeps the 2KB off the shell for unsampled sessions.
  void import('web-vitals')
    .then(({ onCLS, onINP, onLCP }) => {
      try {
        onCLS(sendMetric);
      } catch {}
      try {
        onINP(sendMetric);
      } catch {}
      try {
        onLCP(sendMetric);
      } catch {}
    })
    .catch(() => {
      // web-vitals load failure is non-fatal
    });
}

/** Test helper — resets init guard so each test can re-sample. */
export function __resetForTests() {
  inited = false;
}
