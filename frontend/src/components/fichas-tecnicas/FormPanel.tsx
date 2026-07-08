import { Save, Trash2, Upload, X } from 'lucide-react';
import {
  normalizeFicha,
  type FichaTecnica,
  type ProductoQuimico,
  type SatisfaccionType,
  type ServicioEfectuar,
  type TiposTratamiento,
} from './types';

interface Props {
  ficha: FichaTecnica | null;
  hasChanges: boolean;
  busy: boolean;
  logoLeft: string | null;
  onChange: (ficha: FichaTecnica) => void;
  onSave: () => void;
  onDelete: () => void;
  onLogoChange: (file: File | null) => void;
}

function LogoSlot({
  url,
  onLogoChange,
}: {
  url: string | null;
  onLogoChange: (file: File | null) => void;
}) {
  return (
    <div className={`tr-logo-chip${url ? ' tr-logo-chip--filled' : ''}`}>
      <label className="tr-logo-chip-hit" title={url ? 'Cambiar logo' : 'Subir logo'}>
        <span className={`tr-logo-chip-thumb${url ? '' : ' tr-logo-chip-thumb--empty'}`}>
          {url ? <img src={url} alt="" /> : <Upload size={13} strokeWidth={2} />}
        </span>
        <span className="tr-logo-chip-meta">
          <span className="tr-logo-chip-label">Logo</span>
          <span className="tr-logo-chip-hint">{url ? 'Clic para cambiar' : 'PNG · JPG · WebP'}</span>
        </span>
        <input
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0] || null;
            event.target.value = '';
            onLogoChange(file);
          }}
        />
      </label>
      {url && (
        <button
          type="button"
          className="tr-logo-chip-clear"
          onClick={() => onLogoChange(null)}
          title="Quitar logo"
          aria-label="Quitar logo"
        >
          <X size={12} strokeWidth={2.25} />
        </button>
      )}
    </div>
  );
}

const SERVICIO_OPTIONS: Array<[keyof ServicioEfectuar, string]> = [
  ['desinfeccion', 'Desinfección'],
  ['limpieza_ambientes', 'Limpieza de ambientes'],
  ['limpieza_pozos_septicos', 'Limpieza de pozos sépticos'],
  ['limpieza_reservorios', 'Limpieza y desinfección de reservorios'],
];

const TRATAMIENTO_OPTIONS: Array<[Exclude<keyof TiposTratamiento, 'otros'>, string]> = [
  ['pulverizado', 'Pulverizado'],
  ['atomizado', 'Atomizado'],
  ['thermonebulizado', 'Thermonebulizado'],
  ['nebulizado_ulv', 'Nebulizado ULV'],
];

const SATISFACCION_OPTIONS: Array<{ value: SatisfaccionType; label: string; emoji: string }> = [
  { value: 'muy_satisfecho', label: 'Muy Satisfecho', emoji: '😊' },
  { value: 'satisfecho', label: 'Satisfecho', emoji: '🙂' },
  { value: 'regular', label: 'Regular', emoji: '😐' },
  { value: 'insatisfecho', label: 'Insatisfecho', emoji: '🙁' },
];

export default function FormPanel({
  ficha,
  hasChanges,
  busy,
  logoLeft,
  onChange,
  onSave,
  onDelete,
  onLogoChange,
}: Props) {
  if (!ficha) {
    return (
      <aside className="tr-panel tr-form">
        <div className="tr-panel-header">
          <div>
            <p className="tr-eyebrow">Editor</p>
            <h2>Plantilla</h2>
          </div>
        </div>
        <div className="tr-form-scroll">
          <section className="tr-section tr-section-logos">
            <LogoSlot url={logoLeft} onLogoChange={onLogoChange} />
          </section>
          <div className="tr-empty" style={{ minHeight: 160 }}>
            Selecciona una ficha o pulsa <strong>Nuevo</strong> para editar.
            <br />
            El centro muestra la plantilla A4; <strong>PDF</strong> exporta la plantilla en blanco.
          </div>
        </div>
      </aside>
    );
  }

  // Drafts / partial IPC payloads can omit nested objects — normalize before render.
  const safe = normalizeFicha(ficha);

  const patch = (next: Partial<FichaTecnica>) => onChange(normalizeFicha({ ...safe, ...next }));
  const patchServicio = (key: keyof ServicioEfectuar, value: boolean) =>
    patch({ servicio: { ...safe.servicio, [key]: value } });
  const patchTratamiento = (key: keyof TiposTratamiento, value: boolean | string) =>
    patch({ tratamiento: { ...safe.tratamiento, [key]: value } });
  const patchObs = (key: keyof FichaTecnica['obs_rec'], value: string) =>
    patch({ obs_rec: { ...safe.obs_rec, [key]: value } });
  const patchProducto = (index: number, field: keyof ProductoQuimico, value: string) => {
    const productos = safe.productos.map((prod, i) => (i === index ? { ...prod, [field]: value } : prod));
    patch({ productos });
  };
  const patchPersonal = (index: number, value: string) => {
    const personal = [...safe.personal_tecnico];
    while (personal.length < 6) personal.push('');
    personal[index] = value;
    patch({ personal_tecnico: personal.slice(0, 6) });
  };

  return (
    <aside className="tr-panel tr-form">
      <div className="tr-panel-header">
        <div>
          <p className="tr-eyebrow">Editor</p>
          <h2>{safe.os_numero || safe.id}</h2>
        </div>
        <div className="tr-header-actions">
          <span className={`tr-change-dot ${hasChanges ? 'dirty' : ''}`} title={hasChanges ? 'Cambios sin guardar' : 'Sin cambios'} />
          <button type="button" className="tr-primary" disabled={!hasChanges || busy} onClick={onSave}>
            <Save size={14} />
            Guardar
          </button>
          <button type="button" className="tr-danger tr-icon-button" disabled={busy} onClick={onDelete} title="Eliminar ficha">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="tr-form-scroll">
        <section className="tr-section tr-section-logos">
          <LogoSlot url={logoLeft} onLogoChange={onLogoChange} />
        </section>

        <section className="tr-section">
          <h3>Información general</h3>
          <div className="tr-grid-2">
            <label className="tr-field">
              <span>O.S. N°</span>
              <input value={safe.os_numero} onChange={(e) => patch({ os_numero: e.target.value })} />
            </label>
            <label className="tr-field">
              <span>Fecha</span>
              <input value={safe.fecha} onChange={(e) => patch({ fecha: e.target.value })} placeholder="YYYY-MM-DD" />
            </label>
            <label className="tr-field" style={{ gridColumn: '1 / -1' }}>
              <span>Cliente</span>
              <input value={safe.cliente} onChange={(e) => patch({ cliente: e.target.value })} />
            </label>
            <label className="tr-field" style={{ gridColumn: '1 / -1' }}>
              <span>Dirección</span>
              <input value={safe.direccion} onChange={(e) => patch({ direccion: e.target.value })} />
            </label>
            <label className="tr-field">
              <span>Distrito</span>
              <input value={safe.distrito} onChange={(e) => patch({ distrito: e.target.value })} />
            </label>
            <label className="tr-field">
              <span>Estado</span>
              <select
                value={safe.status}
                onChange={(e) => patch({ status: e.target.value as FichaTecnica['status'] })}
              >
                <option value="draft">Borrador</option>
                <option value="completed">Completado</option>
              </select>
            </label>
          </div>
        </section>

        <section className="tr-section">
          <h3>Servicio a efectuar</h3>
          <div className="tr-check-grid">
            {SERVICIO_OPTIONS.map(([key, label]) => (
              <label key={key} className="tr-check-item">
                <input
                  type="checkbox"
                  checked={Boolean(safe.servicio[key])}
                  onChange={(e) => patchServicio(key, e.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="tr-section">
          <h3>Diagnóstico del área</h3>
          <label className="tr-field">
            <textarea
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 text-xs text-[var(--text-primary)]"
              rows={3}
              value={safe.diagnostico_area}
              onChange={(e) => patch({ diagnostico_area: e.target.value })}
            />
          </label>
        </section>

        <section className="tr-section">
          <h3>Condición sanitaria</h3>
          <label className="tr-field">
            <textarea
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 text-xs text-[var(--text-primary)]"
              rows={2}
              value={safe.condicion_sanitaria}
              onChange={(e) => patch({ condicion_sanitaria: e.target.value })}
            />
          </label>
        </section>

        <section className="tr-section">
          <h3>Tipos de tratamiento</h3>
          <div className="tr-check-grid">
            {TRATAMIENTO_OPTIONS.map(([key, label]) => (
              <label key={key} className="tr-check-item">
                <input
                  type="checkbox"
                  checked={Boolean(safe.tratamiento[key])}
                  onChange={(e) => patchTratamiento(key, e.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <label className="tr-field">
            <span>Otros</span>
            <input value={safe.tratamiento.otros} onChange={(e) => patchTratamiento('otros', e.target.value)} />
          </label>
        </section>

        <section className="tr-section">
          <h3>Productos químicos / biológicos</h3>
          {safe.productos.map((prod, idx) => (
            <div key={idx} className="tr-inspection-row">
              <span>Producto {idx + 1}</span>
              <div className="tr-grid-2">
                {(
                  [
                    ['producto', 'Producto'],
                    ['composicion', 'Composición'],
                    ['lote', 'Lote'],
                    ['fecha_vencimiento', 'Vencimiento'],
                    ['unidad', 'Unidad'],
                    ['concentracion', 'Concentración'],
                    ['cantidad', 'Cantidad'],
                  ] as Array<[keyof ProductoQuimico, string]>
                ).map(([field, label]) => (
                  <label key={field} className="tr-field">
                    <span>{label}</span>
                    <input value={prod[field]} onChange={(e) => patchProducto(idx, field, e.target.value)} />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="tr-section">
          <h3>Acciones correctivas</h3>
          <textarea
            className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 text-xs text-[var(--text-primary)]"
            rows={2}
            value={safe.acciones_correctivas}
            onChange={(e) => patch({ acciones_correctivas: e.target.value })}
          />
        </section>

        <section className="tr-section">
          <h3>Áreas tratadas</h3>
          <textarea
            className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 text-xs text-[var(--text-primary)]"
            rows={2}
            value={safe.areas_tratadas}
            onChange={(e) => patch({ areas_tratadas: e.target.value })}
          />
        </section>

        <section className="tr-section">
          <h3>Personal técnico</h3>
          <div className="tr-grid-2">
            {Array.from({ length: 6 }, (_, idx) => (
              <label key={idx} className="tr-field">
                <span>Técnico {idx + 1}</span>
                <input
                  value={safe.personal_tecnico[idx] || ''}
                  onChange={(e) => patchPersonal(idx, e.target.value)}
                />
              </label>
            ))}
          </div>
          <div className="tr-grid-2">
            <label className="tr-field">
              <span>Hora inicio</span>
              <input value={safe.hora_inicio} onChange={(e) => patch({ hora_inicio: e.target.value })} />
            </label>
            <label className="tr-field">
              <span>Hora término</span>
              <input value={safe.hora_termino} onChange={(e) => patch({ hora_termino: e.target.value })} />
            </label>
            <label className="tr-field" style={{ gridColumn: '1 / -1' }}>
              <span>N° certificado</span>
              <input value={safe.numero_certificado} onChange={(e) => patch({ numero_certificado: e.target.value })} />
            </label>
          </div>
        </section>

        <section className="tr-section">
          <h3>Observaciones y recomendaciones</h3>
          <div className="tr-grid-2">
            <div className="tr-field">
              <span>Observaciones</span>
              {(['a', 'b', 'c'] as const).map((letter) => (
                <label key={`obs-${letter}`} className="tr-field" style={{ marginTop: 6 }}>
                  <span>{letter})</span>
                  <input
                    value={safe.obs_rec[`observacion_${letter}`]}
                    onChange={(e) => patchObs(`observacion_${letter}`, e.target.value)}
                  />
                </label>
              ))}
            </div>
            <div className="tr-field">
              <span>Recomendaciones</span>
              {(['a', 'b', 'c'] as const).map((letter) => (
                <label key={`rec-${letter}`} className="tr-field" style={{ marginTop: 6 }}>
                  <span>{letter})</span>
                  <input
                    value={safe.obs_rec[`recomendacion_${letter}`]}
                    onChange={(e) => patchObs(`recomendacion_${letter}`, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="tr-section">
          <h3>Satisfacción del cliente</h3>
          <div className="tr-grid-2">
            {SATISFACCION_OPTIONS.map(({ value, label, emoji }) => (
              <label
                key={value}
                className="tr-field"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: 8,
                  borderRadius: 7,
                  border: safe.satisfaccion === value ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                  background: safe.satisfaccion === value ? 'var(--bg-elevated)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="satisfaccion"
                  checked={safe.satisfaccion === value}
                  onChange={() => patch({ satisfaccion: value })}
                />
                <span style={{ fontSize: 18 }}>{emoji}</span>
                <span style={{ textTransform: 'none', fontWeight: 600 }}>{label}</span>
              </label>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
