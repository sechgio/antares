import { Save, Trash2, Upload, X } from 'lucide-react';
import type { CanastillasData, CheckState, InspeccionDescripcion, TechnicalReport, ValvulasData } from './types';

const INSPECTION_ROWS: Array<[keyof InspeccionDescripcion, string, string, string]> = [
  ['caja_registro', 'Caja de registro', 'observaciones_caja_registro', 'sugerencias_caja_registro'],
  ['marco_tapa', 'Marco y tapa sanitaria', 'observaciones_marco_tapa', 'sugerencias_marco_tapa'],
  ['escalera_interior', 'Escalera interior', 'observaciones_escalera_int', 'sugerencias_escalera_int'],
  ['escalera_exterior', 'Escalera exterior', 'observaciones_escalera_ext', 'sugerencias_escalera_ext'],
  ['cuba_interior', 'Cuba interior', 'observaciones_cuba_int', 'sugerencias_cuba_int'],
  ['cuba_exterior', 'Cuba exterior', 'observaciones_cuba_ext', 'sugerencias_cuba_ext'],
  ['loza_fondo', 'Loza de fondo', 'observaciones_loza_fondo', 'sugerencias_loza_fondo'],
  ['loza_techo_interior', 'Loza techo interior', 'observaciones_loza_techo_int', 'sugerencias_loza_techo_int'],
  ['loza_techo_exterior', 'Loza techo exterior', 'observaciones_loza_techo_ext', 'sugerencias_loza_techo_ext'],
  ['ducto_ventilacion', 'Ducto ventilación', 'observaciones_ducto', 'sugerencias_ducto'],
  ['cerco_perimetrico', 'Cerco perimétrico', 'observaciones_cerco', 'sugerencias_cerco'],
  ['descarga', 'Descarga', 'observaciones_descarga', 'sugerencias_descarga'],
];

const VALVE_SECTIONS: Array<[keyof ValvulasData, string, string]> = [
  ['diametros', 'Conducción', 'conduccion'],
  ['impulsion', 'Impulsión', 'impulsion'],
  ['aduccion', 'Aducción', 'aduccion'],
  ['bypass', 'By pass', 'bypass'],
  ['desague', 'Desagüe', 'desague'],
];

const BASKET_SECTIONS: Array<[keyof CanastillasData, string]> = [
  ['aduccion', 'Aducción'],
  ['succion', 'Succión'],
  ['desague', 'Desagüe'],
];

interface Props {
  report: TechnicalReport | null;
  hasChanges: boolean;
  busy: boolean;
  logoLeft: string | null;
  logoRight: string | null;
  onChange: (report: TechnicalReport) => void;
  onSave: () => void;
  onDelete: () => void;
  onLogoChange: (side: 'left' | 'right', file: File | null) => void;
}

export default function FormPanel({ report, hasChanges, busy, logoLeft, logoRight, onChange, onSave, onDelete, onLogoChange }: Props) {
  if (!report) {
    return (
      <aside className="tr-panel tr-form">
        <div className="tr-empty tr-empty-large">Selecciona un informe para editar</div>
      </aside>
    );
  }

  const patch = (next: Partial<TechnicalReport>) => onChange({ ...report, ...next });
  const patchHeader = (key: keyof TechnicalReport['header'], value: string | number) => {
    patch({ header: { ...report.header, [key]: value } });
  };
  const patchMetadata = (key: keyof TechnicalReport['metadata'], value: string | number) => {
    patch({ metadata: { ...report.metadata, [key]: value } });
  };
  const patchInspection = (key: string, value: string) => {
    patch({ inspeccion: { ...report.inspeccion, [key]: value } });
  };

  return (
    <aside className="tr-panel tr-form">
      <div className="tr-panel-header">
        <div>
          <p className="tr-eyebrow">Editor</p>
          <h2>Informe #{report.metadata.informe_id}</h2>
        </div>
        <span className={`tr-change-dot ${hasChanges ? 'dirty' : ''}`} />
      </div>

      <div className="tr-form-actions">
        <button className="tr-primary" onClick={onSave} disabled={!hasChanges || busy}>
          <Save size={15} />
          Guardar
        </button>
        <button className="tr-danger tr-icon-button" onClick={onDelete} disabled={busy} aria-label="Eliminar informe" title="Eliminar informe">
          <Trash2 size={15} />
        </button>
      </div>

      <div className="tr-form-scroll">
        <section className="tr-section">
          <h3>Logos</h3>
          <div className="tr-logo-grid">
            <LogoInput label="Izquierdo" value={logoLeft} onChange={(file) => onLogoChange('left', file)} />
            <LogoInput label="Derecho" value={logoRight} onChange={(file) => onLogoChange('right', file)} />
          </div>
        </section>

        <section className="tr-section">
          <h3>Metadata</h3>
          <div className="tr-grid-4">
            <Field label="Informe" type="number" value={report.metadata.informe_id} onChange={(value) => patchMetadata('informe_id', Number(value) || 0)} />
            <Field label="Día" type="number" value={report.metadata.dia} onChange={(value) => patchMetadata('dia', Number(value) || 1)} />
            <Field label="Mes" value={report.metadata.mes} onChange={(value) => patchMetadata('mes', value.toUpperCase())} />
            <Field label="Año" type="number" value={report.metadata.anio} onChange={(value) => patchMetadata('anio', Number(value) || new Date().getFullYear())} />
          </div>
        </section>

        <section className="tr-section">
          <h3>Cabecera</h3>
          <Field label="C.S." value={report.header.cs} onChange={(value) => patchHeader('cs', value)} />
          <Field label="Contratista" value={report.header.contratista} onChange={(value) => patchHeader('contratista', value)} />
          <Field label="Código infraestructura" value={report.header.codigo_infraestructura} onChange={(value) => patchHeader('codigo_infraestructura', value)} />
          <Field label="Ubicación" value={report.header.ubicacion} onChange={(value) => patchHeader('ubicacion', value)} />
          <div className="tr-grid-2">
            <Field label="Suministro" value={report.header.suministro} onChange={(value) => patchHeader('suministro', value)} />
            <Field label="Volumen" type="number" value={report.header.volumen} onChange={(value) => patchHeader('volumen', Number(value) || 0)} />
          </div>
          <label className="tr-field">
            <span>Tipo</span>
            <select value={report.header.tipo} onChange={(event) => patchHeader('tipo', event.target.value)}>
              <option value="ELEVADO">ELEVADO</option>
              <option value="ENTERRADO">ENTERRADO</option>
              <option value="SEMIENTERRADO">SEMIENTERRADO</option>
              <option value="APOYADO">APOYADO</option>
              <option value="CISTERNA">CISTERNA</option>
            </select>
          </label>
        </section>

        <section className="tr-section">
          <h3>Inspección</h3>
          {INSPECTION_ROWS.map(([key, label, obsKey, sugKey]) => (
            <div className="tr-inspection-row" key={String(key)}>
              <div>
                <strong>{label}</strong>
                <div className="tr-segment">
                  {(['unchecked', 'normal', 'critico'] as CheckState[]).map((state) => (
                    <button
                      key={state}
                      className={report.inspeccion[key] === state ? 'active' : ''}
                      onClick={() => patchInspection(String(key), state)}
                      type="button"
                    >
                      {state === 'unchecked' ? '-' : state === 'normal' ? 'Normal' : 'Crítico'}
                    </button>
                  ))}
                </div>
              </div>
              <Field label="Obs." value={String(report.inspeccion[obsKey] || '')} onChange={(value) => patchInspection(obsKey, value)} />
              <Field label="Sug." value={String(report.inspeccion[sugKey] || '')} onChange={(value) => patchInspection(sugKey, value)} />
            </div>
          ))}
        </section>

        <section className="tr-section">
          <h3>Válvulas</h3>
          <DiameterEditor
            diameters={['2', '3', '4', '6', '8', '10', '12']}
            sections={VALVE_SECTIONS}
            data={report.valvulas}
            onChange={(valvulas) => patch({ valvulas })}
          />
        </section>

        <section className="tr-section">
          <h3>Canastillas</h3>
          <DiameterEditor
            diameters={['2', '3', '4', '6', '8', '10', '14']}
            sections={BASKET_SECTIONS.map(([key, label]) => [key, label, key] as [keyof CanastillasData, string, string])}
            data={report.canastillas}
            onChange={(canastillas) => patch({ canastillas })}
          />
        </section>

        <section className="tr-section">
          <h3>Medidas</h3>
          <div className="tr-grid-2">
            {(['diametro', 'diametro_interno', 'altura_util', 'altura_total'] as const).map((key) => (
              <Field
                key={key}
                label={key.replace(/_/g, ' ')}
                value={report.medidas[key]}
                onChange={(value) => patch({ medidas: { ...report.medidas, [key]: value } })}
              />
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}

function LogoInput({ label, value, onChange }: { label: string; value: string | null; onChange: (file: File | null) => void }) {
  return (
    <div className="tr-logo-box">
      <label className="tr-logo-input">
        <input type="file" accept="image/*" onChange={(event) => onChange(event.target.files?.[0] || null)} />
        {value ? (
          <img src={value} alt={`Logo ${label}`} />
        ) : (
          <div className="tr-logo-placeholder">
            <Upload size={18} />
            <span>{label}</span>
          </div>
        )}
      </label>
      {value && (
        <button
          type="button"
          className="tr-logo-clear"
          onClick={(e) => {
            e.stopPropagation();
            onChange(null);
          }}
          title="Quitar logo"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function Field({ label, value, type = 'text', onChange }: { label: string; value: string | number; type?: string; onChange: (value: string) => void }) {
  return (
    <label className="tr-field">
      <span>{label}</span>
      <input type={type} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function DiameterEditor<T extends ValvulasData | CanastillasData>({
  diameters,
  sections,
  data,
  onChange,
}: {
  diameters: string[];
  sections: Array<[keyof T, string, string]>;
  data: T;
  onChange: (data: T) => void;
}) {
  const updateDiameter = (section: keyof T, diameter: string, value: string) => {
    const sectionData = data[section] as Record<string, number>;
    onChange({
      ...data,
      [section]: { ...sectionData, [diameter]: Number(value) || 0 },
    });
  };

  const updateText = (field: string, value: string) => {
    onChange({ ...data, [field]: value });
  };

  return (
    <div className="tr-diameter-editor">
      {sections.map(([section, label, textKey]) => (
        <div className="tr-diameter-row" key={String(section)}>
          <strong>{label}</strong>
          <div className="tr-diameter-grid">
            {diameters.map((diameter) => (
              <label key={diameter}>
                <span>{diameter}"</span>
                <input
                  type="number"
                  value={((data[section] as Record<string, number>)?.[diameter]) || 0}
                  onChange={(event) => updateDiameter(section, diameter, event.target.value)}
                />
              </label>
            ))}
          </div>
          <div className="tr-grid-2">
            <Field label="Obs." value={String(data[`observaciones_${textKey}`] || '')} onChange={(value) => updateText(`observaciones_${textKey}`, value)} />
            <Field label="Sug." value={String(data[`sugerencias_${textKey}`] || '')} onChange={(value) => updateText(`sugerencias_${textKey}`, value)} />
          </div>
        </div>
      ))}
      <div className="tr-grid-2">
        <Field label="Operativas" type="number" value={Number(data.operativas) || 0} onChange={(value) => onChange({ ...data, operativas: Number(value) || 0 })} />
        <Field label="No operativas" type="number" value={Number(data.no_operativas) || 0} onChange={(value) => onChange({ ...data, no_operativas: Number(value) || 0 })} />
      </div>
    </div>
  );
}
