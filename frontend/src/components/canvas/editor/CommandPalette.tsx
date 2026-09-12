import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

export interface CanvasCommand {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  group?: string;
  disabled?: boolean;
}

interface CommandPaletteProps {
  commands: CanvasCommand[];
  onRun: (id: string) => void;
  onClose: () => void;
}

function matches(command: CanvasCommand, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const haystack = `${command.label} ${command.keywords ?? ''} ${command.group ?? ''}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export default memo(function CommandPalette({ commands, onRun, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => matches(c, tokens));
  }, [commands, query]);

  const runnable = filtered.filter((c) => !c.disabled);
  const active = runnable[Math.min(activeIndex, Math.max(0, runnable.length - 1))];

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.canvas-command-palette')) onClose();
    };
    window.addEventListener('mousedown', onPointer);
    return () => window.removeEventListener('mousedown', onPointer);
  }, [onClose]);

  const run = (command: CanvasCommand | undefined) => {
    if (!command || command.disabled) return;
    onRun(command.id);
    onClose();
  };

  return (
    <div className="canvas-command-palette" data-testid="canvas-command-palette" role="dialog" aria-label="Comandos">
      <div className="canvas-command-input-wrap">
        <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <input
          autoFocus
          className="canvas-command-input"
          placeholder="Buscar acción…"
          aria-label="Buscar acción"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
              return;
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const dir = e.key === 'ArrowDown' ? 1 : -1;
              setActiveIndex((cur) => {
                if (!runnable.length) return 0;
                return (cur + dir + runnable.length) % runnable.length;
              });
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              run(active);
            }
          }}
        />
        <kbd className="canvas-kbd">Esc</kbd>
      </div>
      <div ref={listRef} className="canvas-command-list" role="listbox">
        {filtered.map((command) => {
          const isActive = !command.disabled && active?.id === command.id;
          return (
            <button
              key={command.id}
              type="button"
              role="option"
              aria-selected={isActive}
              data-active={isActive || undefined}
              className="canvas-command-item"
              disabled={command.disabled}
              onMouseEnter={() => {
                const idx = runnable.findIndex((c) => c.id === command.id);
                if (idx >= 0) setActiveIndex(idx);
              }}
              onClick={() => run(command)}
            >
              <span className="min-w-0 flex-1 truncate text-left">{command.label}</span>
              {command.group && <span className="canvas-command-group">{command.group}</span>}
              {command.hint && <kbd className="canvas-kbd">{command.hint}</kbd>}
            </button>
          );
        })}
        {!filtered.length && (
          <div className="canvas-command-empty">Sin resultados para «{query}»</div>
        )}
      </div>
    </div>
  );
});
