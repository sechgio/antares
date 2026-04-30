import type { BrandConfig, FlyerRecord } from "../types";
import { FLYER_ASSETS } from "../constants";
import { formatFlyerDateLine } from "../utils/format";

interface FlyerCardProps {
  record: FlyerRecord;
  brand: BrandConfig;
  scale?: number;
}

const INFO_COPY =
  "Estamos realizando mejoras importantes en la red de agua para brindarle un servicio mas confiable y de calidad. Agradecemos su paciencia mientras trabajamos para restablecerlo pronto.";

const SERVICE_NOTE =
  "Al momento de la reposicion del servicio, el agua podria presentar ligera turbiedad debido a los trabajos realizados. Se regularizara en instantes.";

const PlaceholderLogo = ({ label }: { label: string }) => (
  <div className="flyer-logo-placeholder">{label}</div>
);

const buildCardStyle = (record: FlyerRecord, scale: number): Record<string, string> => {
  const vars: Record<string, string> = {
    "--flyer-scale": String(scale),
  };

  const add = (name: string, value: number | undefined) => {
    if (value && value !== 100) vars[name] = String(value / 100);
  };

  add("--title-mult-2up", record.titleSize2up);
  add("--title-mult-3up", record.titleSize3up);
  add("--district-mult-2up", record.districtSize2up);
  add("--district-mult-3up", record.districtSize3up);
  add("--headings-mult-2up", record.headingsSize2up);
  add("--headings-mult-3up", record.headingsSize3up);
  add("--service-mult-2up", record.serviceSize2up);
  add("--service-mult-3up", record.serviceSize3up);
  add("--reservoir-mult-2up", record.reservoirSize2up);
  add("--reservoir-mult-3up", record.reservoirSize3up);
  add("--sector-mult-2up", record.sectorSize2up);
  add("--sector-mult-3up", record.sectorSize3up);
  add("--zones-font-mult-2up", record.zonesFontSize2up);
  add("--zones-font-mult-3up", record.zonesFontSize3up);

  return vars;
};

export default function FlyerCard({
  record,
  brand,
  scale = 1
}: FlyerCardProps) {
  const reservoirClassName =
    record.reservorio.length > 24
      ? "flyer-panel-title compact"
      : record.reservorio.length > 16
        ? "flyer-panel-title medium"
        : "flyer-panel-title";

  const zonesClassName =
    record.zonasAfectadas.length > 1150
      ? "flyer-zones-text dense"
      : record.zonasAfectadas.length > 760
        ? "flyer-zones-text compact"
        : "flyer-zones-text";

  return (
    <article
      className="flyer-card"
      style={buildCardStyle(record, scale)}
    >
      <header className="flyer-topbar">
        <div className="flyer-logos">
          <div className="flyer-logo-frame left">
            {brand.logoIzquierdo ? (
              <img src={brand.logoIzquierdo} alt="Logo izquierdo" />
            ) : (
              <PlaceholderLogo label="LOGO 1" />
            )}
          </div>
          <div className="flyer-logo-frame right">
            {brand.logoDerecho ? (
              <img src={brand.logoDerecho} alt="Logo derecho" />
            ) : (
              <PlaceholderLogo label="LOGO 2" />
            )}
          </div>
        </div>
      </header>

      <div className="flyer-hero">
        <section className="flyer-title-band">
          <h1>Trabajos de mejoramiento</h1>
          <p>del reservorio de agua potable</p>
        </section>

        <section className="flyer-district-pill">DISTRITO {record.distrito}</section>

        <section className="flyer-service-band">
          <h2>Interrupción del servicio</h2>
          <p>{formatFlyerDateLine(record.fecha, record.horaInicio, record.horaFin)}</p>
        </section>

        <section className="flyer-panel">
          <div className="flyer-panel-body" style={{ overflow: "hidden" }}>
            <span className="flyer-kicker">LIMPIEZA DE RESERVORIOS:</span>
            <strong className={reservoirClassName}>{record.reservorio}</strong>

            <div className="flyer-section-label">Zonas afectadas:</div>

            <div className="flyer-sector-line">
              {record.sector ? <strong>{record.sector}</strong> : null}
            </div>

            <div className="flyer-detail-title">
              Detalle de zonas o cuadrante afectado
            </div>

            <p className={zonesClassName}>{record.zonasAfectadas}</p>
          </div>
        </section>
      </div>

      <footer className="flyer-footer">
        <img
          alt="Logo operativo"
          className="flyer-footer-acciona"
          src={FLYER_ASSETS.footerLogo}
        />
        <img
          alt="Servicio de agua"
          className="flyer-footer-grifo"
          src={FLYER_ASSETS.grifo}
        />
        <p className="flyer-footer-note">{SERVICE_NOTE}</p>
        <p className="flyer-footer-copy">{INFO_COPY}</p>
        <img
          alt="Aquafono"
          className="flyer-footer-aquafono"
          src={FLYER_ASSETS.aquafono}
        />
      </footer>
    </article>
  );
}
