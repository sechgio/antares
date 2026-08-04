import {
  DIAMETERS,
  LINEA_ROWS,
  VALVULA_ROWS,
  emptyDiameterRow,
  type InformeV2,
} from './types';

export function createEmptyClientReport(informeId: number): InformeV2 {
  const valvulas = Object.fromEntries(VALVULA_ROWS.map((key) => [key, emptyDiameterRow()]));
  const linea = Object.fromEntries(LINEA_ROWS.map((key) => [key, emptyDiameterRow()]));
  return {
    id: `IV2-${String(informeId).padStart(4, '0')}`,
    metadata: { informe_id: informeId },
    header: {
      photo_id: '',
      estacion: '',
      tipo: 'ELEVADO',
      volumen: 0,
      ubicacion: '',
      distrito: '',
      fecha_ejecucion: '',
      suministro: '',
      sgio: '',
    },
    valvulas,
    linea,
    medidas: {
      largo: '',
      ancho: '',
      diametro: '',
      altura_rebose: '',
      altura_total: '',
      tirante_limpieza: '',
      observacion: '',
    },
    status: 'draft',
    last_modified: '',
  };
}

export { DIAMETERS };
