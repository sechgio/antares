import { useEffect, useState, type ReactNode } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { clampImageZoom, clampOpacity, normalizeHex, parseImageZoom } from '../../ops/layerStyle';
import type { CanvasLayer } from '../../types';
import CanvasSelect from '../CanvasSelect';
import InlineNumField from '../InlineNumField';

export function HexField({
  color,
  ariaLabel,
  onCommit,
}: {
  color: string;
  ariaLabel: string;
  onCommit: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(color.replace('#', ''));
  const canonical = normalizeHex(color);
  useEffect(() => {
    setDraft(canonical.replace('#', ''));
  }, [canonical]);
  return (
    <input
      className="canvas-input flex-1 uppercase"
      aria-label={ariaLabel}
      value={draft}
      onChange={(e) => {
        const raw = e.target.value.replace('#', '').slice(0, 6);
        if (!/^[0-9a-fA-F]*$/i.test(raw)) return;
        setDraft(raw);
        if (raw.length === 6) onCommit(`#${raw.toUpperCase()}`);
      }}
      onBlur={() => {
        if (/^[0-9a-fA-F]{6}$/i.test(draft)) onCommit(`#${draft.toUpperCase()}`);
        else setDraft(color.replace('#', ''));
      }}
    />
  );
}

export function BulkOpacityField({
  value,
  onCommit,
  selectionKey,
}: {
  value: number | null | undefined;
  onCommit: (opacity: number) => void;
  selectionKey: string;
}) {
  const fallback = value === undefined ? 100 : value;
  const display = value === null ? '' : String(fallback);
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    setDraft(null);
  }, [selectionKey]);
  const shown = draft ?? display;
  return (
    <label className="canvas-prop-row mt-1">
      <span className="canvas-prop-row-label">Opacidad</span>
      <span className="canvas-prop-row-control">
        <input
          type="number"
          min={0}
          max={100}
          className="canvas-input"
          value={shown}
          placeholder={value === null ? '—' : undefined}
          aria-label="Opacidad múltiple"
          onFocus={() => setDraft(display)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => {
            setDraft(null);
            onCommit(clampOpacity(Number(e.target.value) || 0));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </span>
    </label>
  );
}

export function ZOrderButtons({
  onBringFront,
  onBringForward,
  onSendBackward,
  onSendBack,
}: {
  onBringFront: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onSendBack: () => void;
}) {
  return (
    <>
      <WithHoverTooltip label="Al frente" placement="bottom" variant="dark">
        <button type="button" className="canvas-icon-btn" aria-label="Al frente" onClick={onBringFront}>
          <ArrowUpToLine className="h-3.5 w-3.5" />
        </button>
      </WithHoverTooltip>
      <WithHoverTooltip label="Adelante" placement="bottom" variant="dark">
        <button type="button" className="canvas-icon-btn" aria-label="Adelante" onClick={onBringForward}>
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      </WithHoverTooltip>
      <WithHoverTooltip label="Atrás" placement="bottom" variant="dark">
        <button type="button" className="canvas-icon-btn" aria-label="Atrás" onClick={onSendBackward}>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </WithHoverTooltip>
      <WithHoverTooltip label="Al fondo" placement="bottom" variant="dark">
        <button type="button" className="canvas-icon-btn" aria-label="Al fondo" onClick={onSendBack}>
          <ArrowDownToLine className="h-3.5 w-3.5" />
        </button>
      </WithHoverTooltip>
    </>
  );
}

export function SectionHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="canvas-section-header">
      <div className="canvas-section-title">{title}</div>
      {children ? <div className="canvas-section-header-actions">{children}</div> : null}
    </div>
  );
}

export function PropRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="canvas-prop-row">
      <span className="canvas-prop-row-label">{label}</span>
      <div className="canvas-prop-row-control">{children}</div>
    </div>
  );
}

export const ALIGN_ITEMS = [
  { align: 'left' as const, icon: AlignStartVertical, label: 'Izquierda' },
  { align: 'center' as const, icon: AlignCenterVertical, label: 'Centro' },
  { align: 'right' as const, icon: AlignEndVertical, label: 'Derecha' },
  { align: 'top' as const, icon: AlignStartHorizontal, label: 'Arriba' },
  { align: 'middle' as const, icon: AlignCenterHorizontal, label: 'Medio' },
  { align: 'bottom' as const, icon: AlignEndHorizontal, label: 'Abajo' },
];

export const IMAGE_FIT_OPTIONS = [
  { value: 'cover', label: 'Cubrir' },
  { value: 'contain', label: 'Contener' },
  { value: 'fill', label: 'Estirar' },
];

export const IMAGE_POSITION_OPTIONS = [
  { value: '50% 50%', label: 'Centro' },
  { value: '0% 0%', label: 'Arriba izq.' },
  { value: '50% 0%', label: 'Arriba' },
  { value: '100% 0%', label: 'Arriba der.' },
  { value: '0% 50%', label: 'Izquierda' },
  { value: '100% 50%', label: 'Derecha' },
  { value: '0% 100%', label: 'Abajo izq.' },
  { value: '50% 100%', label: 'Abajo' },
  { value: '100% 100%', label: 'Abajo der.' },
];

export function ImageObjectControls({
  layer,
  setVar,
  setVarLive,
  onCommitLive,
  ariaPrefix,
}: {
  layer: CanvasLayer;
  setVar: (key: string, value: string) => void;
  setVarLive: (key: string, value: string) => void;
  onCommitLive?: () => void;
  ariaPrefix: 'imagen' | 'foto';
}) {
  return (
    <>
      <PropRow label="Ajuste">
        <CanvasSelect
          value={layer.cssVars['--object-fit'] || 'cover'}
          aria-label={`Ajuste de ${ariaPrefix}`}
          onChange={(val) => setVar('--object-fit', val)}
          options={IMAGE_FIT_OPTIONS}
        />
      </PropRow>
      <PropRow label="Zoom">
        <InlineNumField
          prefix="Z"
          value={parseImageZoom(layer.cssVars)}
          step={0.05}
          title="Zoom de recorte"
          onChange={(n) => setVarLive('--image-zoom', String(clampImageZoom(n)))}
          onCommit={onCommitLive}
        />
      </PropRow>
      <PropRow label="Posición">
        <CanvasSelect
          value={layer.cssVars['--object-position'] || '50% 50%'}
          aria-label={`Posición de ${ariaPrefix}`}
          onChange={(val) => setVar('--object-position', val)}
          options={IMAGE_POSITION_OPTIONS}
        />
      </PropRow>
    </>
  );
}
