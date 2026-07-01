import { describe, it, expect } from 'vitest';
import { chunkArray, IMAGES_PER_PAGE } from '../constants';
import { sessionToStored, storedToSession } from './storage';
import type { EvidenciaSession } from '../types';

describe('evidencia-volanteo storage', () => {
  it('round-trips session metadata without images', () => {
    const session: EvidenciaSession = {
      title: 'EVIDENCIAS TEST',
      cuadranteRanges: [{ id: 'r1', fromPage: 1, toPage: 1, cuadrante: 'CHORRILLOS' }],
      logoLeft: null,
      logoRight: null,
      images: [],
      updatedAt: 1,
    };
    const stored = sessionToStored(session);
    const restored = storedToSession(stored);
    expect(restored.title).toBe(session.title);
    expect(restored.cuadranteRanges[0].cuadrante).toBe('CHORRILLOS');
    expect(restored.images).toHaveLength(0);
  });

  it('chunks images into pages of six', () => {
    const items = Array.from({ length: 7 }, (_, i) => i + 1);
    const pages = chunkArray(items, IMAGES_PER_PAGE);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(6);
    expect(pages[1]).toHaveLength(1);
  });
});