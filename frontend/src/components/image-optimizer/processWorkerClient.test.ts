import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROCESS_WORKER_TIMEOUT_MS,
  _resetProcessWorkersForTests,
  runProcessInWorker,
} from './processWorkerClient';
import { DEFAULT_BATCH_SETTINGS } from './presets';

class FailingWorker {
  static instances: FailingWorker[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  constructor() {
    FailingWorker.instances.push(this);
  }

  postMessage(_request: unknown) {
    queueMicrotask(() => this.onerror?.(new Error('worker crashed') as unknown as ErrorEvent));
  }

  terminate() {
    this.terminated = true;
  }
}

class HangingWorker {
  static instances: HangingWorker[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  constructor() {
    HangingWorker.instances.push(this);
  }

  postMessage(_request: unknown) {}

  terminate() {
    this.terminated = true;
  }
}

function workerInput() {
  return {
    buffer: new Uint8Array([1, 2, 3]).buffer,
    sourceType: 'image/jpeg',
    fileName: 'photo.jpg',
    settings: DEFAULT_BATCH_SETTINGS,
    shouldCrop: false,
    shouldResize: true,
    shouldConvertFormat: false,
    shouldCompress: false,
  };
}

describe('process worker lifecycle', () => {
  afterEach(() => {
    _resetProcessWorkersForTests();
    FailingWorker.instances = [];
    HangingWorker.instances = [];
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rejects the in-flight request and replaces a worker that crashes', async () => {
    vi.stubGlobal('Worker', FailingWorker);
    vi.stubGlobal('OffscreenCanvas', class {});
    vi.stubGlobal('createImageBitmap', vi.fn());

    const request = runProcessInWorker(workerInput());
    const settled = Promise.race([
      request,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('request did not settle')), 100);
      }),
    ]);

    await expect(settled).rejects.toThrow('worker crashed');
    expect(FailingWorker.instances).toHaveLength(3);
    expect(FailingWorker.instances[0].terminated).toBe(true);
  });

  it('rejects and replaces a worker that does not respond before the timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', HangingWorker);
    vi.stubGlobal('OffscreenCanvas', class {});
    vi.stubGlobal('createImageBitmap', vi.fn());

    const request = runProcessInWorker(workerInput());
    const settled = Promise.race([
      request,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('request did not time out')), PROCESS_WORKER_TIMEOUT_MS + 1);
      }),
    ]);

    const assertion = expect(settled).rejects.toThrow('Image process worker timed out');
    await vi.advanceTimersByTimeAsync(PROCESS_WORKER_TIMEOUT_MS + 1);
    await assertion;
    expect(HangingWorker.instances[0].terminated).toBe(true);
  });
});
