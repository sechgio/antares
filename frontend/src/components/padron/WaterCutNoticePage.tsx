import type { WaterCutData, WaterCutItem } from './data';

interface WaterCutNoticePageProps {
  headerData: WaterCutData;
  items: WaterCutItem[];
  sedapalLogo: string;
  pageNumber: number;
  totalPages: number;
  rowsPerPage?: number;
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="vpad-cut-meta-row">
      <span className="vpad-cut-meta-label">{label}</span>
      <span className="vpad-cut-meta-value">{value || '\u00A0'}</span>
    </div>
  );
}

export default function WaterCutNoticePage({
  headerData,
  items,
  sedapalLogo,
  pageNumber,
  totalPages,
  rowsPerPage = 39,
}: WaterCutNoticePageProps) {
  const rows = items.slice(0, rowsPerPage);

  return (
    <div className="vpad-sheet portrait vpad-cut-sheet">
      <header className="vpad-cut-head">
        <div className="vpad-cut-title-block">
          <h1>AVISO DE CORTE DEL SERVICIO DE AGUA POTABLE, POR TRABAJOS DE MEJORAMIENTO EN EL SISTEMA</h1>
        </div>
        <div className="vpad-cut-logo">
          <img src={sedapalLogo} alt="Sedapal" />
        </div>
      </header>

      <section className="vpad-cut-meta" aria-label="Datos del aviso de corte">
        <FieldRow label="CUADRANTE AFECTADO:" value={headerData.cuadranteAfectado} />
        <FieldRow label="FECHA DE CORTE DE SERVICIO:" value={headerData.fechaCorte} />
        <FieldRow label="HORARIO DE CORTE DE SERVICIO:" value={headerData.horarioCorte} />
        <FieldRow label="MOTIVO:" value={headerData.motivo} />
      </section>

      <div className="vpad-cut-table-wrap">
        <table className="vpad-cut-table">
          <thead>
            <tr>
              <th style={{ width: '9.5%' }}>HORA</th>
              <th style={{ width: '9.5%' }}>FECHA</th>
              <th style={{ width: '17.5%' }}>NOMBRE Y APELLIDOS</th>
              <th style={{ width: '17.5%' }}>DIRECCIÓN</th>
              <th style={{ width: '11.5%' }}>DNI</th>
              <th style={{ width: '12%' }}>FIRMA</th>
              <th style={{ width: '22.5%' }}>OBSERVACIONES</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item, index) => (
              <tr key={`${item.item}-${index}`}>
                <td>{item.hora || '\u00A0'}</td>
                <td>{item.fecha || '\u00A0'}</td>
                <td>{item.nombresApellidos || '\u00A0'}</td>
                <td>{item.direccion || '\u00A0'}</td>
                <td>{item.dni || '\u00A0'}</td>
                <td>{item.firma || '\u00A0'}</td>
                <td>{item.observaciones || '\u00A0'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="vpad-sheet-foot">
        Página {pageNumber} de {totalPages}
      </div>
    </div>
  );
}
