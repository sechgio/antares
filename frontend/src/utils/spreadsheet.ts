export type SpreadsheetParseResult = Awaited<ReturnType<typeof import('../api').api.spreadsheetParse>>;

export async function stageAndParseSpreadsheet(
  file: File,
  options?: { hydrate?: boolean },
): Promise<SpreadsheetParseResult> {
  const { api } = await import('../api');
  const { stageFileForIpc } = await import('./stageFile');
  const ext = file.name.toLowerCase().split('.').pop() || '';
  const formatHint = ['xlsx', 'xls', 'csv'].includes(ext) ? ext : undefined;
  const fileToken = await stageFileForIpc(file);
  return api.spreadsheetParse({ file_token: fileToken, format_hint: formatHint }, options);
}
