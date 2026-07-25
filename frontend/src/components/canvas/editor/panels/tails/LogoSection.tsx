import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';

export default function LogoSection({ layer, logoSideConflict, setMeta }: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Logo" />
      <select
        className="canvas-input"
        value={layer.meta?.side || 'left'}
        onChange={(e) => setMeta({ side: e.target.value as 'left' | 'right' })}
        aria-label="Lado del logo"
      >
        <option value="left">Izquierdo</option>
        <option value="right">Derecho</option>
      </select>
      {logoSideConflict && (
        <p className="mt-1.5 text-[10px] leading-snug" style={{ color: 'var(--cv-text-muted)' }}>
          Otra capa usa este lado; ambas mostrarán el mismo logo.
        </p>
      )}
    </div>
  );
}
