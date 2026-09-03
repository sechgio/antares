import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Pipette, X } from 'lucide-react';
import { clampOpacity, normalizeHex } from '../ops/layerStyle';

interface ColorPickerProps {
  color: string;
  opacity: number;
  pageColors: string[];
  anchor: DOMRect;
  onChange: (color: string, opacity: number) => void;
  onClose: () => void;
}

const PICKER_WIDTH = 240;
const GAP = 10;
const EST_HEIGHT = 360;

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const full = normalizeHex(hex, '#000000').slice(1);
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function positionBeside(anchor: DOMRect, height: number): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = anchor.left - PICKER_WIDTH - GAP;
  if (left < 8) {
    left = Math.min(anchor.right + GAP, vw - PICKER_WIDTH - 8);
  }
  left = Math.max(8, left);

  let top = anchor.top;
  if (top + height > vh - 8) top = vh - height - 8;
  if (top < 8) top = 8;
  return { left, top };
}

export default function ColorPicker({
  color,
  opacity,
  pageColors,
  anchor,
  onChange,
  onClose,
}: ColorPickerProps) {
  const initial = hexToHsv(color);
  const [h, setH] = useState(initial.h);
  const [s, setS] = useState(initial.s);
  const [v, setV] = useState(initial.v);
  const [hexInput, setHexInput] = useState(normalizeHex(color).replace('#', ''));
  const [op, setOp] = useState(clampOpacity(opacity));
  const [pos, setPos] = useState(() => positionBeside(anchor, EST_HEIGHT));
  const panelRef = useRef<HTMLDivElement>(null);
  const skipCloseRef = useRef(true);

  const hex = hsvToHex(h, s, v);
  const emitRef = useRef(onChange);
  emitRef.current = onChange;

  useEffect(() => {
    setHexInput(hex.replace('#', ''));
  }, [hex]);

  const lastEmit = useRef<string>('');
  useEffect(() => {
    const key = `${hex}|${op}`;
    if (lastEmit.current === key) return;
    if (!lastEmit.current) {
      const initialHex = normalizeHex(color).toUpperCase();
      const initialOp = clampOpacity(opacity);
      lastEmit.current = `${initialHex}|${initialOp}`;
      if (hex === initialHex && op === initialOp) return;
    }
    lastEmit.current = key;
    emitRef.current(hex, op);
  }, [hex, op, color, opacity]);

  useLayoutEffect(() => {
    const el = panelRef.current;
    const height = el?.offsetHeight || EST_HEIGHT;
    setPos(positionBeside(anchor, height));
  }, [anchor, pageColors.length]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      skipCloseRef.current = false;
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (skipCloseRef.current) return;
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);

  const pickSv = (clientX: number, clientY: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const ns = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const nv = 1 - Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    setS(ns);
    setV(nv);
  };

  const pickHue = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    setH(Math.min(359, Math.max(0, ((clientX - rect.left) / rect.width) * 360)));
  };

  const pickAlpha = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    setOp(clampOpacity(((clientX - rect.left) / rect.width) * 100));
  };

  const eyeDrop = async () => {
    const EyeDropperCtor = (
      window as Window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }
    ).EyeDropper;
    if (!EyeDropperCtor) return;
    try {
      const result = await new EyeDropperCtor().open();
      const next = hexToHsv(result.sRGBHex);
      setH(next.h);
      setS(next.s);
      setV(next.v);
    } catch {
      /* user cancelled */
    }
  };

  const hueColor = hsvToHex(h, 1, 1);

  return createPortal(
    <div
      ref={panelRef}
      className="canvas-color-picker"
      style={{ left: pos.left, top: pos.top }}
      data-testid="canvas-color-picker"
      role="dialog"
      aria-label="Selector de color"
    >
      <div className="canvas-color-picker-tabs">
        <button type="button" className="canvas-color-picker-tab" data-active="true">
          Personalizado
        </button>
        <div className="canvas-color-picker-tabs-actions">
          <button type="button" className="canvas-paint-icon" aria-label="Cerrar" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div
        className="canvas-color-sv"
        style={{
          background: `
            linear-gradient(to top, #000, transparent),
            linear-gradient(to right, #fff, ${hueColor})
          `,
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          const el = e.currentTarget;
          el.setPointerCapture(e.pointerId);
          pickSv(e.clientX, e.clientY, el);
          const move = (ev: PointerEvent) => pickSv(ev.clientX, ev.clientY, el);
          const up = () => {
            el.releasePointerCapture(e.pointerId);
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
          };
          el.addEventListener('pointermove', move);
          el.addEventListener('pointerup', up);
        }}
      >
        <div
          className="canvas-color-sv-thumb"
          style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: hex }}
        />
      </div>

      <div
        className="canvas-color-slider"
        style={{
          background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          const el = e.currentTarget;
          el.setPointerCapture(e.pointerId);
          pickHue(e.clientX, el);
          const move = (ev: PointerEvent) => pickHue(ev.clientX, el);
          const up = () => {
            el.releasePointerCapture(e.pointerId);
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
          };
          el.addEventListener('pointermove', move);
          el.addEventListener('pointerup', up);
        }}
      >
        <div className="canvas-color-slider-thumb" style={{ left: `${(h / 360) * 100}%` }} />
      </div>

      <div
        className="canvas-color-slider canvas-color-slider-alpha"
        style={{
          backgroundImage: `
            linear-gradient(to right, transparent, ${hex}),
            linear-gradient(45deg, #d0d0d0 25%, transparent 25%),
            linear-gradient(-45deg, #d0d0d0 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #d0d0d0 75%),
            linear-gradient(-45deg, transparent 75%, #d0d0d0 75%)
          `,
          backgroundColor: '#fff',
          backgroundSize: 'auto, 8px 8px, 8px 8px, 8px 8px, 8px 8px',
          backgroundPosition: '0 0, 0 0, 0 4px, 4px -4px, -4px 0',
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          const el = e.currentTarget;
          el.setPointerCapture(e.pointerId);
          pickAlpha(e.clientX, el);
          const move = (ev: PointerEvent) => pickAlpha(ev.clientX, el);
          const up = () => {
            el.releasePointerCapture(e.pointerId);
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
          };
          el.addEventListener('pointermove', move);
          el.addEventListener('pointerup', up);
        }}
      >
        <div className="canvas-color-slider-thumb" style={{ left: `${op}%` }} />
      </div>

      <div className="canvas-color-row">
        <button
          type="button"
          className="canvas-paint-icon"
          aria-label="Cuentagotas"
          onClick={() => void eyeDrop()}
        >
          <Pipette className="h-3.5 w-3.5" />
        </button>
        <div className="canvas-color-hex-group">
          <span className="canvas-color-hex-label">Hex</span>
          <input
            className="canvas-color-hex-input"
            value={hexInput}
            onChange={(e) => {
              const raw = e.target.value.replace('#', '').slice(0, 6);
              setHexInput(raw);
              if (/^[0-9a-fA-F]{6}$/.test(raw)) {
                const next = hexToHsv(`#${raw}`);
                setH(next.h);
                setS(next.s);
                setV(next.v);
                const candidate = `#${raw}`.toUpperCase();
                if (candidate === hex) {
                  emitRef.current(candidate, op);
                }
              }
            }}
            aria-label="Hex"
          />
        </div>
        <div className="canvas-color-op-group">
          <input
            className="canvas-color-op-input"
            type="number"
            value={op}
            onChange={(e) => setOp(clampOpacity(Number(e.target.value) || 0))}
            aria-label="Opacidad"
          />
          <span className="canvas-paint-pct">%</span>
        </div>
      </div>

      {pageColors.length > 0 && (
        <div className="canvas-color-page">
          <button type="button" className="canvas-color-page-label" tabIndex={-1}>
            En esta página
            <ChevronDown className="h-3 w-3" />
          </button>
          <div className="canvas-color-swatches">
            {pageColors.map((c) => (
              <button
                key={c}
                type="button"
                className="canvas-color-swatch-chip"
                style={{ background: c }}
                aria-label={c}
                onClick={() => {
                  const next = hexToHsv(c);
                  setH(next.h);
                  setS(next.s);
                  setV(next.v);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
