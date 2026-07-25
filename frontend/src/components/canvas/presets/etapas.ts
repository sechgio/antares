import type { CanvasDocument, CanvasLayer } from '../types';
import { mm, newId } from '../types';
import {
  addFields,
  baseFrame,
  docFrom,
  dualLogos,
  textLayer,
  uniqueKeys,
  type FieldSpec,
} from './helpers';

const PAD = 8;
const PHOTO_W = 94;
const PHOTO_H = 95;
const COL1 = PAD;
const COL2 = PAD + PHOTO_W + 6;

const ETAPAS_FIELDS: FieldSpec[] = [
  { key: 'ZONAL', label: 'Zonal', x: 58, y: 12, w: 94 },
  { key: 'NAME ACTIVITY', label: 'Actividad', x: PAD, y: 34, w: 194 },
  { key: 'CODIGO BUZON', label: 'Código buzón', x: PAD + 44, y: 44, w: 80 },
  { key: 'CONTRATISTA', label: 'Contratista', x: 100, y: 284, w: 42 },
  { key: 'CONTRATA', label: 'Contrata', x: 178, y: 284, w: 24 },
];

const PHOTO_LABELS = ['ANTES', 'DURANTE', 'DESPUES', 'RESIDUOS'] as const;

function addEtapasPhotoSlot(
  layers: CanvasLayer[],
  label: string,
  x: number,
  y: number,
  index: number,
): void {
  layers.push({
    id: newId(),
    type: 'imageSlot',
    name: `Foto ${label}`,
    value: '',
    pageIndex: 0,
    cssVars: {
      '--width': mm(PHOTO_W),
      '--height': mm(PHOTO_H),
      '--translate-x': mm(x),
      '--translate-y': mm(y),
      '--background-color': '#f5f5f5',
      '--border-width': '1px',
      '--border-color': '#cccccc',
      '--object-fit': 'contain',
    },
    meta: { index },
  });
  layers.push(
    textLayer({
      name: `Label ${label}`,
      value: label,
      x,
      y: y + PHOTO_H + 2,
      w: PHOTO_W,
      h: 6,
      fontSize: '12pt',
      fontWeight: '700',
      align: 'center',
    }),
  );
}

export function createFormatEtapasPreset(name = 'Formato etapas'): CanvasDocument {
  const layers: CanvasLayer[] = [baseFrame(), ...dualLogos(PAD, 50, 18)];

  layers.push(
    textLayer({
      name: 'Label ZONAL',
      value: 'ZONAL :',
      x: 58,
      y: 10,
      w: 20,
      h: 8,
      fontSize: '14pt',
      fontWeight: '700',
      align: 'center',
    }),
  );
  layers.push(
    {
      id: newId(),
      type: 'field',
      name: 'Zonal',
      value: '',
      pageIndex: 0,
      cssVars: {
        '--width': mm(70),
        '--height': mm(7),
        '--translate-x': mm(78),
        '--translate-y': mm(12),
        '--color': '#222222',
        '--font-size': '14pt',
        '--font-weight': '700',
        '--background-color': 'transparent',
        '--border-width': '0',
        '--text-align': 'center',
      },
      meta: { key: 'ZONAL', fallback: '-' },
    },
  );

  layers.push(
    textLayer({
      name: 'Comilla apertura',
      value: '"',
      x: PAD + 4,
      y: 32,
      w: 4,
      h: 8,
      fontSize: '14pt',
      fontWeight: '700',
      align: 'center',
    }),
  );
  layers.push(
    {
      id: newId(),
      type: 'field',
      name: 'Actividad',
      value: '',
      pageIndex: 0,
      cssVars: {
        '--width': mm(182),
        '--height': mm(8),
        '--translate-x': mm(PAD + 10),
        '--translate-y': mm(34),
        '--color': '#222222',
        '--font-size': '14pt',
        '--font-weight': '700',
        '--background-color': 'transparent',
        '--border-width': '0',
        '--text-align': 'center',
      },
      meta: { key: 'NAME ACTIVITY', fallback: '-' },
    },
  );
  layers.push(
    textLayer({
      name: 'Comilla cierre',
      value: '"',
      x: PAD + 192,
      y: 32,
      w: 4,
      h: 8,
      fontSize: '14pt',
      fontWeight: '700',
      align: 'center',
    }),
  );

  layers.push(
    textLayer({
      name: 'Label código buzón',
      value: 'CODIGO DE BUZÓN:',
      x: PAD,
      y: 44,
      w: 42,
      h: 6,
      fontSize: '11pt',
      fontWeight: '700',
    }),
  );
  addFields(layers, ETAPAS_FIELDS.filter((f) => f.key === 'CODIGO BUZON'));

  const row1Y = 52;
  const row2Y = row1Y + PHOTO_H + 10;
  addEtapasPhotoSlot(layers, PHOTO_LABELS[0], COL1, row1Y, 0);
  addEtapasPhotoSlot(layers, PHOTO_LABELS[1], COL2, row1Y, 1);
  addEtapasPhotoSlot(layers, PHOTO_LABELS[2], COL1, row2Y, 2);
  addEtapasPhotoSlot(layers, PHOTO_LABELS[3], COL2, row2Y, 3);

  layers.push(
    textLayer({
      name: 'Pie panel',
      value: 'Panel fotográfico',
      x: PAD,
      y: 284,
      w: 50,
      h: 6,
      fontSize: '12pt',
      color: '#1800ad',
    }),
  );
  addFields(layers, [{ key: 'CONTRATISTA', label: 'Contratista', x: 100, y: 284, w: 42 }]);
  layers.push(
    textLayer({
      name: 'Pie contrata texto',
      value: ', trabajando para',
      x: 143,
      y: 284,
      w: 36,
      h: 6,
      fontSize: '12pt',
      color: '#1800ad',
    }),
  );
  addFields(layers, [{ key: 'CONTRATA', label: 'Contrata', x: 178, y: 284, w: 24 }]);

  return docFrom(name, layers, uniqueKeys(ETAPAS_FIELDS));
}
