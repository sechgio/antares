import type { FlyerRecord } from "./types";
import pcmVivienda from "../../assets/vgen-assets/PCM-Vivienda.webp";
import logoSedapal from "../../assets/vgen-assets/logo_sedapal.webp";
import logoAcciona from "../../assets/vgen-assets/logo_acciona.webp";
import aquafono from "../../assets/vgen-assets/aquafono.webp";
import grifo from "../../assets/vgen-assets/grifo.webp";

export const REQUIRED_COLUMNS = [
  "distrito",
  "fecha",
  "hora_inicio",
  "hora_fin",
  "reservorio"
] as const;

export const SAMPLE_RECORDS: FlyerRecord[] = [
  {
    id: "demo-1",
    distrito: "ATE VITARTE",
    fecha: "2026-02-26",
    horaInicio: "08:00",
    horaFin: "20:00",
    reservorio: "CR-121 HUASCAR",
    sector: "SECTOR 411",
    zonasAfectadas:
      "AH UPIS Huascar, AH Belen, CE Fe y Alegria N 25, AH Vista Alegre, AH 19 de Abril, AH Jorge Chavez, AH San Lorenzo, AH Las Terrazas, AH Panorama 3 de Julio, Agrup Monte de Los Olivos."
  },
  {
    id: "demo-2",
    distrito: "SAN JUAN DE LURIGANCHO",
    fecha: "2026-04-05",
    horaInicio: "07:30",
    horaFin: "18:00",
    reservorio: "RAP-01 ALTA PALOMA",
    sector: "SECTOR 403",
    zonasAfectadas:
      "AH Alta Paloma Ampliacion, AH Villa Los Andes, AH Chaparral, AF Las Flores, AH 3 de Mayo, AH Alta Paloma, AH Los Higales."
  },
  {
    id: "demo-3",
    distrito: "HUASCAR",
    fecha: "2026-04-07",
    horaInicio: "09:00",
    horaFin: "17:30",
    reservorio: "R-2A BELEN",
    sector: "SECTOR BRISAS DE HUASCAR",
    zonasAfectadas:
      "AH Belen, AH Senor de Los Milagros Parcela A, AH Vista Alegre, AF Santa Patricia, AH El Progreso, AH Virgen del Carmen, Agrup Tarapaca, Agrup Utupara."
  }
];

export const DEFAULT_BRAND = {
  logoIzquierdo: pcmVivienda,
  logoDerecho: logoSedapal,
} as const;

export const FLYER_ASSETS = {
  footerLogo: logoAcciona,
  aquafono: aquafono,
  grifo: grifo,
} as const;
