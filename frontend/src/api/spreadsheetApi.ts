import { _invoke } from './core';

export const spreadsheetApi = {
  spreadsheetParse: async (
    body: { file_token?: string | null; path?: string; format_hint?: string },
    opts?: { hydrate?: boolean },
  ) => {
    const res = await _invoke<{
      workbookName: string;
      sheets: Array<{ name: string; rows: unknown[][] }>;
      warnings: string[];
      result_file_token?: string;
      sheet_meta?: Array<{ name: string; rowCount: number }>;
    }>('spreadsheet_parse', body as unknown as Record<string, unknown>);
    if (!res.result_file_token) return res;
    if (opts?.hydrate === false) {
      return res;
    }
    if (res.sheet_meta?.length) {
      const sheets: Array<{ name: string; rows: unknown[][] }> = [];
      try {
        for (let sheetIndex = 0; sheetIndex < res.sheet_meta.length; sheetIndex += 1) {
          const meta = res.sheet_meta[sheetIndex];
          const rows: unknown[][] = [];
          let offset = 0;
          let hasMore = meta.rowCount > 0;
          while (hasMore) {
            const page = await _invoke<{
              name: string;
              rows: unknown[][];
              offset: number;
              limit: number;
              total: number;
              has_more: boolean;
            }>('spreadsheet_get_rows', {
              result_file_token: res.result_file_token,
              sheet_index: sheetIndex,
              offset,
              limit: 5000,
            });
            rows.push(...page.rows);
            offset += page.rows.length;
            hasMore = page.has_more && page.rows.length > 0;
          }
          sheets.push({ name: meta.name, rows });
        }
      } finally {
        await _invoke('file_token_cleanup', { token: res.result_file_token }).catch(() => undefined);
      }
      return {
        workbookName: res.workbookName,
        sheets,
        warnings: res.warnings || [],
      };
    }
    const spilled = await _invoke<{
      workbookName: string;
      sheets: Array<{ name: string; rows: unknown[][] }>;
      warnings: string[];
    }>('file_token_read_json', { token: res.result_file_token });
    return {
      workbookName: spilled.workbookName || res.workbookName,
      sheets: spilled.sheets || [],
      warnings: [...(res.warnings || []), ...(spilled.warnings || [])],
      result_file_token: res.result_file_token,
      sheet_meta: res.sheet_meta,
    };
  },
  spreadsheetGetRows: (body: {
    result_file_token?: string;
    cache_token?: string;
    sheet?: string;
    sheet_index?: number;
    offset?: number;
    limit?: number;
  }) =>
    _invoke<{
      name: string;
      rows: unknown[][];
      offset: number;
      limit: number;
      total: number;
      has_more: boolean;
    }>('spreadsheet_get_rows', body as unknown as Record<string, unknown>),
  fileTokenCleanup: (token: string) =>
    _invoke<{ cleaned: boolean }>('file_token_cleanup', { token }),
  spreadsheetExportVolantesTemplate: (body?: { output_path?: string }) =>
    _invoke<{ content_b64: string; filename: string; path?: string }>('spreadsheet_export_volantes_template', (body || {}) as unknown as Record<string, unknown>),
};
