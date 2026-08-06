/** Excel/CSV parsing for Canvas generate mode (module-local, no Generador imports). */

export async function parseSpreadsheetFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const { api } = await import('../../../api');
  const win = window as unknown as { electronAPI?: { fileStagedCreate:(n:string,s:number)=>Promise<{token:string}>, fileStagedAppend:(t:string,c:string)=>Promise<unknown>, fileStagedComplete:(t:string)=>Promise<{file_token:string}> } };
  let fileToken: string|null = null;
  if (win.electronAPI?.fileStagedCreate) {
    const staged = await win.electronAPI.fileStagedCreate(file.name, file.size);
    const CHUNK = 6*1024*1024; const buf = await file.arrayBuffer(); const bytes=new Uint8Array(buf);
    for(let off=0; off<bytes.length; off+=CHUNK){ const chunk=bytes.slice(off, off+CHUNK); let binary=""; for(let i=0;i<chunk.length;i++) binary+=String.fromCharCode(chunk[i]); const b64=btoa(binary); await win.electronAPI.fileStagedAppend(staged.token,b64); }
    const done = await win.electronAPI.fileStagedComplete(staged.token); fileToken=done.file_token;
  }
  const res = await (api as unknown as { spreadsheetParse:(p:unknown)=>Promise<{sheets:{name:string,rows:unknown[][]}[]}> }).spreadsheetParse({ file_token: fileToken } as unknown as Record<string,unknown>);
  const sh = res.sheets[0]; if (!sh || !sh.rows.length) return { headers:[], rows:[] };
  const header = (sh.rows[0] as unknown[]).map(v=> String(v ?? ""));
  const rows: Record<string,string>[] = [];
  for(let i=1;i<sh.rows.length;i++){ const arr = sh.rows[i] as unknown[]; const obj:Record<string,string>={}; header.forEach((h,idx)=>{ obj[h]= arr[idx]==null? '' : String(arr[idx]); }); rows.push(obj); }
  return { headers: header, rows };
}

/** Match image filenames like `{recordId}-1.jpg` or `{recordId}_2.png`. */
export function matchesRecordId(filename: string, recordId: string): boolean {
  const base = filename.replace(/\.[^.]+$/, '');
  const id = String(recordId).trim();
  if (!id) return false;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(?:[-_]\\d+)?$`, 'i').test(base);
}

export function naturalSortByName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function buildRowData(
  row: Record<string, string>,
  mappings: Record<string, string>,
): Record<string, string> {
  const data: Record<string, string> = { ...row };
  for (const [fieldKey, column] of Object.entries(mappings)) {
    if (!column) continue;
    const value = row[column] ?? '';
    data[fieldKey] = value;
    data[fieldKey.toUpperCase()] = value;
  }
  return data;
}
