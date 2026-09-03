import { useEffect, useRef, useState } from 'react';
import { Minus } from 'lucide-react';
import { clampOpacity, normalizeHex } from '../ops/layerStyle';
import ColorPicker from './ColorPicker';
import { VisibilityIcon } from './VisibilityIcon';

interface PaintRowProps {
  color: string;
  opacity: number;
  visible: boolean;
  pageColors: string[];
  onPaintChange: (color: string, opacity: number) => void;
  onPaintCommit?: () => void;
  onVisibleChange?: (visible: boolean) => void;
  onRemove: () => void;
}

export default function PaintRow({
  color,
  opacity,
  visible,
  pageColors,
  onPaintChange,
  onPaintCommit,
  onVisibleChange,
  onRemove,
}: PaintRowProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const normalized = normalizeHex(color === 'transparent' ? '#FFFFFF' : color);
  const [hexDraft, setHexDraft] = useState(normalized.replace('#', ''));
  const displayColor = color === 'transparent' ? 'transparent' : normalized;
  const op = clampOpacity(opacity);

  useEffect(() => {
    setHexDraft(normalized.replace('#', ''));
  }, [normalized]);

  const closePicker = () => {
    setOpen(false);
    onPaintCommit?.();
  };

  return (
    <>
      <div className="canvas-paint-row" data-testid="canvas-paint-row">
        <button
          ref={swatchRef}
          type="button"
          className="canvas-swatch"
          aria-label="Color"
          onClick={(e) => {
            e.stopPropagation();
            if (open) {
              closePicker();
              return;
            }
            const rect = swatchRef.current?.getBoundingClientRect();
            if (rect) {
              setAnchor(rect);
              setOpen(true);
            }
          }}
        >
          <span
            className="canvas-swatch-fill"
            style={{
              background: visible && displayColor !== 'transparent' ? displayColor : 'transparent',
              opacity: visible ? op / 100 : 0.25,
            }}
          />
        </button>
        <input
          className="canvas-paint-hex"
          value={hexDraft}
          aria-label="Hex"
          onChange={(e) => {
            const raw = e.target.value.replace('#', '').slice(0, 6);
            if (!/^[0-9a-fA-F]*$/i.test(raw)) return;
            setHexDraft(raw);
            if (raw.length === 6) onPaintChange(`#${raw.toUpperCase()}`, op);
          }}
          onBlur={() => {
            if (hexDraft.length === 6 && /^[0-9a-fA-F]{6}$/i.test(hexDraft)) {
              onPaintChange(`#${hexDraft.toUpperCase()}`, op);
            } else {
              setHexDraft(normalized.replace('#', ''));
            }
            onPaintCommit?.();
          }}
        />
        <input
          className="canvas-paint-opacity"
          type="number"
          value={op}
          aria-label="Opacidad relleno"
          onChange={(e) => onPaintChange(normalized, clampOpacity(Number(e.target.value) || 0))}
          onBlur={() => onPaintCommit?.()}
        />
        <span className="canvas-paint-pct">%</span>
        {onVisibleChange && (
          <button
            type="button"
            className="canvas-paint-icon"
            data-active={visible}
            aria-label={visible ? 'Ocultar' : 'Mostrar'}
            onClick={() => onVisibleChange(!visible)}
          >
            <VisibilityIcon visible={visible} className="h-3 w-3" />
          </button>
        )}
        <button type="button" className="canvas-paint-icon" aria-label="Quitar" onClick={onRemove}>
          <Minus className="h-3 w-3" />
        </button>
      </div>
      {open && anchor && (
        <ColorPicker
          color={normalized}
          opacity={op}
          pageColors={pageColors}
          anchor={anchor}
          onChange={onPaintChange}
          onClose={closePicker}
        />
      )}
    </>
  );
}
