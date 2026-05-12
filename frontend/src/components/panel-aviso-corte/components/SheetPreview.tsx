import type { PanelVM } from '../types';

interface Props {
  panel: PanelVM;
  logoCenterUrl: string | null;
  images: Map<string, string>;
}

export default function SheetPreview({ panel, logoCenterUrl, images }: Props) {
  const getImage = (pos: number) => panel.imagenes.find((i) => i.position === pos);

  return (
      <div className="pac-sheet">
        <table className="pac-table">
          <colgroup>
            <col className="pac-col-label" />
            <col className="pac-col-left-value" />
            <col className="pac-col-right-value" />
            <col className="pac-col-logo" />
          </colgroup>
          {/* Row 0: Título + Logo */}
          <tr className="pac-row-title">
            <td colSpan={3} className="pac-cell-title">
              AVISO DE CORTE DEL SERVICIO DE AGUA POTABLE, POR TRABAJOS DE MEJORAMIENTO EN EL SISTEMA
            </td>
            <td rowSpan={4} className="pac-cell-logo">
              {logoCenterUrl && <img src={logoCenterUrl} alt="Logo" />}
            </td>
          </tr>
          {/* Row 1: Cuadrante */}
          <tr className="pac-row-meta-a">
            <td className="pac-cell-label">CUADRANTE AFECTADO</td>
            <td colSpan={2} className="pac-cell-value">{panel.cuadrante}</td>
          </tr>
          {/* Row 2: Fecha */}
          <tr className="pac-row-meta-b">
            <td className="pac-cell-label">FECHA DE CORTE</td>
            <td colSpan={2} className="pac-cell-value">{panel.fechaCorte}</td>
          </tr>
          {/* Row 3: Motivo */}
          <tr className="pac-row-meta-c">
            <td className="pac-cell-label">MOTIVO</td>
            <td colSpan={2} className="pac-cell-value">{panel.motivo}</td>
          </tr>
          {/* Row 4: Panel Fotográfico */}
          <tr className="pac-row-section">
            <td colSpan={4} className="pac-cell-section">PANEL FOTOGRAFICO</td>
          </tr>
          {/* Row 5: Imágenes 1 y 2 */}
          <tr className="pac-row-image">
            {[1, 2].map((pos) => {
              const img = getImage(pos);
              return (
                <td key={pos} colSpan={2} className="pac-cell-photo">
                  <div className="pac-cell-photo-inner">
                  {img && images.get(img.filename) ? (
                    <img src={images.get(img.filename)!} alt={img.caption} />
                  ) : (
                    <span className="pac-placeholder">Sin imagen</span>
                  )}
                  </div>
                </td>
              );
            })}
          </tr>
          {/* Row 6: Captions 1 y 2 */}
          <tr className="pac-row-caption">
            {[1, 2].map((pos) => {
              const img = getImage(pos);
              return (
                <td key={pos} colSpan={2} className="pac-cell-caption">
                  {img ? img.caption : `IMAGEN N°${pos}: (Indicar dirección según lista de usuarios)`}
                </td>
              );
            })}
          </tr>
          {/* Row 7: Imágenes 3 y 4 */}
          <tr className="pac-row-image">
            {[3, 4].map((pos) => {
              const img = getImage(pos);
              return (
                <td key={pos} colSpan={2} className="pac-cell-photo">
                  <div className="pac-cell-photo-inner">
                  {img && images.get(img.filename) ? (
                    <img src={images.get(img.filename)!} alt={img.caption} />
                  ) : (
                    <span className="pac-placeholder">Sin imagen</span>
                  )}
                  </div>
                </td>
              );
            })}
          </tr>
          {/* Row 8: Captions 3 y 4 */}
          <tr className="pac-row-caption pac-row-caption-last">
            {[3, 4].map((pos) => {
              const img = getImage(pos);
              return (
                <td key={pos} colSpan={2} className="pac-cell-caption">
                  {img ? img.caption : `IMAGEN N°${pos}: (Indicar dirección según lista de usuarios)`}
                </td>
              );
            })}
          </tr>
        </table>
      </div>
  );
}
