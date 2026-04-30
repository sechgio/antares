import type { HeaderData, PadronItem } from './data';
import type { Orientation } from './data';

interface VProps {
  label: string;
  value: string;
}

function V({ label, value }: VProps) {
  return (
    <div className="vpad-vline">
      <span className="vpad-vlabel">{label}</span>
      <span className={`vpad-vval ${!value ? 'empty' : ''}`}>{value || '\u00A0'}</span>
    </div>
  );
}

interface DTProps {
  label: string;
  dateVal: string;
  timeVal: string;
}

function DT({ label, dateVal, timeVal }: DTProps) {
  return (
    <div className="vpad-vline vpad-dtrow">
      <span className="vpad-vlabel">{label}</span>
      <span className="vpad-dt-date-time">
        <span className={`vpad-vval ${!dateVal ? 'empty' : ''}`}>{dateVal || '\u00A0'}</span>
        <span className="vpad-dt-sep">|</span>
        <span className={`vpad-vval ${!timeVal ? 'empty' : ''}`}>{timeVal || '\u00A0'}</span>
      </span>
    </div>
  );
}

interface PreviewPageProps {
  headerData: HeaderData;
  items: PadronItem[];
  orientation: Orientation;
  accionaLogo: string;
  sedapalLogo: string;
  pageNumber: number;
  totalPages: number;
  isLastPage: boolean;
}

export default function PreviewPage({
  headerData,
  items,
  orientation,
  accionaLogo,
  sedapalLogo,
  pageNumber,
  totalPages,
  isLastPage,
}: PreviewPageProps) {
  const colWidths = orientation === 'portrait'
    ? { item: '5%', name: '24%', address: '31%', time: '10%', firma: '30%' }
    : { item: '4%', name: '24%', address: '28%', time: '12%', firma: '32%' };

  return (
    <div className={`vpad-sheet ${orientation}`}>
      <header className="vpad-sheet-head">
        <div className="vpad-logo-l">
          <img src={accionaLogo} alt="Acciona" />
        </div>
        <div className="vpad-sheet-title">
          <h1>NOTIFICACIÓN A TRAVÉS DE VOLANTES POR INTERRUPCIÓN DEL SERVICIO DE AGUA POTABLE</h1>
        </div>
        <div className="vpad-logo-r">
          <img src={sedapalLogo} alt="Sedapal" />
        </div>
      </header>

      <div className="vpad-meta">
        <div className="vpad-meta-col">
          <V label="Centro de servicio:" value={headerData.centro} />
          <V label="Servicio afectado:" value={headerData.servicioAfectado} />
          <V label="Motivo de la interrupción:" value={headerData.motivoInterrupcion} />
          <DT
            label="Fecha y hora del inicio de la interrupción del servicio:"
            dateVal={headerData.fechaInicio}
            timeVal={headerData.horaInicio}
          />
          <DT
            label="Fecha y hora prevista del restablecimiento del servicio:"
            dateVal={headerData.fechaPrevista}
            timeVal={headerData.horaPrevista}
          />
          <V label="Distrito(s):" value={headerData.distrito} />
        </div>
        <div className="vpad-meta-col">
          <V label="Sector(es):" value={headerData.sector} />
          <V label="Subsector(es) o código(s) de abastecimiento:" value={headerData.subsectores} />
          <V label="Estructura de almacenamiento:" value={headerData.estructura} />
          <V label="Fecha de trabajo:" value={headerData.fechaTrabajo} />
          <V label="Fecha de comunicación:" value={headerData.fechaComunicacion} />
        </div>
      </div>

      <div className="vpad-areas">
        <div className="vpad-area vpad-area-lg">
          <span className="vpad-area-title">Localidades afectadas:</span>
          <p>{headerData.localidades || '\u00A0'}</p>
        </div>
        <div className="vpad-area vpad-area-sm">
          <span className="vpad-area-title">Área afectada:</span>
          <p>{headerData.areaAfectada || '\u00A0'}</p>
        </div>
      </div>

      <div className="vpad-notes">
        <div className="vpad-notes-l">
          <p>Precauciones para el uso adecuado del servicio (*)</p>
          <p>(*) Reporte ante la ocurrencia de desastres, casos fortuitos o fuerza mayor.</p>
        </div>
        <div className="vpad-notes-r">
          <div className="vpad-cps-code">{headerData.codigoServicio}</div>
          <div className="vpad-cps-desc">{headerData.descripcionServicio}</div>
        </div>
      </div>

      <div className="vpad-tbl">
        <table>
          <thead>
            <tr>
              <th style={{ width: colWidths.item }}>Item</th>
              <th style={{ width: colWidths.name }}>Nombres y Apellidos</th>
              <th style={{ width: colWidths.address }}>Dirección</th>
              <th style={{ width: colWidths.time }}>Hora de comunicación</th>
              <th style={{ width: colWidths.firma }}>Firma del usuario / N° medidor / suministro</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i}>
                <td className="vpad-tc vpad-tb">{item.item}</td>
                <td>{item.nombresApellidos || '\u00A0'}</td>
                <td>{item.direccion || '\u00A0'}</td>
                <td className="vpad-tc">{item.horaComunicacion || '\u00A0'}</td>
                <td>{item.firmaSuministro || '\u00A0'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isLastPage && (
        <div className="vpad-volanteo-section">
          <div className="vpad-volanteo-line">
            <span className="vpad-volanteo-label">Responsable del volanteo :</span>
            <span className="vpad-volanteo-value">{'\u00A0'}</span>
          </div>
          <div className="vpad-volanteo-line">
            <span className="vpad-volanteo-contratista">
              <span className="vpad-volanteo-contratista-label">CONTRATISTA : </span>
              <span className="vpad-volanteo-contratista-value">ACCIONA</span>
            </span>
          </div>
        </div>
      )}

      <div className="vpad-sheet-foot">
        Página {pageNumber} de {totalPages}
      </div>
    </div>
  );
}
