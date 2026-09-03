import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
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
    <div className={`tr-logo-chip ft-logo-toolbar${url ? ' tr-logo-chip--filled' : ''}`}>
      <WithHoverTooltip label={url ? 'Cambiar logo' : 'Subir logo'} placement="bottom">
        <label className="tr-logo-chip-hit">
          <span className={`tr-logo-chip-thumb${url ? '' : ' tr-logo-chip-thumb--empty'}`}>
            {url ? <img src={url} alt="" /> : <Upload size={12} strokeWidth={2} />}
          </span>
          <span className="tr-logo-chip-meta">
            <span className="tr-logo-chip-label">Logo</span>
            <span className="tr-logo-chip-hint">{url ? 'Cambiar' : 'PNG · JPG · WebP'}</span>
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
      </WithHoverTooltip>
      {url && (
        <WithHoverTooltip label="Quitar logo" placement="bottom">
          <button
            type="button"
            className="tr-logo-chip-clear"
            onClick={() => onLogoChange(null)}
            aria-label="Quitar logo"
          >
            <X size={11} strokeWidth={2.25} />
          </button>
        </WithHoverTooltip>
      )}
    </div>
  );
}

function FormHeaderActions({
  logoLeft,
  onLogoChange,
  hasChanges,
  busy,
  onSave,
  onDelete,
  showSave,
}: {
  logoLeft: string | null;
  onLogoChange: (file: File | null) => void;
  hasChanges?: boolean;
  busy?: boolean;
  onSave?: () => void;
  onDelete?: () => void;
  showSave: boolean;
}) {
  return (
    <div className="tr-header-actions ft-form-actions">
      <LogoSlot url={logoLeft} onLogoChange={onLogoChange} />
      {showSave && (
        <>
          <button type="button" className="tr-primary" disabled={!hasChanges || busy} onClick={onSave}>
            <Save size={13} />
            Guardar
          </button>
          <WithHoverTooltip label="Eliminar" placement="left">
            <button type="button" className="tr-danger tr-icon-button" disabled={busy} onClick={onDelete}>
              <Trash2 size={13} />
            </button>
          </WithHoverTooltip>
        </>
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
  { value: 'muy_satisfecho', label: 'Muy satisfecho', emoji: '😊' },
  { value: 'satisfecho', label: 'Satisfecho', emoji: '🙂' },
  { value: 'regular', label: 'Regular', emoji: '😐' },
  { value: 'insatisfecho', label: 'Insatisfecho', emoji: '🙁' },
];

const PRODUCTO_FIELDS: Array<[keyof ProductoQuimico, string]> = [
  ['producto', 'Producto'],
  ['composicion', 'Composición'],
  ['lote', 'Lote'],
  ['fecha_vencimiento', 'Vencimiento'],
  ['unidad', 'Unidad'],
  ['concentracion', 'Concentración'],
  ['cantidad', 'Cantidad'],
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
      <aside className="tr-panel tr-form ft-form">
        <div className="tr-panel-header ft-form-header">
          <div className="ft-form-brand">
            <p className="tr-eyebrow">Editor</p>
            <h2>Plantilla</h2>
          </div>
          <FormHeaderActions logoLeft={logoLeft} onLogoChange={onLogoChange} showSave={false} />
        </div>
        <div className="tr-form-scroll">
          <div className="tr-empty ft-form-empty">
            Selecciona una ficha o pulsa <strong>Nuevo</strong> para editar.
          </div>
        </div>
      </aside>
    );
  }

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
    <aside className="tr-panel tr-form ft-form">
      <div className="tr-panel-header ft-form-header">
        <div className="ft-form-brand">
          <p className="tr-eyebrow">Editor</p>
          <h2 className="tabular-nums">{safe.os_numero || safe.id}</h2>
        </div>
        <FormHeaderActions
          logoLeft={logoLeft}
          onLogoChange={onLogoChange}
          hasChanges={hasChanges}
          busy={busy}
          onSave={onSave}
          onDelete={onDelete}
          showSave
        />
      </div>

      <div className="tr-form-scroll">
        <section className="tr-section">
          <h3>Información general</h3>
          <div className="tr-grid-2">
            <label className="tr-field">
              <span>O.S. N°</span>
              <input value={safe.os_numero} onChange={(e) => patch({ os_numero: e.target.value })} />
            </label>
            <label className="tr-field">
              <span>Fecha</span>
              <input
                value={safe.fecha}
                onChange={(e) => patch({ fecha: e.target.value })}
                placeholder="YYYY-MM-DD"
              />
            </label>
            <label className="tr-field ft-span-full">
              <span>Cliente</span>
              <input value={safe.cliente} onChange={(e) => patch({ cliente: e.target.value })} />
            </label>
            <label className="tr-field ft-span-full">
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
          <textarea
            className="ft-textarea"
            rows={2}
            value={safe.diagnostico_area}
            onChange={(e) => patch({ diagnostico_area: e.target.value })}
          />
        </section>

        <section className="tr-section">
          <h3>Condición sanitaria</h3>
          <textarea
            className="ft-textarea"
            rows={2}
            value={safe.condicion_sanitaria}
            onChange={(e) => patch({ condicion_sanitaria: e.target.value })}
          />
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
            <div key={idx} className="tr-inspection-row ft-product-row">
              <span className="ft-product-label">Producto {idx + 1}</span>
              <div className="tr-grid-2">
                {PRODUCTO_FIELDS.map(([field, label]) => (
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
            className="ft-textarea"
            rows={2}
            value={safe.acciones_correctivas}
            onChange={(e) => patch({ acciones_correctivas: e.target.value })}
          />
        </section>

        <section className="tr-section">
          <h3>Áreas tratadas</h3>
          <textarea
            className="ft-textarea"
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
            <label className="tr-field ft-span-full">
              <span>N° certificado</span>
              <input
                value={safe.numero_certificado}
                onChange={(e) => patch({ numero_certificado: e.target.value })}
              />
            </label>
          </div>
        </section>

        <section className="tr-section">
          <h3>Observaciones y recomendaciones</h3>
          <div className="tr-grid-2">
            <div className="ft-obs-col">
              <span className="ft-obs-heading">Observaciones</span>
              {(['a', 'b', 'c'] as const).map((letter) => (
                <label key={`obs-${letter}`} className="tr-field">
                  <span>{letter})</span>
                  <input
                    value={safe.obs_rec[`observacion_${letter}`]}
                    onChange={(e) => patchObs(`observacion_${letter}`, e.target.value)}
                  />
                </label>
              ))}
            </div>
            <div className="ft-obs-col">
              <span className="ft-obs-heading">Recomendaciones</span>
              {(['a', 'b', 'c'] as const).map((letter) => (
                <label key={`rec-${letter}`} className="tr-field">
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
          <div className="ft-sat-grid">
            {SATISFACCION_OPTIONS.map(({ value, label, emoji }) => {
              const active = safe.satisfaccion === value;
              return (
                <label key={value} className={`ft-sat-option${active ? ' is-active' : ''}`}>
                  <input
                    type="radio"
                    name="satisfaccion"
                    checked={active}
                    onChange={() => patch({ satisfaccion: value })}
                  />
                  <span className="ft-sat-emoji" aria-hidden="true">
                    {emoji}
                  </span>
                  <span className="ft-sat-label">{label}</span>
                </label>
              );
            })}
          </div>
        </section>
      </div>
    </aside>
  );
}
