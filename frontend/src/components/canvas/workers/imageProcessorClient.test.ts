import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  disposeImageProcessorWorker,
  processImageFileForCanvas,
} from './imageProcessorClient';

class CompletingWorker {
  static instances: CompletingWorker[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  constructor() {
    CompletingWorker.instances.push(this);
  }

  postMessage(tasks: Array<{ id: string; file: File }>) {
    queueMicrotask(() => this.onmessage?.({
      data: tasks.map((task) => ({
        id: task.id,
        name: task.file.name,
        type: task.file.type,
        blob: task.file,
        width: 1,
        height: 1,
      })),
    } as MessageEvent));
  }

  terminate() {
    this.terminated = true;
  }
}

class HangingWorker extends CompletingWorker {
  postCount = 0;

  override postMessage() {
    this.postCount += 1;
  }
}

class DeferredWorker extends CompletingWorker {
  tasks: Array<{ id: string; file: File }> = [];

  override postMessage(tasks: Array<{ id: string; file: File }>) {
    this.tasks = tasks;
  }
}

describe('canvas image worker lifecycle', () => {
  afterEach(() => {
    disposeImageProcessorWorker();
    CompletingWorker.instances = [];
    vi.unstubAllGlobals();
  });

  it('disposes the worker and creates a fresh one for later work', async () => {
    vi.stubGlobal('Worker', CompletingWorker);
    vi.stubGlobal('createImageBitmap', vi.fn());
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });

    await processImageFileForCanvas(file);
    const first = CompletingWorker.instances[0];
    expect(first).toBeTruthy();

    disposeImageProcessorWorker();
    expect(first.terminated).toBe(true);

    await processImageFileForCanvas(file);
    expect(CompletingWorker.instances).toHaveLength(2);
  });

  it('cancels queued work instead of posting it after disposal', async () => {
    vi.stubGlobal('Worker', HangingWorker);
    vi.stubGlobal('createImageBitmap', vi.fn());
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });

    const first = processImageFileForCanvas(file);
    const second = processImageFileForCanvas(file);
    await Promise.resolve();
    const worker = CompletingWorker.instances[0] as HangingWorker;
    expect(worker.postCount).toBe(1);

    disposeImageProcessorWorker();
    await first;
    await Promise.resolve();
    await Promise.resolve();

    expect(worker.postCount).toBe(1);
    disposeImageProcessorWorker();
    await second;
  });

  it('ignores a late message from a disposed worker after a fresh worker starts', async () => {
    vi.stubGlobal('Worker', DeferredWorker);
    vi.stubGlobal('createImageBitmap', vi.fn());
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
    const first = processImageFileForCanvas(file);
    await vi.waitFor(() => expect(DeferredWorker.instances).toHaveLength(1));
    const firstWorker = DeferredWorker.instances[0] as DeferredWorker;

    disposeImageProcessorWorker();
    const second = processImageFileForCanvas(file);
    await vi.waitFor(() => expect(DeferredWorker.instances).toHaveLength(2));
    const secondWorker = DeferredWorker.instances[1] as DeferredWorker;
    const stale = new Blob(['stale']);
    const fresh = new Blob(['fresh']);

    firstWorker.onmessage?.({
      data: [{ id: firstWorker.tasks[0]?.id, blob: stale, width: 10, height: 10 }],
    } as MessageEvent);
    secondWorker.onmessage?.({
      data: [{ id: secondWorker.tasks[0]?.id, blob: fresh, width: 20, height: 20 }],
    } as MessageEvent);

    const result = await second;
    await first;
    expect(result.blob).toBe(fresh);
    expect(result.width).toBe(20);
  });
});
