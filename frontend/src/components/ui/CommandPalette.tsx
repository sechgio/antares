import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface CommandItem {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
  icon?: React.ReactNode;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  items: CommandItem[];
}

export default function CommandPalette({ isOpen, onClose, items }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(dialogRef, isOpen);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(q));
  }, [query, items]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = filtered[selectedIndex];
        if (item) {
          item.action();
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, filtered, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] animate-fade-in"
      style={{ backgroundColor: 'color-mix(in srgb, var(--bg-base) 85%, transparent)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        tabIndex={-1}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] animate-scale-in"
        style={{
          boxShadow:
            '0 24px 48px color-mix(in srgb, var(--bg-base) 55%, transparent), 0 0 0 1px color-mix(in srgb, var(--border-subtle) 80%, transparent)',
        }}
      >
        <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-[var(--text-muted)]">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            aria-label="Buscar acción"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar acción..."
            className="flex-1 bg-transparent text-base text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <span className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-muted)]">ESC</span>
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-2" role="listbox" aria-label="Acciones">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
              No se encontraron resultados
            </div>
          )}
          {filtered.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              onClick={() => { item.action(); onClose(); }}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                index === selectedIndex ? 'bg-[var(--accent-primary-glow)]' : 'hover:bg-[var(--bg-surface)]'
              }`}
            >
              {item.icon && <span className="shrink-0 text-[var(--text-muted)]">{item.icon}</span>}
              <span className="flex-1 truncate text-sm text-[var(--text-primary)]">{item.label}</span>
              {item.shortcut && (
                <span className="shrink-0 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]">
                  {item.shortcut}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4 border-t border-[var(--border-subtle)] px-4 py-2 text-[11px] text-[var(--text-muted)]">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1">↑↓</kbd> navegar
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1">↵</kbd> seleccionar
          </span>
        </div>
      </div>
    </div>
  );
}
