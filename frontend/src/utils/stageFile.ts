const STAGE_CHUNK_BYTES = 6 * 1024 * 1024;

type StagedElectronApi = {
  fileStagedCreate: (name: string, size: number) => Promise<{ token: string }>;
  fileStagedAppend: (token: string, chunk: ArrayBuffer | Uint8Array | string) => Promise<unknown>;
  fileStagedComplete: (token: string) => Promise<{ file_token: string }>;
  fileStagedAbort?: (token: string) => Promise<unknown>;
};

function getStagedApi(): StagedElectronApi | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: Partial<StagedElectronApi> }).electronAPI;
  if (!api?.fileStagedCreate || !api.fileStagedAppend || !api.fileStagedComplete) return null;
  return api as StagedElectronApi;
}

export function hasFileStagingBridge(): boolean {
  return getStagedApi() !== null;
}

export async function stageFileForIpc(file: File): Promise<string | null> {
  const api = getStagedApi();
  if (!api) return null;

  let stagedToken: string | null = null;
  try {
    const staged = await api.fileStagedCreate(file.name, file.size);
    stagedToken = staged.token;
    const buf = await file.arrayBuffer();
    for (let off = 0; off < buf.byteLength; off += STAGE_CHUNK_BYTES) {
      const end = Math.min(off + STAGE_CHUNK_BYTES, buf.byteLength);
      await api.fileStagedAppend(staged.token, buf.slice(off, end));
    }
    const done = await api.fileStagedComplete(staged.token);
    return done.file_token;
  } catch (error) {
    if (stagedToken && api.fileStagedAbort) {
      try {
        await api.fileStagedAbort(stagedToken);
      } catch {}
    }
    throw error;
  }
}
