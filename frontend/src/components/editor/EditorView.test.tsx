import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { EditorView } from './EditorView';

const mockInvoke = vi.fn();

function projectFixture() {
  return {
    id: 'p1',
    schemaVersion: 1,
    name: 'Proyecto de prueba',
    revision: 1,
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
    canvas: {
      width: 1280,
      height: 720,
      fps: { num: 25, den: 1 },
      background: { type: 'solid', color: '#000000' },
      workingColorSpace: 'bt709-sdr',
    },
    assets: [],
    tracks: [
      { id: 'track-v', kind: 'video', order: 0, visible: true, muted: false, locked: false },
      { id: 'track-a', kind: 'audio', order: 1, visible: true, muted: false, locked: false },
    ],
    clips: [],
    exportSettings: {
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      width: 1280,
      height: 720,
      fps: { num: 25, den: 1 },
      qualityPreset: 'balanced',
      audioSampleRate: 48000,
      audioChannels: 2,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.electronAPI = {
    invoke: mockInvoke,
    onNotify: vi.fn(),
    reportRendererError: vi.fn(),
  } as never;
});

describe('EditorView', () => {
  it('muestra el estado vacío con Crear proyecto cuando no hay proyectos', async () => {
    mockInvoke.mockImplementation((method: string) => {
      if (method === 'editor_bootstrap') {
        return Promise.resolve({ schemaVersion: 1, projects: [], toolchain: { available: true } });
      }
      return Promise.resolve({});
    });
    render(<EditorView />);
    expect(await screen.findByRole('button', { name: /Crear proyecto/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Abrir archivos/i })).toBeInTheDocument();
  });

  it('lista proyectos recientes y abre el elegido', async () => {
    mockInvoke.mockImplementation((method: string, params?: unknown) => {
      if (method === 'editor_bootstrap') {
        return Promise.resolve({
          schemaVersion: 1,
          projects: [{ id: 'p1', name: 'Mi video' }],
          toolchain: { available: true },
        });
      }
      if (method === 'editor_project_get') {
        return Promise.resolve({ project: projectFixture() });
      }
      return Promise.resolve({});
    });
    render(<EditorView />);
    fireEvent.click(await screen.findByRole('button', { name: /Mi video/i }));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('editor_project_get', { projectId: 'p1' });
    });
    expect(await screen.findByTestId('editor-preview')).toBeInTheDocument();
  });

  it('crea un proyecto y muestra preview, timeline y propiedades', async () => {
    mockInvoke.mockImplementation((method: string) => {
      if (method === 'editor_bootstrap') {
        return Promise.resolve({ schemaVersion: 1, projects: [], toolchain: { available: true } });
      }
      if (method === 'editor_project_create') {
        return Promise.resolve({ project: projectFixture() });
      }
      return Promise.resolve({});
    });
    render(<EditorView />);
    fireEvent.click(await screen.findByRole('button', { name: /Crear proyecto/i }));
    expect(await screen.findByTestId('editor-preview')).toBeInTheDocument();
    expect(screen.getByTestId('editor-timeline')).toBeInTheDocument();
    expect(screen.getByLabelText('Propiedades')).toBeInTheDocument();
    expect(screen.getByTestId('editor-save-state')).toHaveTextContent('Guardado');
  });

  it('Abrir archivos abre el diálogo y no crea proyecto si se cancela', async () => {
    mockInvoke.mockImplementation((method: string) => {
      if (method === 'editor_bootstrap') {
        return Promise.resolve({ schemaVersion: 1, projects: [], toolchain: { available: true } });
      }
      if (method === 'editor_import_files') return Promise.resolve({ paths: [], file_tokens: [] });
      return Promise.resolve({});
    });
    render(<EditorView />);
    fireEvent.click(await screen.findByRole('button', { name: /Abrir archivos/i }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('editor_import_files', {}));
    expect(mockInvoke).not.toHaveBeenCalledWith('editor_project_create', expect.anything());
  });

  it('añade un medio importado a la línea de tiempo con el botón +', async () => {
    const withAsset = {
      ...projectFixture(),
      assets: [
        {
          id: 'a1',
          type: 'video',
          displayName: 'toma.mp4',
          byteSize: 10,
          sha256: 'a'.repeat(64),
          durationUs: 4_000_000,
          streams: [{ index: 0, kind: 'video', codec: 'h264', timeBase: { num: 1, den: 25 } }],
        },
      ],
    };
    mockInvoke.mockImplementation((method: string) => {
      if (method === 'editor_bootstrap') {
        return Promise.resolve({ schemaVersion: 1, projects: [{ id: 'p1', name: 'Mi video' }], toolchain: { available: true } });
      }
      if (method === 'editor_project_get') return Promise.resolve({ project: withAsset });
      return Promise.resolve({});
    });
    render(<EditorView />);
    fireEvent.click(await screen.findByRole('button', { name: /Mi video/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir toma.mp4 a la línea de tiempo' }));
    const timeline = screen.getByTestId('editor-timeline');
    expect(await within(timeline).findByRole('button', { name: 'toma.mp4', pressed: true })).toBeInTheDocument();
    expect(screen.getByTestId('editor-timecode')).toHaveTextContent('00:00:00 / 00:04:00');
  });

  it('no depende de cuenta ni de Supabase', async () => {
    mockInvoke.mockResolvedValue({ schemaVersion: 1, projects: [], toolchain: { available: true } });
    render(<EditorView />);
    await screen.findByTestId('editor-view');
    const authCalls = mockInvoke.mock.calls.filter((call) => String(call[0]).includes('auth'));
    expect(authCalls).toHaveLength(0);
  });
});
