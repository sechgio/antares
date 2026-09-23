import Button from '../ui/Button';
import { Field, Section } from '../technical-reports/trFormControls';
import {
  R2_CANASTILLA_DIAMETERS,
  R2_CANASTILLA_LABELS,
  R2_CANASTILLA_ROWS,
  R2_INSPECCION_ITEMS,
  R2_VALVULA_DIAMETERS,
  R2_VALVULA_LABELS,
  R2_VALVULA_ROWS,
  emptyInspeccionRow,
  emptyR2Row,
  type InspeccionRow,
  type Reservorios2Data,
  type Reservorios2Medidas,
  type Reservorios2Row,
} from './types';

type CheckState = 'unchecked' | 'normal' | 'critico';

const MEDIDA_FIELDS = [
  ['etiqueta_diametro', 'diametro', 'Texto de diámetro', 'DIAMETRO'],
  ['etiqueta_altura_util', 'altura_util', 'Texto de altura útil', 'ALTURA UTIL'],
  ['etiqueta_diametro_interno', 'diametro_interno', 'Texto de diámetro interno', 'DIAMETRO INTERNO'],
  ['etiqueta_altura_total', 'altura_total', 'Texto de altura total', 'ALTURA TOTAL'],
] as const;

interface Props {
  data: Reservorios2Data;
  onChange: (data: Reservorios2Data) => void;
}

export default function Reservorios2Form({ data, onChange }: Props) {
  const markedCount = R2_INSPECCION_ITEMS.filter((item) => {
    const row = data.inspeccion[item.key];
    return Boolean(row?.normal || row?.critico);
  }).length;

  const patchInspeccion = (key: string, next: Partial<InspeccionRow>) => {
    onChange({
      ...data,
      inspeccion: {
        ...data.inspeccion,
        [key]: { ...emptyInspeccionRow(), ...data.inspeccion[key], ...next },
      },
    });
  };

  const patchTable = (table: 'valvulas' | 'canastilla', key: string, next: Reservorios2Row) => {
    const current = data[table][key];
    const totalsKey = table === 'valvulas' ? 'valvulas_totales' : 'canastilla_totales';
    const totals = data[totalsKey];
    onChange({
      ...data,
      [table]: { ...data[table], [key]: next },
      [totalsKey]: {
        oper: current?.oper !== next.oper ? null : totals.oper,
        no_op: current?.no_op !== next.no_op ? null : totals.no_op,
      },
    });
  };

  const patchMedida = (key: keyof Reservorios2Medidas, value: string) => {
    onChange({ ...data, medidas: { ...data.medidas, [key]: value } });
  };

  return (
    <>
      <Section title="Inspección" meta={`${markedCount}/${R2_INSPECCION_ITEMS.length}`}>
        {R2_INSPECCION_ITEMS.map((item) => {
          const row = data.inspeccion[item.key] || emptyInspeccionRow();
          const state: CheckState = row.normal ? 'normal' : row.critico ? 'critico' : 'unchecked';
          const itemName = item.sub ? `${item.label} · ${item.sub}` : item.label;
          return (
            <div className="tr-insp-row" key={item.key}>
              <div className="tr-insp-head">
                <strong>{itemName}</strong>
                <div className="tr-segment">
                  {(['unchecked', 'normal', 'critico'] as CheckState[]).map((option) => (
                    <Button
                      key={option}
                      variant="none"
                      size="none"
                      className={`tr-seg-${option}${state === option ? ' active' : ''}`}
                      aria-label={`${itemName}: ${option === 'unchecked' ? 'Sin marcar' : option === 'normal' ? 'Normal' : 'Crítico'}`}
                      aria-pressed={state === option}
                      onClick={() =>
                        patchInspeccion(item.key, {
                          normal: option === 'normal',
                          critico: option === 'critico',
                        })
                      }
                    >
                      {option === 'unchecked' ? '—' : option === 'normal' ? 'Normal' : 'Crítico'}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="tr-insp-fields">
                <Field
                  label="Observaciones"
                  value={row.observaciones}
                  onChange={(value) => patchInspeccion(item.key, { observaciones: value })}
                />
                <Field
                  label="Sugerencias"
                  value={row.sugerencias}
                  onChange={(value) => patchInspeccion(item.key, { sugerencias: value })}
                />
              </div>
            </div>
          );
        })}
      </Section>

      <Section title="Válvulas">
        {R2_VALVULA_ROWS.map((key) => (
          <R2RowEditor
            key={key}
            title={R2_VALVULA_LABELS[key]}
            diameters={R2_VALVULA_DIAMETERS}
            row={data.valvulas[key] || emptyR2Row(R2_VALVULA_DIAMETERS)}
            onChange={(next) => patchTable('valvulas', key, next)}
          />
        ))}
      </Section>

      <Section title="Canastilla">
        {R2_CANASTILLA_ROWS.map((key) => (
          <R2RowEditor
            key={key}
            title={R2_CANASTILLA_LABELS[key]}
            diameters={R2_CANASTILLA_DIAMETERS}
            row={data.canastilla[key] || emptyR2Row(R2_CANASTILLA_DIAMETERS)}
            onChange={(next) => patchTable('canastilla', key, next)}
          />
        ))}
      </Section>

      <Section title="Medidas" defaultOpen>
        <div className="tr-grid-2">
          {MEDIDA_FIELDS.map(([labelKey, valueKey, label, defaultLabel]) => (
            <div key={valueKey} className="tr-medida-pair">
              <Field
                label={label}
                value={data.medidas[labelKey] || defaultLabel}
                onChange={(value) => patchMedida(labelKey, value)}
              />
              <Field
                label="Cantidad (M)"
                ariaLabel={`Cantidad (M) — ${label.replace(/^Texto de /, '')}`}
                value={data.medidas[valueKey]}
                onChange={(value) => patchMedida(valueKey, value)}
              />
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

function R2RowEditor({
  title,
  diameters,
  row,
  onChange,
}: {
  title: string;
  diameters: readonly string[];
  row: Reservorios2Row;
  onChange: (row: Reservorios2Row) => void;
}) {
  return (
    <div className="tr-diameter-row">
      <strong>{title}</strong>
      <div className="tr-diameter-grid">
        {diameters.map((d) => (
          <label key={d}>
            <span>{d}&quot;</span>
            <input
              type="number"
              value={row.diametros[d] || 0}
              onChange={(event) =>
                onChange({ ...row, diametros: { ...row.diametros, [d]: Number(event.target.value) || 0 } })
              }
            />
          </label>
        ))}
      </div>
      <div className="tr-grid-2">
        <Field label="OPER." type="number" value={row.oper} onChange={(value) => onChange({ ...row, oper: Number(value) || 0 })} />
        <Field label="NO OP." type="number" value={row.no_op} onChange={(value) => onChange({ ...row, no_op: Number(value) || 0 })} />
      </div>
      <div className="tr-grid-2">
        <Field label="Observaciones" value={row.observaciones} onChange={(value) => onChange({ ...row, observaciones: value })} />
        <Field label="Sugerencias" value={row.sugerencias} onChange={(value) => onChange({ ...row, sugerencias: value })} />
      </div>
    </div>
  );
}
