import { describe, expect, it } from 'vitest';
import { buildTelemetryPayload } from './rum';

describe('RUM telemetry payload', () => {
  it('does not send the current URL or other page-identifying data', () => {
    const payload = buildTelemetryPayload({
      name: 'LCP',
      value: 123.5,
      rating: 'good',
      delta: 12.5,
      id: 'metric-1',
      navigationType: 'navigate',
    });

    expect(payload).toMatchObject({
      name: 'LCP',
      value: 123.5,
      rating: 'good',
      delta: 12.5,
      id: 'metric-1',
      navigationType: 'navigate',
    });
    expect(payload).not.toHaveProperty('url');
    expect(payload.timestamp).toEqual(expect.any(Number));
  });
});
