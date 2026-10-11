import { atom } from '../layout/radio/core';

export { useValue as useAtomValue } from '../layout/radio/core';

/**
 * sticky-notes — notas adhesivas dentro de la ventana.
 * Port del plugin de Hermes Desktop (VGFreakXBL/hermes-sticky-notes, MIT).
 * Una bandeja (stack) por defecto; las notas pueden separarse como flotantes
 * y arrastrarse hasta solaparse para formar pilas.
 */

export type Anchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type StickyTint = 'classic' | 'soft' | 'ghost';
type StickySurface = 'stack' | 'breakout';

export interface StickyNote {
  id: string;
  title: string;
  body: string;
  tint: StickyTint;
  rotation: number;
  open: boolean;
  surface: StickySurface;
  pileId: string | null;
  zRank: number;
  anchor?: Anchor;
  createdAt: number;
  updatedAt: number;
}

export const MAX_BREAKOUT = 6;
export const STACK_ANCHOR: Anchor = 'top-right';
const OVERLAP_MERGE = 0.42;
const MERGE_COOLDOWN_MS = 600;
/** Tras separar/sacar una nota, bloquea el auto-merge para que no vuelva a la pila. */
const SPLIT_MERGE_GRACE_MS = 2200;
const BREAKOUT_ANCHORS: Anchor[] = ['top-left', 'bottom-right', 'bottom-left', 'top-right'];
const STORAGE_KEY = 'sticky_notes.notes';

export const $notes = atom<StickyNote[]>([]);
export const $ready = atom(false);
export const $activeStackId = atom<string | null>(null);
/** pileId → nota activa dentro de esa pila */
export const $activePileNote = atom<Record<string, string>>({});

let lastMergeAt = 0;
let mergeSuppressedUntil = 0;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let breakoutAnchorCursor = 0;
let loaded = false;

type NotifyFn = (message: string) => void;
let notifyFn: NotifyFn = () => {};
export function setStickyNotify(fn: NotifyFn): void {
  notifyFn = fn;
}
function notify(message: string): void {
  notifyFn(message);
}

function suppressMerge(ms = SPLIT_MERGE_GRACE_MS): void {
  mergeSuppressedUntil = Math.max(mergeSuppressedUntil, Date.now() + ms);
}

function pickBreakoutAnchor(): Anchor {
  const a = BREAKOUT_ANCHORS[breakoutAnchorCursor % BREAKOUT_ANCHORS.length];
  breakoutAnchorCursor += 1;
  return a;
}

function pickAnchorAwayFrom(other: Anchor): Anchor {
  const idx = BREAKOUT_ANCHORS.indexOf(other);
  if (idx < 0) return pickBreakoutAnchor();
  return BREAKOUT_ANCHORS[(idx + 1) % BREAKOUT_ANCHORS.length];
}

function uid(): string {
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function migrateNote(raw: unknown): StickyNote | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Record<string, unknown>;
  const surface: StickySurface = n.surface === 'breakout' ? 'breakout' : 'stack';
  return {
    id: String(n.id || uid()),
    title: String(n.title || 'Nota'),
    body: String(n.body || ''),
    tint: n.tint === 'soft' || n.tint === 'ghost' ? n.tint : 'classic',
    rotation: typeof n.rotation === 'number' ? n.rotation : 0,
    open: n.open !== false,
    surface,
    pileId:
      surface === 'breakout' && typeof n.pileId === 'string' && n.pileId
        ? n.pileId
        : null,
    zRank: typeof n.zRank === 'number' ? n.zRank : 0,
    anchor:
      n.anchor === 'top-left' || n.anchor === 'top-right' || n.anchor === 'bottom-left' || n.anchor === 'bottom-right'
        ? n.anchor
        : undefined,
    createdAt: typeof n.createdAt === 'number' ? n.createdAt : Date.now(),
    updatedAt: typeof n.updatedAt === 'number' ? n.updatedAt : Date.now(),
  };
}

export function loadNotes(): void {
  if (loaded) return;
  loaded = true;
  let raw: unknown = [];
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    raw = [];
  }
  const byId = new Map<string, StickyNote>();
  for (const item of Array.isArray(raw) ? raw : []) {
    let note = migrateNote(item);
    if (!note) continue;
    if (isDefaultTitle(note.title)) {
      const line = oneLine(note.body);
      if (line) note = { ...note, title: line.length > 48 ? `${line.slice(0, 47)}…` : line };
    }
    if (note.surface !== 'breakout') {
      note = { ...note, pileId: null };
    }
    byId.set(note.id, note);
  }
  const list = [...byId.values()];
  $notes.set(list);
  // Igual que en el registro del plugin: toda nota abierta fuera del escritorio
  // vuelve a la bandeja y pierde pileId (updateNotes aplica el saneado).
  updateNotes((l) =>
    l.map((n) =>
      n.open && n.surface !== 'breakout' ? { ...n, surface: 'stack' as const, rotation: 0 } : n,
    ),
  );
  $ready.set(true);
  const stacked = $notes.get().filter((n) => n.open && n.surface === 'stack');
  if (stacked.length && !$activeStackId.get()) {
    $activeStackId.set(stacked.sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
  }
}

/** Test hook: reinicia el estado en memoria. */
export function resetStickyNotesForTests(): void {
  loaded = false;
  $notes.set([]);
  $activeStackId.set(null);
  $activePileNote.set({});
  $ready.set(false);
  lastMergeAt = 0;
  mergeSuppressedUntil = 0;
  breakoutAnchorCursor = 0;
}

function persistNow(list: StickyNote[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Sin persistencia si el almacenamiento está lleno o bloqueado.
  }
}

function schedulePersist(): void {
  ensureUnloadFlush();
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow($notes.get());
  }, 200);
}

function flushPersist(): void {
  if (!persistTimer) return;
  clearTimeout(persistTimer);
  persistTimer = null;
  persistNow($notes.get());
}

let unloadFlushRegistered = false;
function ensureUnloadFlush(): void {
  // Sin esto, cerrar antes de 200 ms tras la última tecla perdía la edición.
  if (unloadFlushRegistered || typeof window === 'undefined') return;
  unloadFlushRegistered = true;
  window.addEventListener('pagehide', flushPersist);
}

export function getNote(id: string): StickyNote | null {
  return $notes.get().find((n) => n.id === id) || null;
}

export function stackedNotes(): StickyNote[] {
  return $notes
    .get()
    .filter((n) => n.open && n.surface === 'stack')
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Todas las notas del escritorio (flotantes libres + miembros de pila). */
function breakoutNotes(): StickyNote[] {
  return $notes
    .get()
    .filter((n) => n.open && n.surface === 'breakout')
    .sort((a, b) => (a.zRank || 0) - (b.zRank || 0) || a.createdAt - b.createdAt);
}

export function freeBreakouts(): StickyNote[] {
  return breakoutNotes().filter((n) => !n.pileId);
}

export function notesInPile(pileId: string): StickyNote[] {
  return breakoutNotes().filter((n) => n.pileId === pileId);
}

export function uniquePileIds(): string[] {
  const ids = new Set<string>();
  for (const n of breakoutNotes()) {
    if (n.pileId) ids.add(n.pileId);
  }
  return [...ids];
}

/** Nota visible de una pila: la activa si sigue siendo miembro, si no la más alta. */
export function pileTopNote(pileId: string): StickyNote | null {
  const members = notesInPile(pileId).sort(
    (a, b) => (b.zRank || 0) - (a.zRank || 0) || b.updatedAt - a.updatedAt,
  );
  if (!members.length) return null;
  const activeId = $activePileNote.get()[pileId];
  const active = activeId ? members.find((m) => m.id === activeId) : undefined;
  return active || members[0];
}

function nextZRank(scopePileId: string | null): number {
  const pool = $notes
    .get()
    .filter(
      (n) =>
        n.surface === 'breakout' &&
        (scopePileId ? n.pileId === scopePileId : !n.pileId),
    );
  let max = 0;
  for (const n of pool) max = Math.max(max, n.zRank || 0);
  return max + 1;
}

function setActivePileNote(pileId: string, noteId: string): void {
  $activePileNote.set({ ...$activePileNote.get(), [pileId]: noteId });
}

/** Sube una flotante al frente (orden DOM) o dentro de su pila. */
export function focusBreakout(id: string): void {
  const n = getNote(id);
  if (!n || n.surface !== 'breakout' || !n.open) return;

  if (n.pileId) {
    setActivePileNote(n.pileId, id);
    const rank = nextZRank(n.pileId);
    $notes.set($notes.get().map((x) => (x.id === id ? { ...x, zRank: rank } : x)));
    schedulePersist();
    return;
  }

  const ordered = freeBreakouts();
  const top = ordered[ordered.length - 1];
  if (top && top.id === id) return;
  const rank = nextZRank(null);
  $notes.set($notes.get().map((x) => (x.id === id ? { ...x, zRank: rank } : x)));
  schedulePersist();
}

// ── Solape → fusión en pila ─────────────────────────────────────────────────

interface DeskRect {
  kind: 'float' | 'pile';
  id: string;
  r: { left: number; top: number; right: number; bottom: number; width: number; height: number };
}

function readDeskRects(): DeskRect[] {
  if (typeof document === 'undefined') return [];
  const out: DeskRect[] = [];
  document.querySelectorAll('[data-floating-pane]').forEach((el) => {
    const raw = el.getAttribute('data-floating-pane') || '';
    const r = el.getBoundingClientRect();
    if (r.width < 12 || r.height < 12) return;
    const floatM = raw.match(/(?:^|:)float-(.+)$/);
    const pileM = raw.match(/(?:^|:)pile-(.+)$/);
    if (floatM) out.push({ kind: 'float', id: floatM[1], r });
    if (pileM) out.push({ kind: 'pile', id: pileM[1], r });
  });
  return out;
}

function overlapFrac(
  a: { left: number; top: number; right: number; bottom: number; width: number; height: number },
  b: { left: number; top: number; right: number; bottom: number; width: number; height: number },
): number {
  const x1 = Math.max(a.left, b.left);
  const y1 = Math.max(a.top, b.top);
  const x2 = Math.min(a.right, b.right);
  const y2 = Math.min(a.bottom, b.bottom);
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const minArea = Math.min(a.width * a.height, b.width * b.height);
  return minArea > 0 ? inter / minArea : 0;
}

function entityNoteIds(ent: DeskRect): string[] {
  if (ent.kind === 'float') {
    const n = getNote(ent.id);
    return n && n.surface === 'breakout' && !n.pileId ? [n.id] : [];
  }
  return notesInPile(ent.id).map((n) => n.id);
}

export function mergeNoteIds(ids: string[]): boolean {
  const unique = [...new Set(ids)].filter((id) => getNote(id));
  if (unique.length < 2) return false;

  const members = unique.map((id) => getNote(id)).filter((n): n is StickyNote => Boolean(n));
  const existingPile = members.find((n) => n.pileId)?.pileId;
  const front = members
    .slice()
    .sort((a, b) => (a.zRank || 0) - (b.zRank || 0))
    .pop();
  if (!front) return false;
  const pileId = existingPile || `p_${front.id}`;
  const topRank = nextZRank(pileId);

  $notes.set(
    $notes.get().map((n) => {
      if (!unique.includes(n.id)) return n;
      return {
        ...n,
        surface: 'breakout',
        pileId,
        zRank: n.id === front.id ? topRank : n.zRank || 0,
        updatedAt: Date.now(),
      };
    }),
  );
  setActivePileNote(pileId, front.id);
  schedulePersist();
  notify(`Pila · ${unique.length} notas (clic para hojear · ↗ separa)`);
  return true;
}

/** Tras soltar un arrastre: floats/pilas solapadas se compilan en una pila. */
export function maybeMergeOverlapping(): void {
  const now = Date.now();
  if (now < mergeSuppressedUntil) return;
  if (now - lastMergeAt < MERGE_COOLDOWN_MS) return;

  const rects = readDeskRects();
  if (rects.length < 2) return;

  // Union-find sobre entidades solapadas
  const parent = new Map(rects.map((_, i) => [i, i]));
  const find = (i: number): number => {
    let p = parent.get(i) ?? i;
    while (p !== parent.get(p)) {
      p = parent.get(p) ?? p;
    }
    parent.set(i, p);
    return p;
  };
  const unite = (i: number, j: number) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent.set(a, b);
  };

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (overlapFrac(rects[i].r, rects[j].r) >= OVERLAP_MERGE) unite(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < rects.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)?.push(i);
  }

  let merged = false;
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    const noteIds: string[] = [];
    for (const i of idxs) noteIds.push(...entityNoteIds(rects[i]));
    if (new Set(noteIds).size >= 2 && mergeNoteIds(noteIds)) merged = true;
  }
  if (merged) {
    lastMergeAt = now;
    // Gracia breve para que el re-layout no provoque un segundo merge
    suppressMerge(400);
  }
}

/** La capa llama esto al terminar un arrastre real; difiere para estabilizar posiciones. */
export function requestMergeCheck(): void {
  setTimeout(() => {
    maybeMergeOverlapping();
  }, 100);
}

function dissolvePileIfSingleton(pileId: string): void {
  const members = notesInPile(pileId);
  if (members.length !== 1) return;
  const only = members[0];
  $notes.set(
    $notes.get().map((n) =>
      n.id === only.id ? { ...n, pileId: null, zRank: nextZRank(null) } : n,
    ),
  );
  const ap = { ...$activePileNote.get() };
  delete ap[pileId];
  $activePileNote.set(ap);
  schedulePersist();
}

/**
 * Saca una nota de su pila a flotante libre.
 * Suprime el auto-merge después: el nuevo float aparece cerca de la pila
 * y el pointerup podría reabsorberla.
 */
export function splitFromPile(id: string): void {
  const n = getNote(id);
  if (!n?.pileId) return;
  const pileId = n.pileId;
  const siblings = notesInPile(pileId).filter((x) => x.id !== id);
  const siblingAnchor = siblings[0]?.anchor || null;

  suppressMerge(SPLIT_MERGE_GRACE_MS);

  const splitAnchor = pickAnchorAwayFrom(siblingAnchor || n.anchor || 'top-left');

  $notes.set(
    $notes.get().map((x) => {
      if (x.id === id) {
        return {
          ...x,
          pileId: null,
          zRank: nextZRank(null),
          anchor: splitAnchor,
          updatedAt: Date.now(),
        };
      }
      if (siblings.length === 1 && x.id === siblings[0].id) {
        return {
          ...x,
          pileId: null,
          zRank: nextZRank(null),
          anchor: x.anchor || siblingAnchor || 'top-right',
          updatedAt: Date.now(),
        };
      }
      return x;
    }),
  );

  if (siblings.length <= 1) {
    const ap = { ...$activePileNote.get() };
    delete ap[pileId];
    $activePileNote.set(ap);
  } else {
    const rest = notesInPile(pileId);
    if (rest.length && $activePileNote.get()[pileId] === id) {
      setActivePileNote(pileId, rest[rest.length - 1].id);
    }
  }

  schedulePersist();
  notify(siblings.length ? 'Separada de la pila' : 'Nota desanclada');
}

/** Títulos por defecto que no cuentan como tema real. */
export function isDefaultTitle(title: string): boolean {
  const t = (title || '').trim();
  if (!t) return true;
  return /^nota(\s*#?\s*\d+)?$/i.test(t);
}

function oneLine(text: string): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Etiqueta legible para filas y chrome: título propio o primera línea del cuerpo. */
export function noteTopic(n: { title?: string; body?: string }, max = 48): string {
  const title = oneLine(n?.title || '');
  const body = oneLine(n?.body || '');
  let topic = !isDefaultTitle(title) ? title : body || 'Nota vacía';
  if (topic.length > max) topic = `${topic.slice(0, Math.max(1, max - 1))}…`;
  return topic;
}

/** Vista previa secundaria bajo el tema (cuerpo cuando hay título propio). */
export function noteSubpreview(n: { title?: string; body?: string }, max = 56): string {
  const title = oneLine(n?.title || '');
  const body = oneLine(n?.body || '');
  if (!body || isDefaultTitle(title) || body === title) return '';
  return body.length > max ? `${body.slice(0, Math.max(1, max - 1))}…` : body;
}

/** Al editar el cuerpo con título por defecto, la primera línea pasa a título. */
function maybePromoteTitle(id: string, body: string): void {
  const n = getNote(id);
  if (!n || !isDefaultTitle(n.title)) return;
  const line = oneLine(body);
  if (!line) return;
  const title = line.length > 48 ? `${line.slice(0, 47)}…` : line;
  $notes.set(
    $notes.get().map((x) => (x.id === id ? { ...x, title, body, updatedAt: Date.now() } : x)),
  );
  schedulePersist();
}

export function updateNotes(mutator: (list: StickyNote[]) => StickyNote[]): void {
  const next = mutator($notes.get().slice());
  // Sanitiza + deduplica por id (última escritura gana)
  const byId = new Map<string, StickyNote>();
  for (const n of next) {
    if (!n?.id) continue;
    let x = n;
    if (x.surface !== 'breakout' && x.pileId) x = { ...x, pileId: null };
    byId.set(x.id, x);
  }
  // Una pila nunca queda con un solo miembro: se disuelve a flotante libre.
  const pileCounts = new Map<string, number>();
  for (const x of byId.values()) {
    if (x.surface === 'breakout' && x.pileId) {
      pileCounts.set(x.pileId, (pileCounts.get(x.pileId) || 0) + 1);
    }
  }
  for (const x of [...byId.values()]) {
    if (x.pileId && (pileCounts.get(x.pileId) || 0) < 2) {
      byId.set(x.id, { ...x, pileId: null });
    }
  }
  const finalList = [...byId.values()];
  $notes.set(finalList);
  const livePiles = new Set(finalList.map((n) => n.pileId).filter(Boolean));
  const ap = $activePileNote.get();
  const nextAp = Object.fromEntries(Object.entries(ap).filter(([k]) => livePiles.has(k)));
  if (Object.keys(nextAp).length !== Object.keys(ap).length) $activePileNote.set(nextAp);
  schedulePersist();
}

export function createNote(): StickyNote {
  const note: StickyNote = {
    id: uid(),
    title: 'Nota',
    body: '',
    tint: 'classic',
    rotation: 0,
    open: true,
    surface: 'stack',
    pileId: null,
    zRank: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  updateNotes((list) => list.concat(note));
  $activeStackId.set(note.id);
  notify('Nota agregada');
  return note;
}

export function patchNote(id: string, patch: Partial<StickyNote>): void {
  updateNotes((list) =>
    list.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)),
  );
}

export function saveNoteBody(id: string, body: string): void {
  patchNote(id, { body });
  maybePromoteTitle(id, body);
}

export function removeNote(id: string): void {
  updateNotes((list) => list.filter((n) => n.id !== id));
  if ($activeStackId.get() === id) {
    const next = stackedNotes()[0];
    $activeStackId.set(next ? next.id : null);
  }
}

export function clearAll(): void {
  $notes.set([]);
  $activeStackId.set(null);
  $activePileNote.set({});
  schedulePersist();
  notify('Notas eliminadas');
}

export function stackAll(): void {
  updateNotes((list) =>
    list.map((n) =>
      n.open
        ? { ...n, surface: 'stack' as const, pileId: null, rotation: 0, updatedAt: Date.now() }
        : n,
    ),
  );
  $activePileNote.set({});
  const top = stackedNotes()[0];
  if (top) $activeStackId.set(top.id);
  notify('Todas las notas recogidas');
}

/** Devuelve todas las notas de una pila a la bandeja principal. */
export function stackPile(pileId: string): void {
  if (!pileId) return;
  updateNotes((list) =>
    list.map((n) =>
      n.pileId === pileId
        ? { ...n, surface: 'stack' as const, pileId: null, rotation: 0, updatedAt: Date.now() }
        : n,
    ),
  );
  const ap = { ...$activePileNote.get() };
  delete ap[pileId];
  $activePileNote.set(ap);
  const top = stackedNotes()[0];
  if (top) $activeStackId.set(top.id);
}

/**
 * Pone exactamente una nota en el escritorio como flotante libre.
 * Nunca saca en lote. Un pileId obsoleto en una nota apilada se limpia, no se
 * trata como separación de pila.
 */
export function breakOut(id: string): void {
  const n = getNote(id);
  if (!n || !n.open) return;

  if (n.surface === 'breakout' && n.pileId) {
    splitFromPile(id);
    return;
  }

  if (n.surface === 'breakout' && !n.pileId) {
    focusBreakout(id);
    return;
  }

  if (freeBreakouts().length + uniquePileIds().length >= MAX_BREAKOUT) {
    notify(`Límite de ventanas: ${MAX_BREAKOUT}`);
    return;
  }

  suppressMerge(SPLIT_MERGE_GRACE_MS);

  updateNotes((list) =>
    list.map((x) => {
      if (x.id !== id) {
        if (x.surface === 'stack' && x.pileId) return { ...x, pileId: null };
        return x;
      }
      return {
        ...x,
        surface: 'breakout' as const,
        pileId: null,
        anchor: pickBreakoutAnchor(),
        rotation: 0,
        zRank: nextZRank(null),
        updatedAt: Date.now(),
      };
    }),
  );
}

export function returnToStack(id: string): void {
  const n = getNote(id);
  if (!n) return;
  const pileId = n.pileId;

  updateNotes((list) =>
    list.map((x) =>
      x.id === id
        ? { ...x, surface: 'stack' as const, pileId: null, rotation: 0, updatedAt: Date.now() }
        : x,
    ),
  );
  $activeStackId.set(id);

  if (pileId) {
    const left = $notes
      .get()
      .filter((x) => x.open && x.surface === 'breakout' && x.pileId === pileId);
    if (left.length === 1) {
      dissolvePileIfSingleton(pileId);
    } else if (left.length === 0) {
      const ap = { ...$activePileNote.get() };
      delete ap[pileId];
      $activePileNote.set(ap);
    }
  }
}
