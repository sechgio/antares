import { beforeEach, describe, expect, it } from 'vitest';
import {
  $notes,
  MAX_BREAKOUT,
  breakOut,
  createNote,
  freeBreakouts,
  getNote,
  maybeMergeOverlapping,
  mergeNoteIds,
  noteTopic,
  notesInPile,
  removeNote,
  resetStickyNotesForTests,
  returnToStack,
  saveNoteBody,
  splitFromPile,
  stackAll,
  stackedNotes,
  uniquePileIds,
  updateNotes,
} from './notes';

function mountPane(id: string, rect: { left: number; top: number; right: number; bottom: number }) {
  const el = document.createElement('div');
  el.setAttribute('data-floating-pane', id);
  const full = {
    ...rect,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  } as DOMRect;
  el.getBoundingClientRect = () => full;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  resetStickyNotesForTests();
  document.body.innerHTML = '';
});

describe('sticky-notes store', () => {
  it('create lands in the stack and becomes active', () => {
    const n = createNote();
    expect(n.surface).toBe('stack');
    expect(stackedNotes().map((x) => x.id)).toContain(n.id);
  });

  it('breakOut detaches exactly one note as a free float', () => {
    const a = createNote();
    const b = createNote();
    breakOut(a.id);
    expect(getNote(a.id)?.surface).toBe('breakout');
    expect(getNote(a.id)?.pileId).toBeNull();
    expect(getNote(b.id)?.surface).toBe('stack');
    expect(freeBreakouts().map((x) => x.id)).toEqual([a.id]);
  });

  it('breakOut on a stacked note with a stale pileId cleans it instead of splitting', () => {
    const a = createNote();
    updateNotes((list) => list.map((n) => (n.id === a.id ? { ...n, pileId: 'p_stale' } : n)));
    // el saneado de updateNotes ya limpia pileId en notas apiladas
    expect(getNote(a.id)?.pileId).toBeNull();
    breakOut(a.id);
    expect(getNote(a.id)?.surface).toBe('breakout');
    expect(getNote(a.id)?.pileId).toBeNull();
  });

  it('overlapping floats merge into a single pile on drag end', () => {
    const a = createNote();
    const b = createNote();
    updateNotes((list) =>
      list.map((n) => ({ ...n, surface: 'breakout' as const, pileId: null })),
    );
    mountPane(`float-${a.id}`, { left: 0, top: 0, right: 100, bottom: 100 });
    mountPane(`float-${b.id}`, { left: 15, top: 15, right: 115, bottom: 115 });

    maybeMergeOverlapping();

    const piles = uniquePileIds();
    expect(piles).toHaveLength(1);
    expect(notesInPile(piles[0]).map((n) => n.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('non-overlapping floats stay separate', () => {
    const a = createNote();
    const b = createNote();
    updateNotes((list) =>
      list.map((n) => ({ ...n, surface: 'breakout' as const, pileId: null })),
    );
    mountPane(`float-${a.id}`, { left: 0, top: 0, right: 100, bottom: 100 });
    mountPane(`float-${b.id}`, { left: 300, top: 300, right: 400, bottom: 400 });

    maybeMergeOverlapping();

    expect(uniquePileIds()).toHaveLength(0);
    expect(freeBreakouts()).toHaveLength(2);
  });

  it('splitFromPile frees exactly one note; a 2-member pile dissolves completely', () => {
    const a = createNote();
    const b = createNote();
    updateNotes((list) =>
      list.map((n) => ({ ...n, surface: 'breakout' as const, pileId: null })),
    );
    mergeNoteIds([a.id, b.id]);
    const pileId = getNote(a.id)?.pileId;
    expect(pileId).toBeTruthy();

    splitFromPile(a.id);

    expect(getNote(a.id)?.pileId).toBeNull();
    expect(getNote(b.id)?.pileId).toBeNull();
    expect(uniquePileIds()).toHaveLength(0);
    expect(freeBreakouts()).toHaveLength(2);
  });

  it('breakOut from inside a pile detaches only that note', () => {
    const a = createNote();
    const b = createNote();
    const c = createNote();
    updateNotes((list) =>
      list.map((n) => ({ ...n, surface: 'breakout' as const, pileId: null })),
    );
    mergeNoteIds([a.id, b.id, c.id]);
    const pileId = getNote(a.id)?.pileId;

    breakOut(a.id);

    expect(getNote(a.id)?.pileId).toBeNull();
    expect(getNote(b.id)?.pileId).toBe(pileId);
    expect(getNote(c.id)?.pileId).toBe(pileId);
    expect(notesInPile(pileId!)).toHaveLength(2);
  });

  it('stackAll returns every desk note to the stack with pileId cleared', () => {
    const a = createNote();
    const b = createNote();
    updateNotes((list) =>
      list.map((n) => ({ ...n, surface: 'breakout' as const, pileId: null })),
    );
    mergeNoteIds([a.id, b.id]);

    stackAll();

    for (const id of [a.id, b.id]) {
      expect(getNote(id)?.surface).toBe('stack');
      expect(getNote(id)?.pileId).toBeNull();
    }
    expect(uniquePileIds()).toHaveLength(0);
  });

  it('after stackAll, breaking out one stacked row detaches only that id', () => {
    const a = createNote();
    const b = createNote();
    updateNotes((list) =>
      list.map((n) => ({ ...n, surface: 'breakout' as const, pileId: null })),
    );
    mergeNoteIds([a.id, b.id]);
    stackAll();

    breakOut(a.id);

    expect(getNote(a.id)?.surface).toBe('breakout');
    expect(getNote(a.id)?.pileId).toBeNull();
    expect(getNote(b.id)?.surface).toBe('stack');
  });

  it('deleting a member of a 2-note pile dissolves the leftover pile', () => {
    const a = createNote();
    const b = createNote();
    updateNotes((list) =>
      list.map((n) => ({ ...n, surface: 'breakout' as const, pileId: null })),
    );
    mergeNoteIds([a.id, b.id]);

    removeNote(a.id);

    expect(getNote(b.id)?.pileId).toBeNull();
    expect(uniquePileIds()).toHaveLength(0);
  });

  it('returnToStack sends one note home and dissolves a 1-note leftover pile', () => {
    const a = createNote();
    const b = createNote();
    updateNotes((list) =>
      list.map((n) => ({ ...n, surface: 'breakout' as const, pileId: null })),
    );
    mergeNoteIds([a.id, b.id]);

    returnToStack(a.id);

    expect(getNote(a.id)?.surface).toBe('stack');
    expect(getNote(b.id)?.pileId).toBeNull();
    expect(getNote(b.id)?.surface).toBe('breakout');
  });

  it('promotes the body to a one-line title while it is still default', () => {
    const n = createNote();
    saveNoteBody(n.id, 'primera línea útil\nresto del cuerpo');
    expect(getNote(n.id)?.title).toBe('primera línea útil resto del cuerpo');
    expect(noteTopic(getNote(n.id)!)).toBe('primera línea útil resto del cuerpo');
  });

  it('respects the breakout cap', () => {
    const ids = Array.from({ length: MAX_BREAKOUT + 1 }, () => createNote().id);
    for (const id of ids.slice(0, MAX_BREAKOUT)) breakOut(id);
    expect(freeBreakouts()).toHaveLength(MAX_BREAKOUT);

    breakOut(ids[MAX_BREAKOUT]);
    expect(getNote(ids[MAX_BREAKOUT])?.surface).toBe('stack');
    expect($notes.get().filter((n) => n.surface === 'breakout')).toHaveLength(MAX_BREAKOUT);
  });
});
