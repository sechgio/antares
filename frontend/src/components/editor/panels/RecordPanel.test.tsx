import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RecordPanel } from './RecordPanel';
import { api } from '../../../api';

vi.mock('../../../api', () => ({
  api: {
    editorRecordingCreate: vi.fn().mockResolvedValue({ sessionId: 'rec-1', maxInFlightBytes: 8388608 }),
    editorRecordingAppend: vi.fn().mockResolvedValue({ sessionId: 'rec-1', seq: 0, writtenBytes: 1024 }),
    editorRecordingFinish: vi.fn().mockResolvedValue({
      sessionId: 'rec-1',
      path: '/tmp/rec-1.webm',
      writtenBytes: 2048,
      file_token: 'ft_1',
    }),
    editorRecordingAbort: vi.fn().mockResolvedValue({ sessionId: 'rec-1', aborted: true }),
  },
}));

class FakeTrack {
  kind: string;
  stopped = false;
  private listeners: Record<string, Array<() => void>> = {};
  constructor(kind: string) {
    this.kind = kind;
  }
  stop() {
    this.stopped = true;
  }
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ||= []).push(fn);
  }
  emit(type: string) {
    for (const fn of this.listeners[type] || []) fn();
  }
}

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported(mime: string) {
    return mime.startsWith('video/webm');
  }
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  ondataavailable: ((e: { data: { size: number; arrayBuffer(): Promise<ArrayBuffer> } }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: { size: 512, arrayBuffer: () => Promise.resolve(new ArrayBuffer(512)) } });
    this.onstop?.();
  }
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder;
  (globalThis as unknown as { btoa: unknown }).btoa = (s: string) => Buffer.from(s, 'binary').toString('base64');
  const videoTrack = new FakeTrack('video');
  const audioTrack = new FakeTrack('audio');
  const stream = {
    getVideoTracks: () => [videoTrack],
    getAudioTracks: () => [audioTrack],
    addTrack: (t: FakeTrack) => void t,
    getTracks: () => [videoTrack, audioTrack],
  };
  (navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
    getDisplayMedia: vi.fn().mockResolvedValue(stream),
    getUserMedia: vi.fn().mockResolvedValue({
      getAudioTracks: () => [new FakeTrack('audio')],
    }),
  };
});

describe('RecordPanel (L7)', () => {
  it('estado inicial muestra controles listos para grabar', () => {
    render(<RecordPanel />);
    expect(screen.getByText('Listo para grabar')).toBeTruthy();
    expect(screen.getByText('0:00')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Grabar con micrófono/ })).toBeTruthy();
  });

  it('permiso denegado muestra mensaje en español', async () => {
    (navigator as unknown as { mediaDevices: { getDisplayMedia: unknown } }).mediaDevices.getDisplayMedia = vi
      .fn()
      .mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    render(<RecordPanel />);
    await act(async () => {
      screen.getByRole('button', { name: /Solo pantalla/ }).click();
    });
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Permiso de captura denegado/);
    });
  });

  it('dispositivo ausente muestra mensaje propio', async () => {
    (navigator as unknown as { mediaDevices: { getDisplayMedia: unknown } }).mediaDevices.getDisplayMedia = vi
      .fn()
      .mockRejectedValue(new DOMException('no device', 'NotFoundError'));
    render(<RecordPanel />);
    await act(async () => {
      screen.getByRole('button', { name: /Solo pantalla/ }).click();
    });
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/dispositivo/);
    });
  });

  it('grabar, pausar, continuar y detener importa la grabación', async () => {
    render(<RecordPanel />);
    await act(async () => {
      screen.getByRole('button', { name: /Solo pantalla/ }).click();
    });
    await waitFor(() => expect(screen.getByText('Grabando')).toBeTruthy());

    const recorder = FakeMediaRecorder.instances[0];
    await act(async () => {
      screen.getByRole('button', { name: 'Pausar' }).click();
    });
    expect(recorder.state).toBe('paused');

    await act(async () => {
      screen.getByRole('button', { name: 'Continuar' }).click();
    });
    expect(recorder.state).toBe('recording');

    await act(async () => {
      screen.getByRole('button', { name: 'Detener' }).click();
    });
    await waitFor(() => {
      expect(screen.getByText('Grabación lista')).toBeTruthy();
      expect(api.editorRecordingFinish).toHaveBeenCalledWith(expect.stringMatching(/^rec-\d+$/));
    });
    expect(screen.getByText(/2 KB/)).toBeTruthy();
  });

  it('descartar aborta la sesión y vuelve a idle', async () => {
    render(<RecordPanel />);
    await act(async () => {
      screen.getByRole('button', { name: /Solo pantalla/ }).click();
    });
    await waitFor(() => expect(screen.getByText('Grabando')).toBeTruthy());
    await act(async () => {
      screen.getByRole('button', { name: 'Descartar' }).click();
    });
    await waitFor(() => {
      expect(screen.getByText('Listo para grabar')).toBeTruthy();
      expect(api.editorRecordingAbort).toHaveBeenCalledWith(expect.stringMatching(/^rec-\d+$/));
    });
  });

  it('el timer avanza mientras graba', async () => {
    render(<RecordPanel />);
    await act(async () => {
      screen.getByRole('button', { name: /Solo pantalla/ }).click();
    });
    await waitFor(() => expect(screen.getByText('Grabando')).toBeTruthy());
    expect(screen.getByTestId('record-elapsed').textContent).toMatch(/0:0\d/);
  });
});
