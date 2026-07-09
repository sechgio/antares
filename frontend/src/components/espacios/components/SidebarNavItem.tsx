import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pencil, Star, Trash2 } from 'lucide-react';
import ColorSwatchPicker from './ColorSwatchPicker';
import { resolveItemColor } from '../utils/colors';

interface SidebarNavItemProps {
  name: string;
  color: string | null;
  colorIndex: number;
  isActive: boolean;
  icon?: ReactNode;
  isFavorite?: boolean;
  onSelect: () => void;
  onColorChange: (color: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  renameLabel: string;
  deleteLabel: string;
}

export default function SidebarNavItem({
  name,
  color,
  colorIndex,
  isActive,
  icon,
  isFavorite,
  onSelect,
  onColorChange,
  onRename,
  onDelete,
  renameLabel,
  deleteLabel,
}: SidebarNavItemProps) {
  const accentColor = resolveItemColor(color, colorIndex);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editing]);

  const startEditing = () => {
    finishedRef.current = false;
    setDraft(name);
    setEditing(true);
  };

  const cancelEditing = () => {
    finishedRef.current = true;
    setDraft(name);
    setEditing(false);
  };

  const commitEditing = () => {
    // Guard against Enter+blur double commit.
    if (finishedRef.current) return;
    finishedRef.current = true;
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === name) {
      setDraft(name);
      return;
    }
    onRename(trimmed);
  };

  return (
    <li>
      <div
        className={`group/item relative flex w-full items-center gap-1 rounded-lg border px-1.5 py-1 transition-colors duration-150 ${
          isActive
            ? 'border-[var(--border-medium)] bg-[var(--bg-base)]'
            : 'border-[var(--border-subtle)] bg-transparent hover:border-[var(--border-medium)] hover:bg-[var(--bg-base)]/40'
        }`}
        style={isActive ? { backgroundColor: `${accentColor}14` } : undefined}
      >
        <span
          className="pointer-events-none absolute inset-y-0 left-0 w-[3px] rounded-l-[7px]"
          style={{ backgroundColor: accentColor }}
          aria-hidden="true"
        />

        <div className="relative z-[1] shrink-0 pl-1">
          <ColorSwatchPicker color={accentColor} label={name} onChange={onColorChange} />
        </div>

        {editing ? (
          <form
            className="relative z-[1] min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              commitEditing();
            }}
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEditing}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelEditing();
                }
              }}
              aria-label={renameLabel}
              className="w-full rounded-md border border-[var(--border-medium)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]/30"
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={onSelect}
            onDoubleClick={(e) => {
              e.preventDefault();
              startEditing();
            }}
            aria-current={isActive ? 'true' : undefined}
            title="Doble clic para renombrar"
            className="relative z-[1] flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[10px]"
          >
            {icon}
            <span
              className={`min-w-0 flex-1 truncate pr-1 leading-snug ${
                isActive ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
              }`}
            >
              {name}
            </span>
            {isFavorite && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />}
          </button>
        )}

        {!editing && (
          <div className="relative z-[1] flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/item:opacity-100 group-focus-within/item:opacity-100">
            <button
              type="button"
              onClick={startEditing}
              className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-base)] hover:text-[var(--text-primary)] focus:opacity-100"
              aria-label={renameLabel}
              title={renameLabel}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--accent-red)]/10 hover:text-[var(--accent-red)] focus:opacity-100"
              aria-label={deleteLabel}
              title={deleteLabel}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
