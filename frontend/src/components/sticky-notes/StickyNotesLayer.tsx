import { useEffect, useRef, useState } from 'react';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';
import { useToast } from '../../hooks/useToast';
import {
  $activePileNote,
  $notes,
  $ready,
  STACK_ANCHOR,
  createNote,
  focusBreakout,
  freeBreakouts,
  loadNotes,
  noteTopic,
  notesInPile,
  pileTopNote,
  requestMergeCheck,
  setStickyNotify,
  stackAll,
  uniquePileIds,
  useAtomValue,
  type Anchor,
} from './notes';
import { BreakoutCard, PileCard, StackCard } from './cards';

const POS_KEY_PREFIX = 'sticky_notes.pos.';
const EDGE_MARGIN = 24;
const TOP_OFFSET = 72;

interface Position {
  x: number;
  y: number;
}

function clampPos(p: Position, w: number, h: number): Position {
  return {
    x: Math.min(Math.max(8, p.x), Math.max(8, window.innerWidth - w - 8)),
    y: Math.min(Math.max(8, p.y), Math.max(8, window.innerHeight - h - 8)),
  };
}

function anchorPos(anchor: Anchor, w: number, h: number): Position {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  switch (anchor) {
    case 'top-left':
      return { x: EDGE_MARGIN, y: TOP_OFFSET };
    case 'bottom-left':
      return { x: EDGE_MARGIN, y: Math.max(8, vh - h - EDGE_MARGIN) };
    case 'bottom-right':
      return { x: Math.max(8, vw - w - EDGE_MARGIN), y: Math.max(8, vh - h - EDGE_MARGIN) };
    case 'top-right':
    default:
      return { x: Math.max(8, vw - w - EDGE_MARGIN), y: TOP_OFFSET };
  }
}

function loadPos(paneId: string, w: number, h: number): Position | null {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY_PREFIX + paneId) || 'null') as Position | null;
    if (v && typeof v.x === 'number' && typeof v.y === 'number') return clampPos(v, w, h);
  } catch {
    // posición inválida → vuelve al anchor
  }
  return null;
}

function savePos(paneId: string, pos: Position): void {
  try {
    localStorage.setItem(POS_KEY_PREFIX + paneId, JSON.stringify(pos));
  } catch {
    // sin persistencia de posición
  }
}

interface FloatingCardProps {
  paneId: string;
  anchor: Anchor;
  width: number;
  height: number;
  chrome: string;
  mergeTracked?: boolean;
  onFocus?: () => void;
  children: React.ReactNode;
}

/**
 * Tarjeta flotante arrastrable. Equivale a un pane `placement:'floating'` del
 * host de Hermes: arrastre libre dentro de la ventana, posición persistida y
 * merge por solape al soltar (`requestMergeCheck` solo tras arrastre real).
 */
function FloatingCard({
  paneId,
  anchor,
  width,
  height,
  chrome,
  mergeTracked = true,
  onFocus,
  children,
}: FloatingCardProps) {
  const [pos, setPos] = useState<Position>(
    () => loadPos(paneId, width, height) ?? anchorPos(anchor, width, height),
  );
  const posRef = useRef(pos);
  const dragRef = useRef<{ offX: number; offY: number; startX: number; startY: number; moved: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const next = clampPos({ x: e.clientX - d.offX, y: e.clientY - d.offY }, width, height);
      if (!d.moved && Math.hypot(next.x - d.startX, next.y - d.startY) > 6) d.moved = true;
      setPos(next);
    };
    const onUp = () => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      savePos(paneId, posRef.current);
      if (d.moved && mergeTracked) requestMergeCheck();
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  }, [width, height, paneId, mergeTracked]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    onFocus?.();
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('[data-floating-no-drag]')) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    dragRef.current = {
      offX: e.clientX - rect.left,
      offY: e.clientY - rect.top,
      startX: rect.left,
      startY: rect.top,
      moved: false,
    };
    rootRef.current?.setPointerCapture(e.pointerId);
  };

  const shown = clampPos(pos, width, height);

  return (
    <div
      ref={rootRef}
      data-floating-pane={mergeTracked ? paneId : undefined}
      className="pointer-events-auto fixed flex flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[0_8px_28px_rgba(0,0,0,0.45)]"
      style={{ left: shown.x, top: shown.y, width, height }}
      onPointerDown={onPointerDown}
    >
      <div className="flex h-6 shrink-0 cursor-grab items-center border-b border-[var(--border-subtle)] px-2">
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          {chrome}
        </span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

export default function StickyNotesLayer() {
  // Suscripción a los átomos: los selectores leen de ellos en cada render.
  useAtomValue($notes);
  const ready = useAtomValue($ready);
  useAtomValue($activePileNote);
  const { addToast } = useToast();

  useEffect(() => {
    setStickyNotify((message) => addToast({ type: 'info', message, view: 'sticky-notes' }));
    return () => setStickyNotify(() => {});
  }, [addToast]);

  useEffect(() => {
    loadNotes();
  }, []);

  useKeyboardShortcut('n', () => createNote(), { ctrl: true, shift: true });
  useKeyboardShortcut('s', () => stackAll(), { ctrl: true, alt: true });

  const free = freeBreakouts();
  const piles = uniquePileIds();

  // Una sola lista ordenada por zRank: antes se renderizaban primero todas las
  // libres y luego todas las pilas, así que el orden DOM (y el apilado)
  // ignoraba el z global y enfocar una libre no la traía al frente.
  const orderedFloaters = [
    ...free.map((n) => ({
      key: `float-${n.id}`,
      z: n.zRank || 0,
      created: n.createdAt,
      pileId: null as string | null,
      note: n,
    })),
    ...piles.map((pid) => {
      const top = pileTopNote(pid);
      return {
        key: `pile-${pid}`,
        z: top?.zRank || 0,
        created: top?.createdAt ?? 0,
        pileId: pid,
        note: top,
      };
    }),
  ].sort((a, b) => a.z - b.z || a.created - b.created);

  return (
    <div className="pointer-events-none fixed inset-0 z-[80]">
      <FloatingCard
        paneId="stack"
        anchor={STACK_ANCHOR}
        width={280}
        height={320}
        chrome="Notas"
        mergeTracked={false}
      >
        <StackCard ready={ready} />
      </FloatingCard>
      {orderedFloaters.map((entry) => {
        if (entry.pileId === null && entry.note) {
          const n = entry.note;
          return (
            <FloatingCard
              key={entry.key}
              paneId={`float-${n.id}`}
              anchor={n.anchor || 'top-left'}
              width={248}
              height={200}
              chrome={noteTopic(n, 36)}
              onFocus={() => focusBreakout(n.id)}
            >
              <BreakoutCard noteId={n.id} />
            </FloatingCard>
          );
        }
        const pid = entry.pileId ?? '';
        const top = pileTopNote(pid);
        const mem = notesInPile(pid);
        return (
          <FloatingCard
            key={entry.key}
            paneId={`pile-${pid}`}
            anchor={top?.anchor || 'top-left'}
            width={280}
            height={300}
            chrome={`Pila · ${mem.length} · ${noteTopic(top || {}, 22)}`}
          >
            <PileCard pileId={pid} />
          </FloatingCard>
        );
      })}
    </div>
  );
}
