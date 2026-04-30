import React, { useEffect, useState, useRef, useMemo } from 'react';

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
      setTimeout(() => inputRef.current?.focus(), 50);
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
      style={{ backgroundColor: 'color-mix(in srgb, var(--bg-base) 66%, transparent)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl bg-dark-surface border border-bdr-medium rounded-2xl shadow-elevated overflow-hidden animate-scale-in">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-bdr-subtle">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-txt-muted shrink-0">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar acción..."
            className="flex-1 bg-transparent text-txt-primary text-base outline-none placeholder:text-txt-muted"
          />
          <span className="text-xs text-txt-muted bg-dark-elevated px-2 py-1 rounded border border-bdr-subtle">ESC</span>
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-2">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-txt-muted">
              No se encontraron resultados
            </div>
          )}
          {filtered.map((item, index) => (
            <button
              key={item.id}
              onClick={() => { item.action(); onClose(); }}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                index === selectedIndex ? 'bg-[var(--accent-primary-glow)]' : 'hover:bg-dark-elevated'
              }`}
            >
              {item.icon && <span className="text-txt-muted shrink-0">{item.icon}</span>}
              <span className="flex-1 text-sm text-txt-primary truncate">{item.label}</span>
              {item.shortcut && (
                <span className="text-[11px] text-txt-muted bg-dark-elevated px-1.5 py-0.5 rounded border border-bdr-subtle shrink-0">
                  {item.shortcut}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-bdr-subtle flex items-center gap-4 text-[11px] text-txt-muted">
          <span className="flex items-center gap-1">
            <kbd className="bg-dark-elevated border border-bdr-subtle rounded px-1">↑↓</kbd> navegar
          </span>
          <span className="flex items-center gap-1">
            <kbd className="bg-dark-elevated border border-bdr-subtle rounded px-1">↵</kbd> seleccionar
          </span>
        </div>
      </div>
    </div>
  );
}
