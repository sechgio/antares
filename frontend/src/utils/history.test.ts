import { beforeEach, describe, expect, it, vi } from 'vitest';

const historySave = vi.fn();

vi.mock('../api', () => ({
  api: {
    historySave: (...args: unknown[]) => historySave(...args),
  },
}));

import { saveFeatureHistory } from './history';

describe('saveFeatureHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mapea runType/label/details/count al payload de historySave', async () => {
    await saveFeatureHistory('canvas_export', 'doc.pdf', { pages: 3 }, 2);
    expect(historySave).toHaveBeenCalledWith({
      run_type: 'canvas_export',
      files: ['doc.pdf'],
      options: { pages: 3 },
      formato: 'doc.pdf',
      patron: '',
      calidad: 0,
      resize: null,
      ok_count: 2,
      err_count: 0,
    });
  });

  it('count por defecto es 1', async () => {
    await saveFeatureHistory('t', 'x', {});
    expect(historySave.mock.calls[0][0].ok_count).toBe(1);
  });

  it('traga errores del backend sin propagar', async () => {
    historySave.mockRejectedValue(new Error('backend caído'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(saveFeatureHistory('t', 'x', {})).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('historySave failed', expect.any(Error));
    errorSpy.mockRestore();
  });
});
