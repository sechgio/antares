import { useMemo } from 'react';
import {
  R2_CANASTILLA_DIAMETERS,
  R2_CANASTILLA_LABELS,
  R2_CANASTILLA_ROWS,
  R2_INSPECCION_ITEMS,
  R2_TITULO_LINEA1,
  R2_TITULO_LINEA2,
  R2_VALVULA_DIAMETERS,
  R2_VALVULA_LABELS,
  R2_VALVULA_ROWS,
  sumDiameterColumns,
  sumOperNoOp,
  type InformeV2,
  type PhotoAsset,
  type Reservorios2Row,
} from './types';

interface Props {
  data: InformeV2;
  logoLeft: string | null;
  logoRight: string | null;
  photos: PhotoAsset[];
}

function cell(value: number | string | undefined) {
  if (value === 0 || value === '' || value == null) return '';
  return String(value);
}

export default function Reservorios2Preview({ data, logoLeft, logoRight, photos }: Props) {
  const r2 = data.reservorios2;

  const valvulas = useMemo(
    () => ({
      totals: sumDiameterColumns(r2.valvulas, R2_VALVULA_ROWS, R2_VALVULA_DIAMETERS),
      ops: (() => {
        const sum = sumOperNoOp(r2.valvulas, R2_VALVULA_ROWS);
        return {
          oper: r2.valvulas_totales.oper ?? sum.oper,
          noOp: r2.valvulas_totales.no_op ?? sum.noOp,
        };
      })(),
    }),
    [r2.valvulas, r2.valvulas_totales],
  );
  const canastilla = useMemo(
    () => ({
      totals: sumDiameterColumns(r2.canastilla, R2_CANASTILLA_ROWS, R2_CANASTILLA_DIAMETERS),
      ops: (() => {
        const sum = sumOperNoOp(r2.canastilla, R2_CANASTILLA_ROWS);
        return {
          oper: r2.canastilla_totales.oper ?? sum.oper,
          noOp: r2.canastilla_totales.no_op ?? sum.noOp,
        };
      })(),
    }),
    [r2.canastilla, r2.canastilla_totales],
  );

  const slots = useMemo(() => {
    const s: Array<PhotoAsset | null> = [...photos];
    while (s.length < 6) s.push(null);
    return s;
  }, [photos]);

  return (
    <article className="iv2-paper" data-testid="iv2-preview">
      <header className="iv2-header r2-header">
        <div className="iv2-logo">
          {logoLeft ? <img src={logoLeft} alt="Logo izquierdo" /> : <span className="r2-logo-ph">Logo L</span>}
        </div>
        <div className="iv2-title">
          <h1>{R2_TITULO_LINEA1}</h1>
          <h2>{R2_TITULO_LINEA2}</h2>
        </div>
        <div className="iv2-logo">
          {logoRight ? <img src={logoRight} alt="Logo derecho" /> : <span className="r2-logo-ph">Logo R</span>}
        </div>
      </header>

      <div className="r2-info">
        <div className="r2-info-row">
          <div className="r2-info-label">ESTRUCTURA :</div>
          <div className="r2-info-value">{data.header.estacion}</div>
          <div className="r2-info-label">DISTRITO :</div>
          <div className="r2-info-value">{data.header.distrito}</div>
        </div>
        <div className="r2-info-row">
          <div className="r2-info-label">TIPO :</div>
          <div className="r2-info-value">{data.header.tipo}</div>
          <div className="r2-info-label">FECHA DE EJECUCION :</div>
          <div className="r2-info-value">{data.header.fecha_ejecucion}</div>
        </div>
        <div className="r2-info-row">
          <div className="r2-info-label">VOLUMEN :</div>
          <div className="r2-info-value">{data.header.volumen ? `${data.header.volumen} m³` : ''}</div>
          <div className="r2-info-label">SUMINISTRO :</div>
          <div className="r2-info-value">{data.header.suministro}</div>
        </div>
      </div>

      <table className="r2-table">
        <colgroup>
          <col style={{ width: '20.6%' }} />
          <col style={{ width: '9.8%' }} />
          <col style={{ width: '17.6%' }} />
          <col style={{ width: '17.3%' }} />
          <col style={{ width: '17.3%' }} />
          <col style={{ width: '17.4%' }} />
        </colgroup>
        <thead>
          <tr>
            <th colSpan={2} rowSpan={2}>DESCRIPCIÓN</th>
            <th colSpan={2}>ESTADO</th>
            <th rowSpan={2}>OBSERVACIONES</th>
            <th rowSpan={2}>SUGERENCIAS</th>
          </tr>
          <tr>
            <th>NORMAL</th>
            <th>CRÍTICO</th>
          </tr>
        </thead>
        <tbody>
          {R2_INSPECCION_ITEMS.map((item, index) => {
            const row = r2.inspeccion[item.key];
            const prev = R2_INSPECCION_ITEMS[index - 1];
            const showLabel = !item.sub || !prev || prev.label !== item.label;
            return (
              <tr key={item.key}>
                {item.sub ? (
                  <>
                    {showLabel ? <td className="r2-label" rowSpan={2}>{item.label}</td> : null}
                    <td className="r2-sub">{item.sub}</td>
                  </>
                ) : (
                  <td className="r2-label" colSpan={2}>{item.label}</td>
                )}
                <td className={row?.normal ? 'r2-ok' : ''}>{row?.normal ? '✓' : ''}</td>
                <td className={row?.critico ? 'r2-crit' : ''}>{row?.critico ? 'X' : ''}</td>
                <td className="r2-obs">{row?.observaciones || ''}</td>
                <td className="r2-obs">{row?.sugerencias || ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <R2DiameterTable
        title="VÁLVULAS"
        diameterTitle="DIÁMETRO DE VÁLVULAS"
        diameters={R2_VALVULA_DIAMETERS}
        rows={R2_VALVULA_ROWS}
        labels={R2_VALVULA_LABELS}
        table={r2.valvulas}
        totals={valvulas.totals}
        oper={valvulas.ops.oper}
        noOp={valvulas.ops.noOp}
      />

      <R2DiameterTable
        title="CANASTILLA"
        diameterTitle="DIÁMETRO DE CANASTILLA"
        diameters={R2_CANASTILLA_DIAMETERS}
        rows={R2_CANASTILLA_ROWS}
        labels={R2_CANASTILLA_LABELS}
        table={r2.canastilla}
        totals={canastilla.totals}
        oper={canastilla.ops.oper}
        noOp={canastilla.ops.noOp}
      />

      <table className="r2-table">
        <colgroup>
          <col style={{ width: '33.2%' }} />
          <col style={{ width: '5.4%' }} />
          <col style={{ width: '11.4%' }} />
          <col style={{ width: '33.2%' }} />
          <col style={{ width: '5.4%' }} />
          <col style={{ width: '11.4%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>MEDIDAS</th>
            <th>U/M</th>
            <th>CANTIDAD</th>
            <th>MEDIDAS</th>
            <th>U/M</th>
            <th>CANTIDAD</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="r2-label">{r2.medidas.etiqueta_diametro || 'DIAMETRO'}</td>
            <td className="r2-um">M</td>
            <td>{r2.medidas.diametro}</td>
            <td className="r2-label">{r2.medidas.etiqueta_altura_util || 'ALTURA UTIL'}</td>
            <td className="r2-um">M</td>
            <td>{r2.medidas.altura_util}</td>
          </tr>
          <tr>
            <td className="r2-label">{r2.medidas.etiqueta_diametro_interno || 'DIAMETRO INTERNO'}</td>
            <td className="r2-um">M</td>
            <td>{r2.medidas.diametro_interno}</td>
            <td className="r2-label">{r2.medidas.etiqueta_altura_total || 'ALTURA TOTAL'}</td>
            <td className="r2-um">M</td>
            <td>{r2.medidas.altura_total}</td>
          </tr>
        </tbody>
      </table>

      <div className="iv2-photo-section r2-photo-section">
        <div className="r2-photo-title">PANEL FOTOGRAFICO — ESTRUCTURA</div>
        <div className="iv2-photo-grid r2-photo-grid" data-testid="iv2-photo-grid">
          {slots.map((photo, index) => (
            <div key={photo?.name ?? `empty-${index}`} className="iv2-photo-cell r2-photo-cell">
              {photo ? <img src={photo.src} alt={photo.name} /> : <span className="r2-photo-ph">Foto {index + 1}</span>}
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function R2DiameterTable({
  title,
  diameterTitle,
  diameters,
  rows,
  labels,
  table,
  totals,
  oper,
  noOp,
}: {
  title: string;
  diameterTitle: string;
  diameters: readonly string[];
  rows: readonly string[];
  labels: Record<string, string>;
  table: Record<string, Reservorios2Row>;
  totals: Record<string, number>;
  oper: number;
  noOp: number;
}) {
  return (
    <table className="r2-table">
      <colgroup>
        <col style={{ width: '10.8%' }} />
        {diameters.map((d) => (
          <col key={d} style={{ width: '6.23%' }} />
        ))}
        <col style={{ width: '5.4%' }} />
        <col style={{ width: '5.4%' }} />
        <col style={{ width: '17.3%' }} />
        <col style={{ width: '17.4%' }} />
      </colgroup>
      <thead>
        <tr>
          <th rowSpan={2}>{title}</th>
          <th colSpan={diameters.length}>{diameterTitle}</th>
          <th rowSpan={2}>OPER.</th>
          <th rowSpan={2}>NO OP.</th>
          <th rowSpan={2}>OBSERVACIONES</th>
          <th rowSpan={2}>SUGERENCIAS</th>
        </tr>
        <tr>
          {diameters.map((d) => (
            <th key={d}>{d}&quot;</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((key) => {
          const row = table[key];
          return (
            <tr key={key}>
              <td className="r2-label">{labels[key]}</td>
              {diameters.map((d) => (
                <td key={d}>{cell(row?.diametros[d])}</td>
              ))}
              <td>{cell(row?.oper)}</td>
              <td>{cell(row?.no_op)}</td>
              <td className="r2-obs">{row?.observaciones || ''}</td>
              <td className="r2-obs">{row?.sugerencias || ''}</td>
            </tr>
          );
        })}
        <tr className="r2-total">
          <td className="r2-label">TOTAL</td>
          {diameters.map((d) => (
            <td key={d}>{cell(totals[d])}</td>
          ))}
          <td>{cell(oper)}</td>
          <td>{cell(noOp)}</td>
          <td />
          <td />
        </tr>
      </tbody>
    </table>
  );
}
