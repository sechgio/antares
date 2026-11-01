import { useCallback, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BellDot, Copy, Eye, EyeOff, FolderInput, FolderMinus, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import Button from '../ui/Button';
import Input from '../ui/Input';

export interface SidebarPrefs {
  pinned: string[];
  unread: string[];
  hidden: string[];
  sections: Record<string, string>;
}

export const EMPTY_SIDEBAR_PREFS: SidebarPrefs = { pinned: [], unread: [], hidden: [], sections: {} };

export function parseSidebarPrefs(raw: string): SidebarPrefs {
  const value = JSON.parse(raw) as Partial<SidebarPrefs> | null;
  const ids = (list: unknown) => (Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : []);
  const sections = value && typeof value.sections === 'object' && value.sections ? value.sections : {};
  return {
    pinned: ids(value?.pinned),
    unread: ids(value?.unread),
    hidden: ids(value?.hidden),
    sections: Object.fromEntries(Object.entries(sections).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
  };
}

export function toggleId(list: string[], id: string, on: boolean): string[] {
  const rest = list.filter((item) => item !== id);
  return on ? [...rest, id] : rest;
}

/** Splits items into pinned, custom sections and the rest, keeping their order. */
export function arrangeSidebar<T extends { id: string }>(items: T[], prefs: SidebarPrefs, showHidden: boolean) {
  const shown = showHidden ? items : items.filter((item) => !prefs.hidden.includes(item.id));
  const pinned = shown.filter((item) => prefs.pinned.includes(item.id));
  const loose = shown.filter((item) => !prefs.pinned.includes(item.id));
  const names = [...new Set(loose.map((item) => prefs.sections[item.id]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  return {
    pinned,
    sections: names.map((label) => ({ label, items: loose.filter((item) => prefs.sections[item.id] === label) })),
    rest: loose.filter((item) => !prefs.sections[item.id]),
    hiddenCount: items.filter((item) => prefs.hidden.includes(item.id)).length,
  };
}

const ITEM = 'flex h-9 w-full items-center gap-3 rounded-[10px] px-2.5 text-left text-[13.5px] font-normal text-[color:color-mix(in_srgb,var(--text-primary)_88%,transparent)] transition-colors hover:bg-[var(--bg-input)] focus-visible:bg-[var(--bg-input)] focus-visible:outline-none [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:stroke-[1.75] [&>svg]:text-[var(--text-secondary)]';
const SEPARATOR = <div role="separator" className="mx-2 my-1 h-px bg-[var(--border-subtle)]" />;

export default function SidebarItemMenu({
  id, name, noun, renameLabel, pinned, unread, hidden, section, className, children,
  onPin, onUnread, onHidden, onSection, onRename, onDelete, onCopied,
}: {
  id: string;
  name: string;
  noun: string;
  renameLabel: string;
  pinned: boolean;
  unread: boolean;
  hidden: boolean;
  section?: string;
  className: string;
  children: ReactNode;
  onPin: (on: boolean) => void;
  onUnread: (on: boolean) => void;
  onHidden: (on: boolean) => void;
  onSection: (section: string | null) => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => void;
  onCopied: () => void;
}) {
  const [form, setForm] = useState<{ kind: 'rename' | 'section'; value: string } | null>(null);
  const pointRef = useRef<{ x: number; y: number } | null>(null);
  const positioner = useCallback((rect: DOMRect, popup: HTMLElement | null) => {
    const width = 248;
    const height = popup?.offsetHeight ?? 300;
    const x = pointRef.current?.x ?? rect.left - 4;
    const y = pointRef.current?.y ?? rect.bottom + 6;
    return {
      width,
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, y + height > window.innerHeight - 8 ? y - height : y),
    };
  }, []);
  const menu = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({ stopEscapePropagation: true, positioner });

  const close = () => {
    setForm(null);
    menu.close();
  };
  const act = (fn: () => void) => () => { close(); fn(); };

  return (
    <div
      className={`${className} ${menu.isOpen ? '!bg-[var(--bg-input)]' : ''}`}
      data-open={menu.isOpen || undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        pointRef.current = { x: e.clientX, y: e.clientY };
        setForm(null);
        if (menu.isOpen) menu.updatePosition();
        else menu.open();
      }}
    >
      {children}
      <Button
        ref={menu.triggerRef}
        variant="none"
        size="none"
        aria-label={`Opciones de ${name}`}
        aria-haspopup="menu"
        aria-expanded={menu.isOpen}
        title="Más opciones"
        onClick={() => { pointRef.current = null; setForm(null); menu.toggle(); }}
        className={`absolute right-1.5 flex size-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_8%,transparent)] hover:text-[var(--text-primary)] group-hover:visible group-focus-within:visible ${menu.isOpen ? 'visible' : 'invisible'}`}
      >
        <MoreHorizontal size={15} />
      </Button>
      {menu.isOpen && createPortal(
        <div
          ref={menu.popupRef}
          role="menu"
          aria-label={`Opciones de ${name}`}
          className="fixed z-[300] w-[248px] rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.35),0_2px_8px_rgba(0,0,0,0.12)]"
          style={{ top: menu.position?.top ?? -9999, left: menu.position?.left ?? -9999, visibility: menu.position ? 'visible' : 'hidden' }}
        >
          {form ? (
            <form
              className="space-y-2 p-1"
              onSubmit={(e) => {
                e.preventDefault();
                const value = form.value.trim();
                if (!value) return;
                if (form.kind === 'section') { onSection(value); close(); }
                else void onRename(value).then(close);
              }}
            >
              <p className="px-0.5 text-[12px] text-[var(--text-muted)]">{form.kind === 'rename' ? renameLabel : 'Nombre de la sección'}</p>
              <Input autoFocus value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} maxLength={form.kind === 'rename' ? 120 : 40}
                aria-label={form.kind === 'rename' ? renameLabel : 'Nombre de la sección'} className="w-full" />
              <div className="flex justify-end gap-1.5">
                <Button type="button" size="sm" variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
                <Button type="submit" size="sm" disabled={!form.value.trim()}>Guardar</Button>
              </div>
            </form>
          ) : (
            <>
              <button type="button" role="menuitem" className={ITEM} onClick={act(() => onPin(!pinned))}>
                {pinned ? <PinOff size={15} /> : <Pin size={15} />} {pinned ? 'Desfijar' : 'Fijar'}
              </button>
              <button type="button" role="menuitem" className={ITEM} onClick={() => setForm({ kind: 'section', value: '' })}>
                <FolderInput size={15} /> Mover a nueva sección
              </button>
              {section && (
                <button type="button" role="menuitem" className={ITEM} onClick={act(() => onSection(null))}>
                  <FolderMinus size={15} /> Quitar de «{section}»
                </button>
              )}
              <button type="button" role="menuitem" className={ITEM} onClick={act(() => onUnread(!unread))}>
                <BellDot size={15} /> {unread ? 'Marcar como leído' : 'Marcar como no leído'}
              </button>
              {SEPARATOR}
              <button type="button" role="menuitem" className={ITEM} onClick={() => setForm({ kind: 'rename', value: name })}>
                <Pencil size={15} /> {renameLabel}
              </button>
              {SEPARATOR}
              <button
                type="button"
                role="menuitem"
                className={ITEM}
                onClick={act(() => { void navigator.clipboard?.writeText(id).then(onCopied).catch(() => {}); })}
              >
                <Copy size={15} /> Copiar ID {noun === 'agente' ? 'del agente' : 'de la conversación'}
              </button>
              {SEPARATOR}
              <button type="button" role="menuitem" className={ITEM} onClick={act(() => onHidden(!hidden))}>
                {hidden ? <Eye size={15} /> : <EyeOff size={15} />} {hidden ? 'Mostrar en la barra lateral' : 'Ocultar de la barra lateral'}
              </button>
              <button type="button" role="menuitem" className={`${ITEM} !text-[var(--accent-red)] [&>svg]:!text-[var(--accent-red)]`} onClick={act(onDelete)}>
                <Trash2 size={15} /> Eliminar
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
