import { describe, expect, it } from 'vitest';
import { informesV2Api } from './api';

describe('informes-v2 API', () => {
  it('keeps the report API focused on single reads and server-side consolidated rendering', () => {
    expect(informesV2Api).not.toHaveProperty('getMany');
    expect(informesV2Api).toHaveProperty('get');
    expect(informesV2Api).toHaveProperty('renderConsolidatedHtml');
  });
});
