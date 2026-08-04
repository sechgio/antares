import { useState, type ReactNode } from 'react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { ChevronDown, FolderOpen, Save, Trash2, Upload, X } from 'lucide-react';
import {
  DIAMETERS,
  LINEA_LABELS,
  LINEA_ROWS,
  VALVULA_LABELS,
  VALVULA_ROWS,
  emptyDiameterRow,
  type DiameterRow,
  type InformeV2,
  type ReservoirType,
} from './types';

interface Props {
  report: InformeV2 | null;
  hasChanges: boolean;
  busy: boolean;
  logoLeft: string | null;
  logoRight: string | null;
  photoCount: number;
  onChange: (report: InformeV2) => void;
  onSave: () => void;
  onDelete: () => void;
  onLogoChange: (side: 'left' | 'right', file: File | null) => void;
  onPhotosChange: (files: FileList | null) => void;
  onClearPhotos: () => void;
}

export default function FormPanel({
  report,
  hasChanges,
  busy,
  logoLeft,
  logoRight,
  photoCount,
  onChange,
  onSave,
  onDelete,
  onLogoChange,
  onPhotosChange,
  onClearPhotos,
}: Props) {
  if (!report) {
    return (
      <aside className="tr-panel tr-form">
        <div className="tr-empty tr-empty-large">Selecciona un informe para editar</div>
      </aside>
    );
  }

  const patch = (next: Partial<InformeV2>) => onChange({ ...report, ...next });
  const patchHeader = (key: keyof InformeV2['header'], value: string | number) => {
    patch({ header: { ...report.header, [key]: value } });
  };
  const patchMedida = (key: keyof InformeV2['medidas'], value: string) => {
    patch({ medidas: { ...report.medidas, [key]: value } });
  };
  const patchTableRow = (
    tableKey: 'valvulas' | 'linea',
    rowKey: string,
    next: DiameterRow,
  ) => {
    patch({ [tableKey]: { ...report[tableKey], [rowKey]: next } });
  };

  return (
    <aside className="tr-panel tr-form">
      <div className="tr-panel-header tr-form-header">
        <h2 className="tr-form-title">
          Informe #{report.metadata.informe_id}
          <span className={`tr-change-dot ${hasChanges ? 'dirty' : ''}`} title={hasChanges ? 'Cambios sin guardar' : 'Sin cambios'} />
        </h2>
        <div className="tr-form-actions">
          <WithHoverTooltip label={hasChanges ? 'Guardar cambios' : 'Sin cambios'} placement="bottom">
            <button type="button" className="tr-form-action" onClick={onSave} disabled={!hasChanges || busy} aria-label="Guardar">
              <Save size={14} strokeWidth={2} />
            </button>
          </WithHoverTooltip>
          <WithHoverTooltip label="Eliminar informe" placement="bottom">
            <button type="button" className="tr-form-action tr-form-action--danger" onClick={onDelete} disabled={busy} aria-label="Eliminar informe">
              <Trash2 size={14} strokeWidth={2} />
            </button>
          </WithHoverTooltip>
        </div>
      </div>

      <div className="tr-form-scroll">
        <section className="tr-section tr-section-logos">
          <div className="tr-logos-bar">
            <LogoInput side="izq" value={logoLeft} onChange={(file) => onLogoChange('left', file)} />
            <LogoInput side="der" value={logoRight} onChange={(file) => onLogoChange('right', file)} />
          </div>
        </section>

        <Section title="Fotos (mapeo por ID)" defaultOpen>
          <Field
            label="ID de imágenes"
            value={report.header.photo_id}
            onChange={(value) => patchHeader('photo_id', value)}
          />
          <p className="tr-hint" style={{ margin: '4px 0 8px', fontSize: 11, opacity: 0.75 }}>
            Archivos: {'{ID}.jpg'}, {'{ID}-1.jpg'}, {'{ID}_2.png'} · grid 3×2 (máx. 6)
          </p>
          <div className="tr-logos-bar" style={{ gap: 8 }}>
            <label className="tr-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '6px 10px' }}>
              <FolderOpen size={14} />
              Cargar fotos
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,.png,.jpg,.jpeg,.webp,.gif,.bmp"
                multiple
                className="hidden"
                onChange={(event) => {
                  onPhotosChange(event.target.files);
                  event.target.value = '';
                }}
              />
            </label>
            <button type="button" className="tr-secondary" disabled={photoCount === 0} onClick={onClearPhotos}>
              Limpiar ({photoCount})
            </button>
          </div>
        </Section>

        <Section title="Cabecera" defaultOpen>
          <Field label="Estación" value={report.header.estacion} onChange={(value) => patchHeader('estacion', value)} />
          <div className="tr-grid-2">
            <label className="tr-field">
              <span>Tipo</span>
              <select
                value={report.header.tipo}
                onChange={(event) => patchHeader('tipo', event.target.value as ReservoirType)}
              >
                {(['ELEVADO', 'ENTERRADO', 'SEMIENTERRADO', 'APOYADO', 'CISTERNA'] as const).map((tipo) => (
                  <option key={tipo} value={tipo}>{tipo}</option>
                ))}
              </select>
            </label>
            <Field label="Volumen (m³)" type="number" value={report.header.volumen} onChange={(value) => patchHeader('volumen', Number(value) || 0)} />
          </div>
          <Field label="Ubicación" value={report.header.ubicacion} onChange={(value) => patchHeader('ubicacion', value)} />
          <div className="tr-grid-2">
            <Field label="Distrito" value={report.header.distrito} onChange={(value) => patchHeader('distrito', value)} />
            <Field label="Fecha ejecución" value={report.header.fecha_ejecucion} onChange={(value) => patchHeader('fecha_ejecucion', value)} />
          </div>
          <div className="tr-grid-2">
            <Field label="Suministro" value={report.header.suministro} onChange={(value) => patchHeader('suministro', value)} />
            <Field label="SGIO" value={report.header.sgio} onChange={(value) => patchHeader('sgio', value)} />
          </div>
        </Section>

        <Section title="Válvulas">
          {VALVULA_ROWS.map((key) => (
            <DiameterRowEditor
              key={key}
              title={VALVULA_LABELS[key]}
              row={report.valvulas[key] || emptyDiameterRow()}
              onChange={(next) => patchTableRow('valvulas', key, next)}
            />
          ))}
        </Section>

        <Section title="Línea">
          {LINEA_ROWS.map((key) => (
            <DiameterRowEditor
              key={key}
              title={LINEA_LABELS[key]}
              row={report.linea[key] || emptyDiameterRow()}
              onChange={(next) => patchTableRow('linea', key, next)}
            />
          ))}
        </Section>

        <Section title="Medidas" defaultOpen>
          <div className="tr-grid-2">
            <Field label="Largo (M)" value={report.medidas.largo} onChange={(value) => patchMedida('largo', value)} />
            <Field label="Altura rebose (M)" value={report.medidas.altura_rebose} onChange={(value) => patchMedida('altura_rebose', value)} />
            <Field label="Ancho (M)" value={report.medidas.ancho} onChange={(value) => patchMedida('ancho', value)} />
            <Field label="Altura total (M)" value={report.medidas.altura_total} onChange={(value) => patchMedida('altura_total', value)} />
            <Field label="Diámetro (M)" value={report.medidas.diametro} onChange={(value) => patchMedida('diametro', value)} />
            <Field label="Tirante limpieza (M)" value={report.medidas.tirante_limpieza} onChange={(value) => patchMedida('tirante_limpieza', value)} />
          </div>
          <Field label="Observación" value={report.medidas.observacion} onChange={(value) => patchMedida('observacion', value)} />
        </Section>
      </div>
    </aside>
  );
}

function DiameterRowEditor({
  title,
  row,
  onChange,
}: {
  title: string;
  row: DiameterRow;
  onChange: (row: DiameterRow) => void;
}) {
  return (
    <div className="tr-section" style={{ padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
      <strong style={{ fontSize: 12 }}>{title}</strong>
      <div className="tr-grid-4" style={{ marginTop: 6 }}>
        {DIAMETERS.map((d) => (
          <Field
            key={d}
            label={`${d}"`}
            type="number"
            value={row.diametros[d] || 0}
            onChange={(value) => onChange({
              ...row,
              diametros: { ...row.diametros, [d]: Number(value) || 0 },
            })}
          />
        ))}
      </div>
      <div className="tr-grid-2" style={{ marginTop: 6 }}>
        <Field label="OPER." type="number" value={row.oper} onChange={(value) => onChange({ ...row, oper: Number(value) || 0 })} />
        <Field label="NO OP." type="number" value={row.no_op} onChange={(value) => onChange({ ...row, no_op: Number(value) || 0 })} />
      </div>
      <Field label="Observaciones" value={row.observaciones} onChange={(value) => onChange({ ...row, observaciones: value })} />
    </div>
  );
}

function Section({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
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

function Field({
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
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function LogoInput({
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
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,.png,.jpg,.jpeg,.webp,.gif,.bmp"
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
