import { createLayer } from '../constants';
import type { CanvasDocument, CanvasLayer } from '../types';
import { mm, newId } from '../types';
import {
  baseFrame,
  docFrom,
  fieldLayer,
  logoSlot,
  textLayer,
  uniqueKeys,
  type FieldSpec,
} from './helpers';

const PAD_X = 25;
const PAD_Y = 20;

type Signer = { role: string; name: string; cip: string };

function labelFieldRow(
  layers: CanvasLayer[],
  label: string,
  key: string,
  y: number,
  labelW = 38,
  fieldW = 122,
): void {
  layers.push(
    textLayer({
      name: `Label ${label}`,
      value: label,
      x: PAD_X,
      y,
      w: labelW,
      fontSize: '11pt',
    }),
  );
  layers.push(
    textLayer({
      name: `Sep ${label}`,
      value: ':',
      x: PAD_X + labelW,
      y,
      w: 4,
      fontSize: '11pt',
    }),
  );
  layers.push(
    fieldLayer({
      key,
      label,
      x: PAD_X + labelW + 5,
      y,
      w: fieldW,
      h: 6,
      fontSize: '11pt',
    }),
  );
}

function serviceOption(
  layers: CanvasLayer[],
  letter: string,
  label: string,
  key: string,
  x: number,
  y: number,
): void {
  layers.push(
    textLayer({
      name: `Servicio ${letter}`,
      value: `${letter}) ${label} (`,
      x,
      y,
      w: 62,
      fontSize: '10pt',
    }),
  );
  layers.push(
    fieldLayer({
      key,
      label,
      x: x + 62,
      y,
      w: 10,
      h: 5,
      fontSize: '10pt',
      dotted: true,
    }),
  );
  layers.push(
    textLayer({
      name: `Servicio ${letter} cierre`,
      value: ')',
      x: x + 73,
      y,
      w: 4,
      fontSize: '10pt',
    }),
  );
}

function signatureBlock(
  layers: CanvasLayer[],
  signer: Signer,
  x: number,
  y: number,
  w = 70,
): void {
  layers.push({
    id: newId(),
    type: 'line',
    name: `Línea firma ${signer.role}`,
    value: '',
    pageIndex: 0,
    cssVars: {
      '--width': mm(w),
      '--height': mm(0.5),
      '--translate-x': mm(x),
      '--translate-y': mm(y),
      '--background-color': 'transparent',
      '--fill-visible': '0',
      '--border-width': '1px',
      '--border-color': '#000000',
      '--stroke-align': 'center',
      '--stroke-visible': '1',
      '--stroke-opacity': '100',
    },
  });
  layers.push(
    textLayer({
      name: `Rol ${signer.role}`,
      value: signer.role,
      x,
      y: y + 4,
      w,
      fontSize: '10pt',
      fontWeight: '700',
      align: 'center',
    }),
  );
  layers.push(
    textLayer({
      name: `Nombre ${signer.name}`,
      value: signer.name,
      x,
      y: y + 9,
      w,
      fontSize: '10pt',
      align: 'center',
    }),
  );
  layers.push(
    textLayer({
      name: `CIP ${signer.cip}`,
      value: `CIP: ${signer.cip}`,
      x,
      y: y + 14,
      w,
      fontSize: '10pt',
      align: 'center',
    }),
  );
}

function createCertificadoFamily(name: string, leftSigner: Signer): CanvasDocument {
  const layers: CanvasLayer[] = [baseFrame()];
  layers.push(logoSlot({ side: 'left', x: PAD_X, y: PAD_Y, w: 55, h: 25 }));

  layers.push(
    textLayer({
      name: 'Empresa',
      value: 'HIDROSERVICIOS AA E.I.R.L – RUC: 20606864192',
      x: 95,
      y: PAD_Y,
      w: 90,
      h: 5,
      fontSize: '9pt',
      fontWeight: '700',
      color: '#228B22',
    }),
  );
  layers.push(
    textLayer({
      name: 'Dirección empresa',
      value: 'Mz J1 lote 20. Urb. Los Precursores. Surco. Lima',
      x: 95,
      y: PAD_Y + 5,
      w: 90,
      h: 5,
      fontSize: '9pt',
      fontWeight: '700',
      color: '#228B22',
    }),
  );
  layers.push(
    textLayer({
      name: 'Teléfono empresa',
      value: '946803367',
      x: 95,
      y: PAD_Y + 10,
      w: 90,
      h: 5,
      fontSize: '9pt',
      fontWeight: '700',
      color: '#228B22',
    }),
  );

  const titleY = PAD_Y + 32;
  layers.push(
    textLayer({
      name: 'Título certificado',
      value: 'CERTIFICADO N°',
      x: 55,
      y: titleY,
      w: 50,
      h: 8,
      fontSize: '13pt',
      fontWeight: '700',
      align: 'right',
    }),
  );
  layers.push(
    fieldLayer({
      key: 'NUMERO CERTIFICADO',
      label: 'Número certificado',
      x: 107,
      y: titleY,
      w: 35,
      h: 7,
      fontSize: '13pt',
    }),
  );

  layers.push(
    textLayer({
      name: 'Introducción',
      value:
        'Por el presente certificamos que se han realizado los servicios de saneamiento ambiental correspondiente a:',
      x: PAD_X,
      y: titleY + 12,
      w: 160,
      h: 14,
      fontSize: '11pt',
      align: 'left',
    }),
  );

  const servicesY = titleY + 28;
  serviceOption(layers, 'a', 'Desinfección', 'A', PAD_X, servicesY);
  serviceOption(layers, 'b', 'Limpieza y desinfección de Reservorios de agua', 'B', PAD_X + 82, servicesY);
  serviceOption(layers, 'c', 'Limpieza de pozos sépticos', 'C', PAD_X, servicesY + 8);
  serviceOption(layers, 'd', 'Limpieza de ambientes', 'D', PAD_X + 82, servicesY + 8);

  const infoStartY = servicesY + 22;
  const infoFields: FieldSpec[] = [];
  const infoRows: Array<{ label: string; key: string }> = [
    { label: 'NOMBRE', key: 'NOMBRE' },
    { label: 'RUC', key: 'RUC' },
    { label: 'DIRECCIÓN', key: 'DIRECCION' },
    { label: 'GIRO', key: 'GIRO' },
    { label: 'ÁREA TRATADA', key: 'AREA TRATADA' },
    { label: 'FECHA DEL SERVICIO', key: 'FECHA' },
  ];
  infoRows.forEach((row, index) => {
    const y = infoStartY + index * 8;
    labelFieldRow(layers, row.label, row.key, y);
    infoFields.push({ key: row.key, label: row.label, x: PAD_X, y, w: 160 });
  });

  const serviceFields: FieldSpec[] = [
    { key: 'A', label: 'Desinfección', x: PAD_X, y: servicesY, w: 10 },
    { key: 'B', label: 'Reservorios', x: PAD_X + 82, y: servicesY, w: 10 },
    { key: 'C', label: 'Pozos sépticos', x: PAD_X, y: servicesY + 8, w: 10 },
    { key: 'D', label: 'Ambientes', x: PAD_X + 82, y: servicesY + 8, w: 10 },
  ];
  const certFields: FieldSpec[] = [
    { key: 'NUMERO CERTIFICADO', label: 'Número certificado', x: 107, y: titleY, w: 35 },
    ...serviceFields,
    ...infoFields,
  ];

  signatureBlock(layers, leftSigner, PAD_X + 5, 220);
  signatureBlock(layers, {
    role: 'Gerente General',
    name: 'Ing. Sixto David Purizaca Cruz',
    cip: '157948',
  }, PAD_X + 90, 220);

  layers.push(
    createLayer('signature', {
      name: 'Firma técnico',
      pageIndex: 0,
      cssVars: {
        '--width': mm(55),
        '--height': mm(18),
        '--translate-x': mm(PAD_X + 12),
        '--translate-y': mm(200),
        '--background-color': 'transparent',
      },
      meta: { key: 'FIRMA_TECNICO' },
    }),
  );
  layers.push(
    createLayer('signature', {
      name: 'Firma gerente',
      pageIndex: 0,
      cssVars: {
        '--width': mm(55),
        '--height': mm(18),
        '--translate-x': mm(PAD_X + 97),
        '--translate-y': mm(200),
        '--background-color': 'transparent',
      },
      meta: { key: 'FIRMA_GERENTE' },
    }),
  );

  return docFrom(name, layers, [...uniqueKeys(certFields), 'FIRMA_TECNICO', 'FIRMA_GERENTE']);
}

export function createCertLugoPreset(): CanvasDocument {
  return createCertificadoFamily('Certificado Lugo', {
    role: 'Director técnico',
    name: 'Ing. Jimmy Juan Lugo Mena',
    cip: '143506',
  });
}

export function createCertSjlBlancoPreset(): CanvasDocument {
  return createCertificadoFamily('Certificado SJL Blanco', {
    role: 'Ingeniero Sanitario',
    name: 'Ing. Carlos Manuel Blanco Pareja',
    cip: '92706',
  });
}

export function createCertSjlGuardaminoPreset(): CanvasDocument {
  return createCertificadoFamily('Certificado SJL Guardamino', {
    role: 'Ingeniero Sanitario',
    name: 'Ing. Walter Benito Guardamino Estacio',
    cip: '68013',
  });
}
