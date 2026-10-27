import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { AgentMessage, AgentSession } from '../../api/agentApi';
import type { TranscriptView } from './AgentTimeline';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import Button from '../ui/Button';
import Input from '../ui/Input';

const VIEWS: { value: TranscriptView; label: string; hint: string }[] = [
  { value: 'normal', label: 'Normal', hint: 'Pasos plegados' },
  { value: 'thinking', label: 'Pensamiento', hint: 'Razonamiento abierto' },
  { value: 'verbose', label: 'Detallado', hint: 'Todos los pasos abiertos' },
];

const ITEM = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-input)]';

export function conversationText(title: string, messages: AgentMessage[]): string {
  const lines = [`# ${title}`];
  for (const msg of messages) {
    if (msg.role === 'tool_result' || !msg.content) continue;
    lines.push('', `${msg.role === 'user' ? 'Tú' : 'Agente'}:`, msg.content);
  }
  return lines.join('\n');
}

export default function ConversationMenu({ session, messages, view, onView, onRename, onDelete, onCopied }: {
  session: AgentSession;
  messages: AgentMessage[];
  view: TranscriptView;
  onView: (view: TranscriptView) => void;
  onRename: (title: string) => Promise<void>;
  onDelete: () => void;
  onCopied: () => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const menu = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    align: 'end', estimatedWidth: 240, estimatedHeight: 300, stopEscapePropagation: true,
  });

  const close = () => {
    setRenaming(null);
    menu.close();
  };

  return (
    <>
      <Button
        ref={menu.triggerRef}
        variant="none"
        size="none"
        aria-label="Opciones de la conversación"
        aria-haspopup="menu"
        aria-expanded={menu.isOpen}
        title="Opciones de la conversación"
        onClick={menu.toggle}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
      >
        <MoreHorizontal size={15} />
      </Button>
      {menu.isOpen && createPortal(
        <div
          ref={menu.popupRef}
          role="menu"
          aria-label="Opciones de la conversación"
          className="fixed z-[300] w-[240px] rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-surface)] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.18),0_2px_6px_rgba(0,0,0,0.06)]"
          style={{ top: menu.position?.top ?? -9999, left: menu.position?.left ?? -9999, visibility: menu.position ? 'visible' : 'hidden' }}
        >
          {renaming !== null ? (
            <form
              className="space-y-2 p-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (renaming.trim()) void onRename(renaming.trim()).then(close);
              }}
            >
              <Input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} maxLength={120}
                aria-label="Nuevo nombre de la conversación" className="w-full" />
              <div className="flex justify-end gap-1.5">
                <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancelar</Button>
                <Button type="submit" size="sm" disabled={!renaming.trim()}>Guardar</Button>
              </div>
            </form>
          ) : (
            <>
              <button type="button" role="menuitem" className={ITEM} onClick={() => setRenaming(session.title || '')}>
                <Pencil size={14} className="text-[var(--text-secondary)]" /> Renombrar
              </button>
              <button
                type="button"
                role="menuitem"
                className={ITEM}
                disabled={!messages.length}
                onClick={() => {
                  void navigator.clipboard?.writeText(conversationText(session.title || 'Conversación', messages)).then(onCopied).catch(() => {});
                  close();
                }}
              >
                <Copy size={14} className="text-[var(--text-secondary)]" /> Copiar conversación
              </button>
              <div role="group" aria-label="Vista del chat" className="my-1 border-y border-[var(--border-subtle)] py-1">
                <p className="px-2.5 py-1 text-[11.5px] text-[var(--text-muted)]">Vista del chat</p>
                {VIEWS.map((option) => (
                  <button key={option.value} type="button" role="menuitemradio" aria-checked={view === option.value} className={ITEM}
                    onClick={() => { onView(option.value); close(); }}>
                    <Check size={14} className={view === option.value ? 'text-[var(--text-secondary)]' : 'invisible'} aria-hidden="true" />
                    <span className="min-w-0 flex-1">{option.label}</span>
                    <span className="text-[11.5px] text-[var(--text-muted)]">{option.hint}</span>
                  </button>
                ))}
              </div>
              <button type="button" role="menuitem" className={`${ITEM} text-[var(--accent-red)]`} onClick={() => { close(); onDelete(); }}>
                <Trash2 size={14} /> Eliminar conversación
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
