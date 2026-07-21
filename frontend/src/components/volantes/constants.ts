import pcmVivienda from "../../assets/volanteo-assets/PCM-Vivienda.webp";
import logoSedapal from "../../assets/volanteo-assets/logo_sedapal.webp";
import logoAcciona from "../../assets/volanteo-assets/logo_acciona.webp";
import aquafono from "../../assets/volanteo-assets/aquafono.webp";
import grifo from "../../assets/volanteo-assets/grifo.webp";

export const REQUIRED_COLUMNS = [
  "distrito",
  "fecha",
  "hora_inicio",
  "hora_fin",
  "reservorio"
] as const;

export const DEFAULT_BRAND = {
  logoIzquierdo: pcmVivienda,
  logoDerecho: logoSedapal,
} as const;

export const DEFAULT_HEADING = {
  titulo: "Trabajos de mejoramiento",
  subtitulo: "del reservorio de agua potable",
} as const;

export const DEFAULT_ENCABEZADOS = {
  limpiezaReservorios: "LIMPIEZA DE RESERVORIOS:",
  zonasAfectadas: "Zonas afectadas:",
  detalleZonas: "Detalle de zonas o cuadrante afectado",
} as const;

export const FLYER_ASSETS = {
  footerLogo: logoAcciona,
  aquafono: aquafono,
  grifo: grifo,
} as const;
