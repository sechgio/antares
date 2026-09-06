import { useState, type ReactNode } from 'react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { ChevronDown, Upload, X } from 'lucide-react';

const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,.png,.jpg,.jpeg,.webp,.gif,.bmp';

export function LogoInput({
  side,
  value,
  onChange,
}: {
  side: 'izq' | 'der';
  value: string | null;
  onChange: (file: File | null) => void;
}) {
  const title = side === 'izq' ? 'Logo izquierdo' : 'Logo derecho';
  return (
    <div className={`tr-logo-chip${value ? ' tr-logo-chip--filled' : ''}`}>
      <WithHoverTooltip label={value ? `Cambiar ${title.toLowerCase()}` : `Subir ${title.toLowerCase()}`} placement="bottom">
        <label className="tr-logo-chip-hit">
          <span className={`tr-logo-chip-thumb${value ? '' : ' tr-logo-chip-thumb--empty'}`}>
            {value ? <img src={value} alt={title} /> : <Upload size={13} strokeWidth={2} />}
          </span>
          <span className="tr-logo-chip-meta">
            <span className="tr-logo-chip-label">Logo {side}</span>
            <span className="tr-logo-chip-hint">{value ? 'Clic para cambiar' : 'PNG · JPG · WebP'}</span>
          </span>
          <input
            type="file"
            accept={LOGO_ACCEPT}
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              event.target.value = '';
              onChange(file);
            }}
          />
        </label>
      </WithHoverTooltip>
      {value && (
        <WithHoverTooltip label={`Quitar ${title.toLowerCase()}`} placement="bottom">
          <button
            type="button"
            className="tr-logo-chip-clear"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            aria-label={`Quitar ${title.toLowerCase()}`}
          >
            <X size={12} strokeWidth={2.25} />
          </button>
        </WithHoverTooltip>
      )}
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="tr-field">
      <span>{label}</span>
      <input type={type} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function Section({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`tr-section tr-collapsible${open ? ' tr-collapsible--open' : ''}`}>
      <button type="button" className="tr-section-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <h3>{title}</h3>
        <ChevronDown size={13} strokeWidth={2.25} className="tr-section-chevron" />
      </button>
      <div className="tr-section-body" aria-hidden={!open}>
        <div className="tr-section-inner">{children}</div>
      </div>
    </section>
  );
}
