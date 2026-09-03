import { describe, expect, it } from 'vitest';
import { CANVAS_PRESETS } from '../presets';

const EXPECTED_PRESETS = [
  { id: 'report', label: 'Panel fotográfico' },
  { id: 'emergencias', label: 'Emergencias' },
  { id: 'format-reservorios', label: 'Formato reservorios' },
  { id: 'panel-reservorios', label: 'Panel reservorios' },
  { id: 'format-etapas', label: 'Etapas de trabajo' },
  { id: 'cert-lugo', label: 'Certificado Sanidad Lugo' },
  { id: 'cert-sjl-blanco', label: 'Certificado SJL Blanco' },
  { id: 'cert-sjl-guardamino', label: 'Certificado SJL Guardamino' },
  { id: 'panel-aviso-corte', label: 'Panel aviso de corte' },
  { id: 'panel-volanteo', label: 'Panel volanteo' },
  { id: 'evidencia-volanteo', label: 'Evidencia volanteo' },
  { id: 'maquina-balde', label: 'Máquina balde' },
  { id: 'volan-maq-balde-sjl', label: 'Volanteo máq. balde SJL' },
  { id: 'aniegos-chorrillos', label: 'Aniegos Chorrillos' },
  { id: 'reservorios-lurigancho-v2', label: 'Reservorios Lurigancho v2' },
  { id: 'reservorios-lurigancho-sgio', label: 'Reservorios Lurigancho SGIO' },
  { id: 'reservorios-villa-sunass', label: 'Reservorios Villa SUNASS' },
] as const;

describe('CANVAS_PRESETS from backend/templates root', () => {
  it('lists exactly the 17 root-template presets (no ficha/informe)', () => {
    expect(CANVAS_PRESETS.map((p) => p.id)).toEqual(EXPECTED_PRESETS.map((p) => p.id));
    expect(CANVAS_PRESETS.map((p) => p.label)).toEqual(EXPECTED_PRESETS.map((p) => p.label));
  });

  it.each(EXPECTED_PRESETS)('$id creates A4 doc with frame and expected structure', ({ id }) => {
    const preset = CANVAS_PRESETS.find((p) => p.id === id);
    expect(preset).toBeTruthy();
    const doc = preset!.create();
    expect(doc.page).toEqual({ widthMm: 210, heightMm: 297 });
    expect(doc.pages).toHaveLength(1);
    expect(doc.layers.some((l) => l.type === 'frame')).toBe(true);

    const isCert = id.startsWith('cert-');
    if (isCert) {
      expect(doc.layers.some((l) => l.type === 'signature')).toBe(true);
      expect(doc.layers.some((l) => l.type === 'logo')).toBe(true);
      expect(doc.layers.filter((l) => l.type === 'imageSlot')).toHaveLength(0);
    } else {
      expect(doc.layers.some((l) => l.type === 'logo')).toBe(true);
      expect(doc.layers.some((l) => l.type === 'imageSlot')).toBe(true);
      expect(doc.layers.some((l) => l.type === 'field' || l.type === 'text')).toBe(true);
    }
  });
});
