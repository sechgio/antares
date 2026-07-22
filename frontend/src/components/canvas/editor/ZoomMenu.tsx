import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { clampZoom } from '../ops/viewportNav';

interface ZoomMenuProps {
  zoom: number;
  onZoom: (z: number) => void;
  onZoomFit: () => void;
}

const ZOOM_STEP = 0.1;

function parseZoomPercent(raw: string): number | null {
  const cleaned = raw.trim().replace(/%/g, '').replace(',', '.');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return clampZoom(n / 100);
}

interface ZoomAction {
  id: string;
  label: string;
  tip?: string;
  run: () => void;
  checked?: boolean;
}

export default function ZoomMenu({ zoom, onZoom, onZoomFit }: ZoomMenuProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const pct = Math.round(zoom * 100);

  useEffect(() => {
    if (!open) return;
    setDraft(`${pct}%`);
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, pct]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const commitDraft = () => {
    const next = parseZoomPercent(draft);
    if (next == null) {
      setDraft(`${pct}%`);
      return;
    }
    onZoom(next);
    setOpen(false);
  };

  const runAndClose = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  const near = (target: number) => Math.abs(pct - target) < 1;

  const actions: ZoomAction[] = [
    {
      id: 'in',
      label: 'Acercar',
      tip: 'Ctrl++',
      run: () => onZoom(clampZoom(zoom + ZOOM_STEP)),
    },
    {
      id: 'out',
      label: 'Alejar',
      tip: 'Ctrl+-',
      run: () => onZoom(clampZoom(zoom - ZOOM_STEP)),
    },
    {
      id: 'fit',
      label: 'Zoom para encajar',
      tip: 'Shift+1',
      run: onZoomFit,
    },
    {
      id: '50',
      label: 'Zoom al 50 %',
      run: () => onZoom(0.5),
      checked: near(50),
    },
    {
      id: '100',
      label: 'Zoom al 100 %',
      tip: 'Ctrl+0',
      run: () => onZoom(1),
      checked: near(100),
    },
    {
      id: '200',
      label: 'Zoom al 200 %',
      run: () => onZoom(2),
      checked: near(200),
    },
  ];

  return (
    <div ref={rootRef} className="relative shrink-0">
      <WithHoverTooltip label="Zoom" placement="bottom" variant="dark">
        <button
          type="button"
          className="canvas-zoom-trigger"
          aria-label="Zoom"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((v) => !v)}
        >
          <span>{pct}%</span>
          <ChevronDown className="h-3 w-3 opacity-80" strokeWidth={2.5} />
        </button>
      </WithHoverTooltip>

      {open && (
        <div
          id={menuId}
          className="canvas-zoom-menu"
          role="menu"
          data-testid="canvas-zoom-menu"
        >
          <div className="canvas-zoom-menu-pad">
            <input
              ref={inputRef}
              className="canvas-zoom-menu-input"
              value={draft}
              aria-label="Porcentaje de zoom"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitDraft();
                }
              }}
              onBlur={() => {
                const next = parseZoomPercent(draft);
                if (next != null) onZoom(next);
                else setDraft(`${pct}%`);
              }}
            />
          </div>

          <div className="canvas-zoom-menu-sep" />

          <div className="canvas-zoom-menu-pad py-1">
            {actions.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className="canvas-zoom-menu-item"
                onClick={() => runAndClose(item.run)}
              >
                <span className="canvas-zoom-menu-check" aria-hidden>
                  {item.checked ? <Check className="h-3 w-3" strokeWidth={2.5} /> : null}
                </span>
                <span className="min-w-0 flex-1 text-left">{item.label}</span>
                {item.tip && <span className="canvas-zoom-menu-tip">{item.tip}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
