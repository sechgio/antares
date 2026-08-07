/** Stage a File into a Main-process temp file and return a read capability token. */

const STAGE_CHUNK_BYTES = 6 * 1024 * 1024;

type StagedElectronApi = {
  fileStagedCreate: (name: string, size: number) => Promise<{ token: string }>;
  fileStagedAppend: (token: string, chunk: ArrayBuffer | Uint8Array | string) => Promise<unknown>;
  fileStagedComplete: (token: string) => Promise<{ file_token: string }>;
};

function getStagedApi(): StagedElectronApi | null {
  const api = (window as unknown as { electronAPI?: Partial<StagedElectronApi> }).electronAPI;
  if (!api?.fileStagedCreate || !api.fileStagedAppend || !api.fileStagedComplete) return null;
  return api as StagedElectronApi;
}

/**
 * Upload file bytes to Electron staging without base64.
 * Returns null when staging APIs are unavailable (non-Electron / tests).
 */
export async function stageFileForIpc(file: File): Promise<string | null> {
  const api = getStagedApi();
  if (!api) return null;

  const staged = await api.fileStagedCreate(file.name, file.size);
  const buf = await file.arrayBuffer();
  for (let off = 0; off < buf.byteLength; off += STAGE_CHUNK_BYTES) {
    const end = Math.min(off + STAGE_CHUNK_BYTES, buf.byteLength);
    // slice returns a copy ArrayBuffer — structured-clone safe, no shared buffer races.
    await api.fileStagedAppend(staged.token, buf.slice(off, end));
  }
  const done = await api.fileStagedComplete(staged.token);
  return done.file_token;
}
