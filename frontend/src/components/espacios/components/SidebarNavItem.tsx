import type { ReactNode } from 'react';
import { Star, Trash2 } from 'lucide-react';
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
  onDelete: () => void;
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
  onDelete,
  deleteLabel,
}: SidebarNavItemProps) {
  const accentColor = resolveItemColor(color, colorIndex);

  return (
    <li>
      <div
        className={`group/item relative flex w-full items-center gap-1 overflow-hidden rounded-lg border px-1.5 py-1 transition-colors duration-150 ${
          isActive
            ? 'border-[var(--border-medium)] bg-[var(--bg-base)]'
            : 'border-[var(--border-subtle)] bg-transparent hover:border-[var(--border-medium)] hover:bg-[var(--bg-base)]/40'
        }`}
        style={isActive ? { backgroundColor: `${accentColor}14` } : undefined}
      >
        <span
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ backgroundColor: accentColor }}
          aria-hidden="true"
        />

        <div className="relative z-[1] pl-1">
          <ColorSwatchPicker color={accentColor} label={name} onChange={onColorChange} />
        </div>

        <button
          type="button"
          onClick={onSelect}
          aria-current={isActive ? 'true' : undefined}
          className="relative z-[1] flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-sm"
        >
          {icon}
          <span
            className={`min-w-0 flex-1 truncate pr-5 ${
              isActive ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
            }`}
          >
            {name}
          </span>
          {isFavorite && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />}
        </button>

        <button
          type="button"
          onClick={onDelete}
          className="relative z-[1] shrink-0 rounded-md p-1 text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--accent-red)]/10 hover:text-[var(--accent-red)] group-hover/item:opacity-100 group-focus-within/item:opacity-100 focus:opacity-100"
          aria-label={deleteLabel}
          title={deleteLabel}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}