import type { TechnicalReport } from './types';

interface Props {
  report: TechnicalReport | null;
  logoLeft: string | null;
  logoRight: string | null;
}

const EMPTY_REPORT: TechnicalReport = {
  id: '',
  metadata: { informe_id: 0, dia: 0, mes: '', anio: 0, pagina: '' },
  header: { cs: '', contratista: '', codigo_infraestructura: '', ubicacion: '', suministro: '', tipo: 'ELEVADO', volumen: 0 },
  inspeccion: {
    caja_registro: 'unchecked', marco_tapa: 'unchecked', escalera_interior: 'unchecked', escalera_exterior: 'unchecked',
    cuba_interior: 'unchecked', cuba_exterior: 'unchecked', loza_fondo: 'unchecked', loza_techo_interior: 'unchecked',
    loza_techo_exterior: 'unchecked', ducto_ventilacion: 'unchecked', cerco_perimetrico: 'unchecked', descarga: 'unchecked',
  },
  valvulas: {
    diametros: {}, impulsion: {}, aduccion: {}, bypass: {}, desague: {},
    operativas: 0, no_operativas: 0,
    observaciones_conduccion: '', sugerencias_conduccion: '',
    observaciones_impulsion: '', sugerencias_impulsion: '',
    observaciones_aduccion: '', sugerencias_aduccion: '',
    observaciones_bypass: '', sugerencias_bypass: '',
    observaciones_desague: '', sugerencias_desague: '',
  },
  canastillas: {
    diametros: {}, aduccion: {}, succion: {}, desague: {},
    operativas: 0, no_operativas: 0,
    observaciones_aduccion: '', sugerencias_aduccion: '',
    observaciones_succion: '', sugerencias_succion: '',
    observaciones_desague: '', sugerencias_desague: '',
  },
  medidas: { diametro: '', diametro_interno: '', altura_util: '', altura_total: '' },
  observaciones: '',
  sugerencias: '',
  status: 'draft',
  last_modified: '',
};

export default function PreviewPanel({ report, logoLeft, logoRight }: Props) {
  const data = report ?? EMPTY_REPORT;

  const renderCheck = (key: string, state: 'normal' | 'critico') => {
    if (data.inspeccion[key] !== state) return '';
    return (
      <span className={state === 'critico' ? 'tr-check-critico' : 'tr-check-normal'} data-testid={`preview-check-${key}-${state}`}>
        X
      </span>
    );
  };

  const renderInspectionRow = (
    label: string,
    key: string,
    obsKey: string,
    sugKey: string,
    colSpan = 2,
    rowSpan = 1,
    className = ''
  ) => (
    <tr key={key}>
      {rowSpan > 1 ? (
        <td rowSpan={rowSpan} className={`row-label center ${className}`} style={{ width: '11%' }}>
          {label}
        </td>
      ) : colSpan === 2 ? (
        <td colSpan={2} className={`row-label ${className}`}>
          {label}
        </td>
      ) : (
        <td className={`sub-label ${className}`}>{label}</td>
      )}
      <td className="center">{renderCheck(key, 'normal')}</td>
      <td className="center">{renderCheck(key, 'critico')}</td>
      <td className="center">{data.inspeccion[obsKey]}</td>
      <td className="center">{data.inspeccion[sugKey]}</td>
    </tr>
  );

  return (
    <section className="tr-preview-wrap">
      <div className="tr-paper">
        <header className="tr-paper-header">
          <div className="tr-paper-logo">{logoLeft && <img src={logoLeft} alt="Logo izquierdo" />}</div>
          <h2>Informe Técnico de Limpieza y<br />Desinfección de Reservorios y Cisternas</h2>
          <div className="tr-paper-logo">{logoRight && <img src={logoRight} alt="Logo derecho" />}</div>
        </header>

        <table className="tr-paper-meta">
          <tbody>
            <tr>
              <th>Informe</th><td>{data.metadata.informe_id}</td>
              <th>Día</th><td>{data.metadata.dia}</td>
              <th>Mes</th><td>{data.metadata.mes}</td>
              <th>Año</th><td>{data.metadata.anio}</td>
            </tr>
          </tbody>
        </table>

        <table className="tr-paper-table">
          <tbody>
            <tr><th>C.S :</th><td colSpan={3}>{data.header.cs}</td></tr>
            <tr><th>Contratista :</th><td colSpan={3}>{data.header.contratista}</td></tr>
            <tr><th>Código de infraestructura :</th><td colSpan={3} className="tr-paper-code">{data.header.codigo_infraestructura}</td></tr>
            <tr><th>Ubicación :</th><td>{data.header.ubicacion}</td><th>Tipo :</th><td>{data.header.tipo}</td></tr>
            <tr><th>Suministro :</th><td>{data.header.suministro}</td><th>Volumen :</th><td>{data.header.volumen}</td></tr>
          </tbody>
        </table>

        <table className="tr-paper-table tr-paper-small inspection-table">
          <thead>
            <tr>
              <th rowSpan={2} colSpan={2} style={{ width: '31.5%' }}>Descripción</th>
              <th colSpan={2}>Estado</th>
              <th rowSpan={2} style={{ width: '17%' }}>Observaciones</th>
              <th rowSpan={2} style={{ width: '18%' }}>Sugerencias</th>
            </tr>
            <tr>
              <th style={{ width: '7.5%' }}>Normal</th>
              <th style={{ width: '7.5%' }}>Crítico</th>
            </tr>
          </thead>
          <tbody>
            {renderInspectionRow('CAJA DE REGISTRO', 'caja_registro', 'observaciones_caja_registro', 'sugerencias_caja_registro')}
            {renderInspectionRow('MARCO Y TAPA SANITARIA', 'marco_tapa', 'observaciones_marco_tapa', 'sugerencias_marco_tapa')}
            <tr>
              <td rowSpan={2} className="row-label center" style={{ width: '11%' }}>ESCALERA</td>
              <td className="sub-label">INTERIOR</td>
              <td className="center">{renderCheck('escalera_interior', 'normal')}</td>
              <td className="center">{renderCheck('escalera_interior', 'critico')}</td>
              <td className="center">{data.inspeccion.observaciones_escalera_int}</td>
              <td className="center">{data.inspeccion.sugerencias_escalera_int}</td>
            </tr>
            <tr>
              <td className="sub-label">EXTERIOR</td>
              <td className="center">{renderCheck('escalera_exterior', 'normal')}</td>
              <td className="center">{renderCheck('escalera_exterior', 'critico')}</td>
              <td className="center">{data.inspeccion.observaciones_escalera_ext}</td>
              <td className="center">{data.inspeccion.sugerencias_escalera_ext}</td>
            </tr>
            <tr>
              <td rowSpan={2} className="row-label center">CUBA</td>
              <td className="sub-label">INTERIOR</td>
              <td className="center">{renderCheck('cuba_interior', 'normal')}</td>
              <td className="center">{renderCheck('cuba_interior', 'critico')}</td>
              <td className="center">{data.inspeccion.observaciones_cuba_int}</td>
              <td className="center">{data.inspeccion.sugerencias_cuba_int}</td>
            </tr>
            <tr>
              <td className="sub-label">EXTERIOR</td>
              <td className="center">{renderCheck('cuba_exterior', 'normal')}</td>
              <td className="center">{renderCheck('cuba_exterior', 'critico')}</td>
              <td className="center">{data.inspeccion.observaciones_cuba_ext}</td>
              <td className="center">{data.inspeccion.sugerencias_cuba_ext}</td>
            </tr>
            {renderInspectionRow('LOZA DE FONDO', 'loza_fondo', 'observaciones_loza_fondo', 'sugerencias_loza_fondo')}
            <tr>
              <td rowSpan={2} className="row-label center">LOZA DE TECHO</td>
              <td className="sub-label">INTERIOR</td>
              <td className="center">{renderCheck('loza_techo_interior', 'normal')}</td>
              <td className="center">{renderCheck('loza_techo_interior', 'critico')}</td>
              <td className="center">{data.inspeccion.observaciones_loza_techo_int}</td>
              <td className="center">{data.inspeccion.sugerencias_loza_techo_int}</td>
            </tr>
            <tr>
              <td className="sub-label">EXTERIOR</td>
              <td className="center">{renderCheck('loza_techo_exterior', 'normal')}</td>
              <td className="center">{renderCheck('loza_techo_exterior', 'critico')}</td>
              <td className="center">{data.inspeccion.observaciones_loza_techo_ext}</td>
              <td className="center">{data.inspeccion.sugerencias_loza_techo_ext}</td>
            </tr>
            {renderInspectionRow('DUCTO DE VENTILACIÓN', 'ducto_ventilacion', 'observaciones_ducto', 'sugerencias_ducto')}
            {renderInspectionRow('CERCO PERIMÉTRICO', 'cerco_perimetrico', 'observaciones_cerco', 'sugerencias_cerco')}
            {renderInspectionRow('DESCARGA', 'descarga', 'observaciones_descarga', 'sugerencias_descarga')}
          </tbody>
        </table>

        <ReportDiameterTable
          title="Válvulas"
          diameters={['2', '3', '4', '6', '8', '10', '12']}
          rows={[
            ['CONDUCCIÓN', data.valvulas.diametros, data.valvulas.observaciones_conduccion, data.valvulas.sugerencias_conduccion],
            ['IMPULSIÓN', data.valvulas.impulsion, data.valvulas.observaciones_impulsion, data.valvulas.sugerencias_impulsion],
            ['ADUCCIÓN', data.valvulas.aduccion, data.valvulas.observaciones_aduccion, data.valvulas.sugerencias_aduccion],
            ['BY PASS', data.valvulas.bypass, data.valvulas.observaciones_bypass, data.valvulas.sugerencias_bypass],
            ['DESAGÜE', data.valvulas.desague, data.valvulas.observaciones_desague, data.valvulas.sugerencias_desague],
          ]}
          operativas={data.valvulas.operativas}
          noOperativas={data.valvulas.no_operativas}
        />

        <ReportDiameterTable
          title="Canastillas"
          diameters={['2', '3', '4', '6', '8', '10', '14']}
          rows={[
            ['ADUCCION', data.canastillas.aduccion, data.canastillas.observaciones_aduccion, data.canastillas.sugerencias_aduccion],
            ['SUCCION', data.canastillas.succion, data.canastillas.observaciones_succion, data.canastillas.sugerencias_succion],
            ['DESAGUE', data.canastillas.desague, data.canastillas.observaciones_desague, data.canastillas.sugerencias_desague],
          ]}
          operativas={data.canastillas.operativas}
          noOperativas={data.canastillas.no_operativas}
        />

        <table className="tr-paper-table tr-paper-small">
          <colgroup>
            <col style={{ width: '65%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '18%' }} />
          </colgroup>
          <thead>
            <tr><th>Medidas</th><th className="center">U/M</th><th className="center">Cantidad</th></tr>
          </thead>
          <tbody>
            <tr><th>DIAMETRO</th><td className="center">M</td><td className="center">{data.medidas.diametro}</td></tr>
            <tr><th>DIAMETRO INTERNO</th><td className="center">M</td><td className="center">{data.medidas.diametro_interno}</td></tr>
            <tr><th>ALTURA UTIL</th><td className="center">M</td><td className="center">{data.medidas.altura_util}</td></tr>
            <tr><th>ALTURA TOTAL</th><td className="center">M</td><td className="center">{data.medidas.altura_total}</td></tr>
          </tbody>
        </table>

        <table className="tr-paper-table tr-paper-small">
          <colgroup>
            <col style={{ width: '11%' }} />
            <col />
          </colgroup>
          <thead>
            <tr><th colSpan={2}>Actividades Ejecutadas</th></tr>
          </thead>
          <tbody>
            {[
              'SEÑALIZACION DE LA ZONA DE TRABAJO',
              'LLENADO DE FORMATOS: ATS, ALTURA.',
              'DESCARGA DE HERRAMIENTAS, EQUIPOS E INSUMOS DEL VEHICULO',
              'VENTILACION DE LA ESTRUCTURA DE ALMACENAMIENTO DE AGUA',
              'INSTALACION DEL SISTEMA DE ILUMINACION',
              'TRASLADO E INGRESO DE HERRAMIENTAS NECESARIOS PARA INICIAR LA LIMPIEZA',
              'RASQUETEO DE LAS PAREDES, PISO Y TECHO CON AYUDA DE HERRAMIENTAS Y EL AGUA',
              'ENJUAGUE Y DESCARGA DEL AGUA DE LIMPIEZA',
              'PREPARACION DE LA SOLUCION DE HIPOCLORITO DE CALCIO',
              'DESINFECCION CON AYUDA DE LA BOMBA DE ALTA PRESION',
              'SE PROCEDE A CARGAR LAS HERRAMIENTAS, EQUIPOS Y SEÑALIZACION AL VEHICULO.',
            ].map((act, idx) => (
              <tr key={idx}>
                <th className="num-col" style={{ textAlign: 'center' }}>{idx + 1}</th>
                <td className="act-col">{act}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReportDiameterTable({
  title,
  diameters,
  rows,
  operativas,
  noOperativas,
}: {
  title: string;
  diameters: string[];
  rows: Array<[string, Record<string, number>, string, string]>;
  operativas: number;
  noOperativas: number;
}) {
  return (
    <table className="tr-paper-table tr-paper-small">
      <colgroup>
        <col style={{ width: '11%' }} />
        {diameters.map((d) => (
          <col key={d} />
        ))}
        <col style={{ width: '5%' }} />
        <col style={{ width: '5%' }} />
        <col style={{ width: '17%' }} />
        <col style={{ width: '18%' }} />
      </colgroup>
      <thead>
        <tr>
          <th rowSpan={2}>{title}</th>
          <th colSpan={diameters.length}>Diámetro de {title}</th>
          <th rowSpan={2}>Oper.</th>
          <th rowSpan={2}>No Op.</th>
          <th rowSpan={2}>Observaciones</th>
          <th rowSpan={2}>Sugerencias</th>
        </tr>
        <tr>
          {diameters.map((d) => (
            <th key={d}>{d}&quot;</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, data, obs, sug]) => (
          <tr key={label}>
            <th>{label}</th>
            {diameters.map((d) => (
              <td key={d} className="center">
                {data[d] || ''}
              </td>
            ))}
            <td></td>
            <td></td>
            <td>{obs || ''}</td>
            <td>{sug || ''}</td>
          </tr>
        ))}
        <tr style={{ background: '#d4d8dd' }}>
          <th>TOTAL</th>
          <td colSpan={diameters.length}></td>
          <td className="center" style={{ fontWeight: 'bold' }}>{operativas}</td>
          <td className="center" style={{ fontWeight: 'bold' }}>{noOperativas}</td>
          <td></td>
          <td></td>
        </tr>
      </tbody>
    </table>
  );
}
