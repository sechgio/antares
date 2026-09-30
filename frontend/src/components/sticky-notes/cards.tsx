import { useCallback, useEffect, useRef, useState } from 'react';
import { Layers, Plus, Trash2 } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import Button from '@/components/ui/Button';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import { cn } from '@/lib/utils';
import {
  $activePileNote,
  $activeStackId,
  $notes,
  breakOut,
  clearAll,
  createNote,
  focusBreakout,
  isDefaultTitle,
  noteSubpreview,
  noteTopic,
  patchNote,
  removeNote,
  returnToStack,
  saveNoteBody,
  splitFromPile,
  stackAll,
  stackPile,
  useAtomValue,
  type StickyNote,
  type StickyTint,
} from './notes';

const TINTS: Record<StickyTint, string> = {
  classic: 'color-mix(in srgb, var(--accent-primary) 20%, transparent)',
  soft: 'color-mix(in srgb, var(--text-secondary) 10%, transparent)',
  ghost: 'transparent',
};

const TINT_LABELS: Record<StickyTint, string> = {
  classic: 'clásico',
  soft: 'suave',
  ghost: 'fantasma',
};

const iconBtn =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]';

// ── Bandeja (tarjeta única por defecto) ─────────────────────────────────────

export function StackCard({ ready }: { ready: boolean }) {
  const notes = useAtomValue($notes);
  const activeId = useAtomValue($activeStackId);
  const { confirm } = useDialog();
  const { addToast } = useToast();

  const stacked = notes
    .filter((n) => n.open && n.surface === 'stack')
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const deskNotes = notes.filter((n) => n.open && n.surface === 'breakout');
  const deskWindows =
    deskNotes.filter((n) => !n.pileId).length +
    new Set(deskNotes.filter((n) => n.pileId).map((n) => n.pileId)).size;
  const active = stacked.find((n) => n.id === activeId) || stacked[0] || null;

  useEffect(() => {
    if (active && activeId !== active.id) $activeStackId.set(active.id);
    if (!active && activeId) $activeStackId.set(null);
  }, [active, activeId]);

  const requestClearAll = async () => {
    const n = notes.length;
    if (!n) {
      addToast({ type: 'info', message: 'No hay notas que eliminar', view: 'sticky-notes' });
      return;
    }
    const ok = await confirm({
      title: 'Eliminar todas las notas',
      description: `¿Eliminar ${n} nota${n === 1 ? '' : 's'}? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      type: 'destructive',
    });
    if (ok) clearAll();
  };

  if (!ready) {
    return <div className="p-3 text-xs text-[var(--text-muted)]">Cargando…</div>;
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2 p-2"
      style={{ background: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)' }}
    >
      <div className="flex items-center gap-1" data-floating-no-drag>
        <div className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--text-secondary)]">
          {deskWindows
            ? `Notas · ${stacked.length} · ${deskWindows} fuera`
            : `Notas · ${stacked.length}`}
        </div>
        <WithHoverTooltip label="Nueva nota (Ctrl+Shift+N)" placement="bottom">
          <button type="button" className={iconBtn} onClick={() => createNote()} aria-label="Nueva nota">
            <Plus size={13} />
          </button>
        </WithHoverTooltip>
        {deskWindows ? (
          <WithHoverTooltip label="Recoger todas (Ctrl+Alt+S)" placement="bottom">
            <button type="button" className={iconBtn} onClick={stackAll} aria-label="Recoger todas">
              <Layers size={13} />
            </button>
          </WithHoverTooltip>
        ) : null}
        {notes.length ? (
          <WithHoverTooltip label="Eliminar todas" placement="bottom">
            <button
              type="button"
              className={iconBtn}
              onClick={() => void requestClearAll()}
              aria-label="Eliminar todas"
            >
              <Trash2 size={13} />
            </button>
          </WithHoverTooltip>
        ) : null}
      </div>

      {stacked.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-3 text-center">
          <div className="text-xs font-medium text-[var(--text-secondary)]">Sin notas</div>
          <div className="text-[10px] leading-relaxed text-[var(--text-muted)]">
            Nueva agrega una nota aquí. Separar (↗) la fija en su propia ventana. Arrastra ventanas
            hasta solaparlas para apilarlas.
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="max-h-24 shrink-0 overflow-y-auto" data-floating-no-drag>
            <div className="flex flex-col gap-0.5 pr-1">
              {stacked.map((n, i) => {
                const topic = noteTopic(n, 40);
                const sub = noteSubpreview(n, 48);
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={cn(
                      'flex items-start gap-1 rounded px-1.5 py-1 text-left text-[0.7rem] transition-colors',
                      n.id === active?.id
                        ? 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                        : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]',
                    )}
                    onClick={() => $activeStackId.set(n.id)}
                    title={n.body.trim() || topic}
                  >
                    <span className="w-3 shrink-0 pt-0.5 text-[var(--text-muted)]">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-[var(--text-secondary)]">
                        {topic}
                      </span>
                      {sub ? (
                        <span className="block truncate text-[0.62rem] text-[var(--text-muted)]">
                          {sub}
                        </span>
                      ) : null}
                    </span>
                    <WithHoverTooltip label="Separar" placement="left">
                      <span
                        role="button"
                        className="shrink-0 px-1 pt-0.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          breakOut(n.id);
                        }}
                      >
                        ↗
                      </span>
                    </WithHoverTooltip>
                    <WithHoverTooltip label="Eliminar" placement="left">
                      <span
                        role="button"
                        className="shrink-0 px-1 pt-0.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeNote(n.id);
                        }}
                      >
                        ×
                      </span>
                    </WithHoverTooltip>
                  </button>
                );
              })}
            </div>
          </div>
          {active ? <StackEditor note={active} /> : null}
        </div>
      )}

      {deskWindows ? (
        <div className="text-[0.6rem] text-[var(--text-muted)]" data-floating-no-drag>
          {`${deskWindows} en el escritorio — Recoger para volver`}
        </div>
      ) : null}
    </div>
  );
}

function StackEditor({ note }: { note: StickyNote }) {
  const [draft, setDraft] = useState(note.body || '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(note.body || '');
  }, [note.body, note.id]);

  const saveBody = useCallback(
    (value: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => saveNoteBody(note.id, value), 280);
    },
    [note.id],
  );

  const titlePlaceholder = isDefaultTitle(note.title)
    ? noteTopic({ title: '', body: draft || note.body }, 40)
    : 'Título';

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-1.5 rounded-md border border-[var(--border-subtle)] p-2"
      style={{ background: TINTS[note.tint] || TINTS.classic }}
      data-floating-no-drag
    >
      <div className="flex items-center gap-1">
        <input
          className="min-w-0 flex-1 bg-transparent text-xs font-medium text-[var(--text-secondary)] outline-none placeholder:text-[var(--text-muted)]"
          value={isDefaultTitle(note.title) ? '' : note.title}
          placeholder={titlePlaceholder || 'Título'}
          onChange={(e) => patchNote(note.id, { title: e.target.value || 'Nota' })}
        />
        <Button
          size="sm"
          variant="ghost"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            breakOut(note.id);
          }}
        >
          Separar
        </Button>
      </div>
      <textarea
        value={draft}
        placeholder="Escribe algo…"
        className="min-h-0 flex-1 resize-none border-0 bg-transparent p-0 text-sm text-[var(--text-secondary)] shadow-none outline-none placeholder:text-[var(--text-muted)] focus-visible:ring-0"
        onChange={(e) => {
          setDraft(e.target.value);
          saveBody(e.target.value);
        }}
        onBlur={(e) => saveNoteBody(note.id, e.target.value)}
      />
      <div className="flex flex-wrap gap-1 text-[0.6rem] text-[var(--text-muted)]">
        <button
          type="button"
          className="hover:text-[var(--text-secondary)]"
          onClick={() => {
            const keys = Object.keys(TINTS) as StickyTint[];
            const i = keys.indexOf(note.tint);
            patchNote(note.id, { tint: keys[(i + 1) % keys.length] });
          }}
        >
          {TINT_LABELS[note.tint]}
        </button>
      </div>
    </div>
  );
}

// ── Ventana de pila (breakouts fusionadas por solape) ───────────────────────

export function PileCard({ pileId }: { pileId: string }) {
  const notes = useAtomValue($notes);
  const activeMap = useAtomValue($activePileNote);
  const members = notes
    .filter((n) => n.open && n.surface === 'breakout' && n.pileId === pileId)
    .sort((a, b) => (b.zRank || 0) - (a.zRank || 0) || b.updatedAt - a.updatedAt);

  const activeId =
    (activeMap[pileId] && members.some((m) => m.id === activeMap[pileId])
      ? activeMap[pileId]
      : members[0]?.id) || null;
  const note = members.find((m) => m.id === activeId) || members[0];
  const [draft, setDraft] = useState(note?.body || '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(note?.body || '');
  }, [note?.body, note?.id]);

  if (!members.length || !note) {
    return <div className="p-3 text-xs text-[var(--text-muted)]">No encontrada</div>;
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-1.5 p-2"
      style={{ background: TINTS[note.tint] || TINTS.classic }}
    >
      <div className="flex items-center gap-1" data-floating-no-drag>
        <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[0.65rem] font-semibold text-[var(--text-secondary)]">
          {members.length}
        </span>
        <div className="min-w-0 flex-1 truncate text-[0.7rem] font-medium text-[var(--text-secondary)]">
          {`Pila · ${members.length}`}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            stackPile(pileId);
          }}
        >
          Recoger
        </Button>
      </div>
      <div className="max-h-20 shrink-0 overflow-y-auto" data-floating-no-drag>
        <div className="flex flex-col gap-0.5 pr-1">
          {members.map((m, i) => (
            <button
              key={m.id}
              type="button"
              className={cn(
                'flex items-center gap-1 rounded px-1.5 py-1 text-left text-[0.68rem]',
                m.id === note.id
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]',
              )}
              onClick={() => focusBreakout(m.id)}
            >
              <span className="w-3 text-[var(--text-muted)]">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{noteTopic(m, 36)}</span>
              <WithHoverTooltip label="Separar de la pila" placement="left">
                <span
                  role="button"
                  className="px-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    splitFromPile(m.id);
                  }}
                >
                  ↗
                </span>
              </WithHoverTooltip>
              <WithHoverTooltip label="Volver a la bandeja" placement="left">
                <span
                  role="button"
                  className="px-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    returnToStack(m.id);
                  }}
                >
                  ↙
                </span>
              </WithHoverTooltip>
            </button>
          ))}
        </div>
      </div>
      <textarea
        value={draft}
        placeholder="Escribe algo…"
        className="min-h-0 flex-1 resize-none border-0 bg-transparent p-0 text-sm text-[var(--text-secondary)] shadow-none outline-none placeholder:text-[var(--text-muted)] focus-visible:ring-0"
        data-floating-no-drag
        onChange={(e) => {
          setDraft(e.target.value);
          if (timer.current) clearTimeout(timer.current);
          const noteId = note.id;
          timer.current = setTimeout(() => saveNoteBody(noteId, e.target.value), 280);
        }}
        onBlur={(e) => saveNoteBody(note.id, e.target.value)}
      />
    </div>
  );
}

// ── Flotante / nota separada ────────────────────────────────────────────────

export function BreakoutCard({ noteId }: { noteId: string }) {
  const notes = useAtomValue($notes);
  const note = notes.find((n) => n.id === noteId);
  const [draft, setDraft] = useState(note?.body || '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(note?.body || '');
  }, [note?.body, noteId]);

  if (!note) {
    return <div className="p-3 text-xs text-[var(--text-muted)]">No encontrada</div>;
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-1 p-2"
      style={{ background: TINTS[note.tint] || TINTS.classic }}
    >
      <div className="flex items-center justify-end gap-0.5" data-floating-no-drag>
        <WithHoverTooltip label="Volver a la bandeja" placement="left">
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[0.65rem] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
            onClick={() => returnToStack(noteId)}
          >
            ↙ bandeja
          </button>
        </WithHoverTooltip>
        <WithHoverTooltip label="Eliminar" placement="left">
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[0.65rem] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
            onClick={() => removeNote(noteId)}
          >
            ×
          </button>
        </WithHoverTooltip>
      </div>
      <textarea
        value={draft}
        placeholder="Escribe algo…"
        className="min-h-0 flex-1 resize-none border-0 bg-transparent p-0 text-sm text-[var(--text-secondary)] shadow-none outline-none placeholder:text-[var(--text-muted)] focus-visible:ring-0"
        data-floating-no-drag
        onChange={(e) => {
          setDraft(e.target.value);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => saveNoteBody(noteId, e.target.value), 280);
        }}
        onBlur={(e) => saveNoteBody(noteId, e.target.value)}
      />
    </div>
  );
}
