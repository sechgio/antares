import { describe, expect, it, vi } from 'vitest';

const queueCanvasCloudPush = vi.fn().mockResolvedValue(undefined);
const queueCanvasCloudDelete = vi.fn().mockResolvedValue(undefined);

vi.mock('../canvasCloudSync', () => ({
  queueCanvasCloudPush: (...args: unknown[]) => queueCanvasCloudPush(...args),
  queueCanvasCloudDelete: (...args: unknown[]) => queueCanvasCloudDelete(...args),
}));

import { queueCanvasCloudDelete as queueDelete, queueCanvasCloudPush as queuePush } from '../cloudQueue';

describe('cloudQueue (lazy import wrappers)', () => {
  it('queueCanvasCloudPush delega con doc y opciones', async () => {
    const doc = { id: 'd1' } as never;
    await queuePush(doc, { forceResurrect: true });
    expect(queueCanvasCloudPush).toHaveBeenCalledWith(doc, { forceResurrect: true });
  });

  it('queueCanvasCloudDelete delega el id', async () => {
    await queueDelete('doc-9');
    expect(queueCanvasCloudDelete).toHaveBeenCalledWith('doc-9');
  });
});
