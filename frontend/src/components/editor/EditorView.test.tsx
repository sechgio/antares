import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
  } as any;
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
    mockInvoke.mockImplementation((method: string, params?: any) => {
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

  it('no depende de cuenta ni de Supabase', async () => {
    mockInvoke.mockResolvedValue({ schemaVersion: 1, projects: [], toolchain: { available: true } });
    render(<EditorView />);
    await screen.findByTestId('editor-view');
    // La vista funciona sin usuario: no hay llamadas de auth.
    const authCalls = mockInvoke.mock.calls.filter((call) => String(call[0]).includes('auth'));
    expect(authCalls).toHaveLength(0);
  });
});
