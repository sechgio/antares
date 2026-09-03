export type { FieldSpec } from './presets/helpers';

import { createCertLugoPreset, createCertSjlBlancoPreset, createCertSjlGuardaminoPreset } from './presets/certificates';
import { createFormatEtapasPreset } from './presets/etapas';
import {
  createAniegosChorrillosPreset,
  createEmergenciasPreset,
  createEvidenciaVolanteoPreset,
  createMaquinaBaldePreset,
  createPanelAvisoCortePreset,
  createPanelVolanteoPreset,
  createReportPreset,
  createVolanMaqBaldeSjlPreset,
} from './presets/panels';
import {
  createFormatReservoriosPreset,
  createPanelReservoriosPreset,
  createReservoriosLuriganchoSgioPreset,
  createReservoriosLuriganchoV2Preset,
  createReservoriosVillaSunassPreset,
} from './presets/reservorios';
import type { CanvasDocument } from './types';

export {
  createAniegosChorrillosPreset,
  createCertLugoPreset,
  createCertSjlBlancoPreset,
  createCertSjlGuardaminoPreset,
  createEmergenciasPreset,
  createEvidenciaVolanteoPreset,
  createFormatEtapasPreset,
  createFormatReservoriosPreset,
  createMaquinaBaldePreset,
  createPanelAvisoCortePreset,
  createPanelReservoriosPreset,
  createPanelVolanteoPreset,
  createReportPreset,
  createReservoriosLuriganchoSgioPreset,
  createReservoriosLuriganchoV2Preset,
  createReservoriosVillaSunassPreset,
  createVolanMaqBaldeSjlPreset,
};

export const CANVAS_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  create: (name?: string) => CanvasDocument;
}> = [
  { id: 'report', label: 'Panel fotográfico', create: createReportPreset },
  { id: 'emergencias', label: 'Emergencias', create: createEmergenciasPreset },
  { id: 'format-reservorios', label: 'Formato reservorios', create: createFormatReservoriosPreset },
  { id: 'panel-reservorios', label: 'Panel reservorios', create: createPanelReservoriosPreset },
  { id: 'format-etapas', label: 'Etapas de trabajo', create: createFormatEtapasPreset },
  { id: 'cert-lugo', label: 'Certificado Sanidad Lugo', create: createCertLugoPreset },
  { id: 'cert-sjl-blanco', label: 'Certificado SJL Blanco', create: createCertSjlBlancoPreset },
  { id: 'cert-sjl-guardamino', label: 'Certificado SJL Guardamino', create: createCertSjlGuardaminoPreset },
  { id: 'panel-aviso-corte', label: 'Panel aviso de corte', create: createPanelAvisoCortePreset },
  { id: 'panel-volanteo', label: 'Panel volanteo', create: createPanelVolanteoPreset },
  { id: 'evidencia-volanteo', label: 'Evidencia volanteo', create: createEvidenciaVolanteoPreset },
  { id: 'maquina-balde', label: 'Máquina balde', create: createMaquinaBaldePreset },
  { id: 'volan-maq-balde-sjl', label: 'Volanteo máq. balde SJL', create: createVolanMaqBaldeSjlPreset },
  { id: 'aniegos-chorrillos', label: 'Aniegos Chorrillos', create: createAniegosChorrillosPreset },
  { id: 'reservorios-lurigancho-v2', label: 'Reservorios Lurigancho v2', create: createReservoriosLuriganchoV2Preset },
  { id: 'reservorios-lurigancho-sgio', label: 'Reservorios Lurigancho SGIO', create: createReservoriosLuriganchoSgioPreset },
  { id: 'reservorios-villa-sunass', label: 'Reservorios Villa SUNASS', create: createReservoriosVillaSunassPreset },
];
