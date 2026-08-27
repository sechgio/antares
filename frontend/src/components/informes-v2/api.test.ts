import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { InformeV2, InformeV2ListItem } from './types';
import { informesV2Api } from './api';

function listItems(count: number): InformeV2ListItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `IV2-${String(index + 1).padStart(4, '0')}`,
    metadata: { informe_id: index + 1 },
    header: { photo_id: '', estacion: '', suministro: '', distrito: '' },
    status: 'draft',
  }));
}

describe('informes-v2 API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads consolidated reports without exceeding four concurrent reads', async () => {
    let active = 0;
    let maxActive = 0;
    vi.spyOn(api, 'informesV2Get').mockImplementation(async (id: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return { report: { id } as unknown as InformeV2 };
    });

    const items = listItems(39);
    const reports = await informesV2Api.getMany(items);

    expect(reports.map((report) => report.id)).toEqual(items.map((item) => item.id));
    expect(maxActive).toBeLessThanOrEqual(4);
  });
});
