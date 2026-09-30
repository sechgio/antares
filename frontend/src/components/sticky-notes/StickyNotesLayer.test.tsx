import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../hooks/useToast';
import { DialogProvider } from '../../hooks/useDialog';
import Dialog from '../ui/Dialog';
import StickyNotesLayer from './StickyNotesLayer';
import {
  createNote,
  freeBreakouts,
  mergeNoteIds,
  resetStickyNotesForTests,
  stackedNotes,
  uniquePileIds,
  updateNotes,
} from './notes';
import { isPluginEnabled, setPluginEnabled } from '../../plugins';
import PluginsView from '../settings/PluginsView';

function renderLayer() {
  return render(
    <ToastProvider>
      <DialogProvider>
        <StickyNotesLayer />
        <Dialog />
      </DialogProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  resetStickyNotesForTests();
  document.body.innerHTML = '';
});

describe('StickyNotesLayer', () => {
  it('mounts the stack card and creates a note from the header', () => {
    renderLayer();
    expect(screen.getByText('Notas · 0')).toBeInTheDocument();
    expect(screen.getByText('Sin notas')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Nueva nota'));

    expect(stackedNotes()).toHaveLength(1);
    expect(screen.getByText('Notas · 1')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Escribe algo…')).toBeInTheDocument();
  });

  it('breaks a note out into a floating card', () => {
    renderLayer();
    fireEvent.click(screen.getByLabelText('Nueva nota'));
    const id = stackedNotes()[0].id;

    fireEvent.click(screen.getByText('Separar'));

    expect(freeBreakouts().map((n) => n.id)).toEqual([id]);
    expect(document.querySelector(`[data-floating-pane="float-${id}"]`)).not.toBeNull();
  });

  it('renders a pile window when notes are merged', () => {
    renderLayer();
    let pileId = '';
    let aId = '';
    act(() => {
      const a = createNote();
      const b = createNote();
      aId = a.id;
      updateNotes((list) =>
        list.map((n) => ({ ...n, surface: 'breakout' as const, pileId: null })),
      );
      mergeNoteIds([a.id, b.id]);
      pileId = uniquePileIds()[0];
    });

    expect(document.querySelector(`[data-floating-pane="pile-${pileId}"]`)).not.toBeNull();
    expect(screen.getByText('Pila · 2')).toBeInTheDocument();
    expect(document.querySelector(`[data-floating-pane="float-${aId}"]`)).toBeNull();
  });

  it('stack-all returns pile members to the stack', () => {
    renderLayer();
    act(() => {
      const a = createNote();
      const b = createNote();
      updateNotes((list) =>
        list.map((n) => ({ ...n, surface: 'breakout' as const, pileId: null })),
      );
      mergeNoteIds([a.id, b.id]);
    });

    fireEvent.click(screen.getByText('Recoger'));

    expect(uniquePileIds()).toHaveLength(0);
    expect(stackedNotes()).toHaveLength(2);
  });

  it('clear-all asks for confirmation before deleting', async () => {
    renderLayer();
    act(() => {
      createNote();
    });

    fireEvent.click(screen.getByLabelText('Eliminar todas'));
    expect(await screen.findByText('Eliminar todas las notas')).toBeInTheDocument();
    expect(stackedNotes()).toHaveLength(1);
  });
});

describe('PluginsView', () => {
  it('toggles the sticky-notes plugin flag', () => {
    render(<PluginsView />);
    expect(isPluginEnabled('sticky-notes')).toBe(false);

    fireEvent.click(screen.getByLabelText('Activar Sticky Notes'));
    expect(isPluginEnabled('sticky-notes')).toBe(true);
    expect(localStorage.getItem('plugin.sticky-notes.enabled')).toBe('true');

    fireEvent.click(screen.getByLabelText('Desactivar Sticky Notes'));
    expect(isPluginEnabled('sticky-notes')).toBe(false);
  });

  it('lists only radio enabled by default and can disable it', () => {
    render(<PluginsView />);
    expect(screen.getAllByRole('switch').map((control) => [
      control.getAttribute('aria-label'),
      control.getAttribute('aria-checked'),
    ])).toEqual([
      ['Activar Sticky Notes', 'false'],
      ['Desactivar Radio Live', 'true'],
      ['Activar Spotify', 'false'],
      ['Activar Audius', 'false'],
      ['Activar Jamendo', 'false'],
      ['Activar Archive', 'false'],
    ]);
    expect(isPluginEnabled('radio-live')).toBe(true);
    expect(isPluginEnabled('spotify')).toBe(false);

    fireEvent.click(screen.getByLabelText('Desactivar Radio Live'));
    expect(isPluginEnabled('radio-live')).toBe(false);
    expect(localStorage.getItem('plugin.radio-live.enabled')).toBe('false');

    fireEvent.click(screen.getByLabelText('Activar Spotify'));
    expect(isPluginEnabled('spotify')).toBe(true);
    expect(localStorage.getItem('plugin.spotify.enabled')).toBe('true');
  });

  it('keeps the in-session preference when storage writes fail', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('sin espacio', 'QuotaExceededError');
    });
    render(<PluginsView />);
    fireEvent.click(screen.getByLabelText('Activar Sticky Notes'));
    expect(isPluginEnabled('sticky-notes')).toBe(true);
    fireEvent.click(screen.getByLabelText('Desactivar Sticky Notes'));
    expect(isPluginEnabled('sticky-notes')).toBe(false);
    spy.mockRestore();
  });
});
