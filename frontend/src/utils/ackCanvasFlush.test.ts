import { describe, expect, it, vi } from 'vitest';
import { registerEditorFlushHandler } from '../components/editor/runtime/editorLifecycle';
import { acknowledgeCanvasFlush, hasCanvasFlushOwner, registerCanvasFlushOwner } from './ackCanvasFlush';

describe('canvas flush ownership', () => {
  it('tracks owners and ignores a repeated release', () => {
    expect(hasCanvasFlushOwner()).toBe(false);
    const first = registerCanvasFlushOwner();
    const second = registerCanvasFlushOwner();
    first();
    first();
    expect(hasCanvasFlushOwner()).toBe(true);
    second();
    expect(hasCanvasFlushOwner()).toBe(false);
  });
});

describe('cierre con sesiones del editor', () => {
  it('espera el guardado del editor antes de autorizar el cierre', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const unregister = registerEditorFlushHandler(() => pending);
    const ack = vi.fn(async () => ({}));
    const previous = window.electronAPI?.canvasFlushAck;
    if (!window.electronAPI) throw new Error('Falta el bridge de pruebas');
    window.electronAPI.canvasFlushAck = ack;
    const closing = acknowledgeCanvasFlush();
    try {
      await Promise.resolve();
      expect(ack).not.toHaveBeenCalled();
    } finally {
      finish();
      await closing;
      unregister();
      window.electronAPI.canvasFlushAck = previous;
    }
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it('comunica un fallo de guardado sin autorizar un cierre exitoso', async () => {
    const unregister = registerEditorFlushHandler(async () => { throw new Error('Sin espacio'); });
    const ack = vi.fn(async () => ({}));
    const previous = window.electronAPI?.canvasFlushAck;
    if (!window.electronAPI) throw new Error('Falta el bridge de pruebas');
    window.electronAPI.canvasFlushAck = ack;
    try {
      await expect(acknowledgeCanvasFlush()).rejects.toThrow('Sin espacio');
      expect(ack).toHaveBeenCalledExactlyOnceWith(false);
    } finally {
      unregister();
      window.electronAPI.canvasFlushAck = previous;
    }
  });
});
