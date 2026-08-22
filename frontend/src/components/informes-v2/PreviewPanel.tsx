import React, { useMemo } from 'react';
import {
  DIAMETERS,
  LINEA_LABELS,
  LINEA_ROWS,
  VALVULA_LABELS,
  VALVULA_ROWS,
  sumDiameterColumns,
  sumOperNoOp,
  type InformeV2,
  type PhotoAsset,
} from './types';

interface Props {
  report: InformeV2 | null;
  logoLeft: string | null;
  logoRight: string | null;
  photos: PhotoAsset[];
}

function cell(value: number | string | undefined) {
  if (value === 0 || value === '0' || value === '' || value == null) return '';
  return String(value);
}

export default function PreviewPanel({ report, logoLeft, logoRight, photos }: Props) {
  const valvulas = report?.valvulas;
  const linea = report?.linea;

  const valvTotals = useMemo(
    () => (valvulas ? sumDiameterColumns(valvulas, VALVULA_ROWS) : {}),
    [valvulas],
  );
  const valvOps = useMemo(
    () => (valvulas ? sumOperNoOp(valvulas, VALVULA_ROWS) : { oper: 0, noOp: 0 }),
    [valvulas],
  );
  const linTotals = useMemo(
    () => (linea ? sumDiameterColumns(linea, LINEA_ROWS) : {}),
    [linea],
  );
  const linOps = useMemo(
    () => (linea ? sumOperNoOp(linea, LINEA_ROWS) : { oper: 0, noOp: 0 }),
    [linea],
  );
  const slots = useMemo(() => {
    const s: Array<PhotoAsset | null> = [...photos];
    while (s.length < 6) s.push(null);
    return s;
  }, [photos]);

  if (!report) {
    return (
      <section className="tr-preview-wrap">
        <div className="tr-empty tr-empty-large">Selecciona un informe para previsualizar</div>
      </section>
    );
  }

  return (
    <section className="tr-preview-wrap">
      <article className="iv2-paper" data-testid="iv2-preview">
        <header className="iv2-header">
          <div className="iv2-logo">{logoLeft ? <img src={logoLeft} alt="Logo izquierdo" /> : null}</div>
          <div className="iv2-title">
            <h1>Limpieza y Desinfección de Reservorios y Cisternas</h1>
            <h2>Centro de Servicio Villa El Salvador</h2>
          </div>
          <div className="iv2-logo">{logoRight ? <img src={logoRight} alt="Logo derecho" /> : null}</div>
        </header>

        <div className="iv2-info">
          <div><strong>ESTACION:</strong> {report.header.estacion}</div>
          <div><strong>DISTRITO:</strong> {report.header.distrito}</div>
          <div><strong>TIPO:</strong> {report.header.tipo}</div>
          <div><strong>FECHA DE EJECUCION:</strong> {report.header.fecha_ejecucion}</div>
          <div><strong>VOLUMEN:</strong> {report.header.volumen ? `${report.header.volumen} m³` : ''}</div>
          <div><strong>SUMINISTRO:</strong> {report.header.suministro}</div>
          <div><strong>UBICACIÓN:</strong> {report.header.ubicacion}</div>
          <div><strong>SGIO:</strong> {report.header.sgio}</div>
        </div>

        <DiameterTable
          cornerLabel="VÁLVULAS"
          rows={VALVULA_ROWS}
          labels={VALVULA_LABELS}
          table={report.valvulas}
          totals={valvTotals}
          oper={valvOps.oper}
          noOp={valvOps.noOp}
          diameterTitle="DIAMETRO DE VALVULAS"
        />

        <DiameterTable
          cornerLabel="LÍNEA"
          rows={LINEA_ROWS}
          labels={LINEA_LABELS}
          table={report.linea}
          totals={linTotals}
          oper={linOps.oper}
          noOp={linOps.noOp}
          diameterTitle="DIAMETRO DE TUBERIA"
        />

        <table className="iv2-table iv2-medidas-table">
          <thead>
            <tr>
              <th className="iv2-corner-label">MEDIDAS</th>
              <th>U.M.</th>
              <th>CANTIDAD</th>
              <th />
              <th>U.M.</th>
              <th>CANTIDAD</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="iv2-row-label">LARGO</td>
              <td>M</td>
              <td>{report.medidas.largo}</td>
              <td className="iv2-row-label">ALTURA DE REBOSE</td>
              <td>M</td>
              <td>{report.medidas.altura_rebose}</td>
            </tr>
            <tr>
              <td className="iv2-row-label">ANCHO</td>
              <td>M</td>
              <td>{report.medidas.ancho}</td>
              <td className="iv2-row-label">ALTURA TOTAL</td>
              <td>M</td>
              <td>{report.medidas.altura_total}</td>
            </tr>
            <tr>
              <td className="iv2-row-label">DIAMETRO</td>
              <td>M</td>
              <td>{report.medidas.diametro}</td>
              <td className="iv2-row-label">TIRANTE DE LIMPIEZA</td>
              <td>M</td>
              <td>{report.medidas.tirante_limpieza}</td>
            </tr>
            <tr>
              <td colSpan={6} className="iv2-medidas-obs">
                <strong>OBSERVACION:</strong> {report.medidas.observacion}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="iv2-photo-section">
          <div className="iv2-photo-title">Panel Fotográfico — Estructura</div>
          <div className="iv2-photo-grid" data-testid="iv2-photo-grid">
            {slots.map((photo, index) => (
              <div key={photo?.name ?? `empty-${index}`} className="iv2-photo-cell">
                {photo ? <img src={photo.src} alt={photo.name} /> : null}
              </div>
            ))}
          </div>
        </div>
      </article>
    </section>
  );
}

const DiameterTable = React.memo(function DiameterTable({
  cornerLabel,
  rows,
  labels,
  table,
  totals,
  oper,
  noOp,
  diameterTitle,
}: {
  cornerLabel: string;
  rows: readonly string[];
  labels: Record<string, string>;
  table: InformeV2['valvulas'];
  totals: Record<string, number>;
  oper: number;
  noOp: number;
  diameterTitle: string;
}) {
  return (
    <table className="iv2-table iv2-table-aligned">
      <colgroup>
        <col className="iv2-col-label" />
        {DIAMETERS.map((d) => <col key={d} className="iv2-col-d" />)}
        <col className="iv2-col-st" />
        <col className="iv2-col-st" />
        <col className="iv2-col-obs" />
      </colgroup>
      <thead>
        <tr>
          <th rowSpan={2} className="iv2-corner-label">{cornerLabel}</th>
          <th colSpan={DIAMETERS.length}>{diameterTitle}</th>
          <th colSpan={2}>ESTADO</th>
          <th rowSpan={2}>OBSERVACIONES</th>
        </tr>
        <tr>
          {DIAMETERS.map((d) => <th key={d}>{d}&quot;</th>)}
          <th>OPER.</th>
          <th>NO OP.</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((key) => {
          const row = table[key];
          return (
            <tr key={key}>
              <td className="iv2-row-label">{labels[key]}</td>
              {DIAMETERS.map((d) => <td key={d}>{cell(row?.diametros[d])}</td>)}
              <td>{cell(row?.oper)}</td>
              <td>{cell(row?.no_op)}</td>
              <td className="iv2-obs">{row?.observaciones || ''}</td>
            </tr>
          );
        })}
        <tr className="iv2-total">
          <td className="iv2-row-label">TOTAL</td>
          {DIAMETERS.map((d) => <td key={d}>{cell(totals[d])}</td>)}
          <td>{cell(oper)}</td>
          <td>{cell(noOp)}</td>
          <td />
        </tr>
      </tbody>
    </table>
  );
});
