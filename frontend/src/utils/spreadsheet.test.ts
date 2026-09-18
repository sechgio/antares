import { beforeEach, describe, expect, it, vi } from 'vitest';

const spreadsheetParse = vi.fn();
const stageFileForIpc = vi.fn();

vi.mock('../api', () => ({
  api: {
    spreadsheetParse: (...args: unknown[]) => spreadsheetParse(...args),
  },
}));

vi.mock('./stageFile', () => ({
  stageFileForIpc: (...args: unknown[]) => stageFileForIpc(...args),
}));

import { stageAndParseSpreadsheet } from './spreadsheet';

const file = (name: string) => new File(['x'], name);

describe('stageAndParseSpreadsheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stageFileForIpc.mockResolvedValue('token-123');
    spreadsheetParse.mockResolvedValue({ rows: [] });
  });

  it.each(['xlsx', 'xls', 'csv'])('pasa format_hint=%s para .%s', async (ext) => {
    await stageAndParseSpreadsheet(file(`datos.${ext.toUpperCase()}`));
    expect(spreadsheetParse).toHaveBeenCalledWith(
      { file_token: 'token-123', format_hint: ext },
      undefined,
    );
  });

  it('omite format_hint para extensiones no tabulares', async () => {
    await stageAndParseSpreadsheet(file('foto.png'));
    expect(spreadsheetParse).toHaveBeenCalledWith(
      { file_token: 'token-123', format_hint: undefined },
      undefined,
    );
  });

  it('archivo sin extensión → sin format_hint', async () => {
    await stageAndParseSpreadsheet(file('datos'));
    expect(spreadsheetParse.mock.calls[0][0].format_hint).toBeUndefined();
  });

  it('reenvía las options (hydrate) al parse', async () => {
    await stageAndParseSpreadsheet(file('a.csv'), { hydrate: true });
    expect(spreadsheetParse).toHaveBeenCalledWith(expect.anything(), { hydrate: true });
  });

  it('propaga el token de staging y sus errores', async () => {
    stageFileForIpc.mockRejectedValue(new Error('staging falló'));
    await expect(stageAndParseSpreadsheet(file('a.csv'))).rejects.toThrow('staging falló');
    expect(spreadsheetParse).not.toHaveBeenCalled();
  });
});
