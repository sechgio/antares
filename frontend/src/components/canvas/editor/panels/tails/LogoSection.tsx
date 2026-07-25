import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';
import CanvasSelect from '../../CanvasSelect';

export default function LogoSection({ layer, logoSideConflict, setMeta }: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Logo" />
      <CanvasSelect
        value={layer.meta?.side || 'left'}
        onChange={(val) => setMeta({ side: val as 'left' | 'right' })}
        aria-label="Lado del logo"
        options={[
          { value: 'left', label: 'Izquierdo' },
          { value: 'right', label: 'Derecho' },
        ]}
      />
      {logoSideConflict && (
        <p className="mt-1.5 text-[10px] leading-snug" style={{ color: 'var(--cv-text-muted)' }}>
          Otra capa usa este lado; ambas mostrarán el mismo logo.
        </p>
      )}
    </div>
  );
}
