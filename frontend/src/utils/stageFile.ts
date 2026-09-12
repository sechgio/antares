const STAGE_CHUNK_BYTES = 6 * 1024 * 1024;

// Electron expires staged capabilities after 30 minutes.
const SHARED_TOKEN_MAX_AGE_MS = 20 * 60 * 1000;

// Consecutive render batches can reuse the upload for two minutes.
const SHARED_TOKEN_IDLE_MS = 2 * 60 * 1000;

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

export function cleanupStagedToken(token: string): void {
  if (typeof window === 'undefined') return;
  const api = (window as unknown as { electronAPI?: { cleanupFileToken?: (value: string) => Promise<unknown> } }).electronAPI;
  if (typeof api?.cleanupFileToken === 'function') {
    void api.cleanupFileToken(token);
  }
}

/** Handle over a staged copy. `release()` must be called exactly once. */
export type StagedFileHandle = {
  /** Read capability for the staged copy, or `null` when staging is unavailable. */
  readonly token: string | null;
  /** Drops this caller's reference; the staged copy is deleted once idle. */
  release: () => void;
};

type SharedStagedEntry = {
  promise: Promise<string | null>;
  token: string | null;
  refs: number;
  stagedAt: number | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  disposed: boolean;
};

const sharedStagedByFile = new WeakMap<File, SharedStagedEntry>();

function disposeEntry(file: File, entry: SharedStagedEntry): void {
  if (entry.disposed) return;
  entry.disposed = true;
  if (entry.idleTimer !== null) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
  if (sharedStagedByFile.get(file) === entry) sharedStagedByFile.delete(file);
  if (entry.token) cleanupStagedToken(entry.token);
}

/** Shares one staged capability per File. Release the handle in cleanup or `finally`. */
export async function acquireStagedFile(file: File): Promise<StagedFileHandle> {
  let entry: SharedStagedEntry | undefined = sharedStagedByFile.get(file);
  if (entry?.disposed) entry = undefined;
  if (
    entry
    && entry.stagedAt !== null
    && Date.now() - entry.stagedAt > SHARED_TOKEN_MAX_AGE_MS
  ) {
    if (entry.refs === 0) {
      disposeEntry(file, entry);
    } else if (sharedStagedByFile.get(file) === entry) {
      // Still referenced: leave the entry for its holders, but stop handing
      // out a token past its absolute age.
      sharedStagedByFile.delete(file);
    }
    entry = undefined;
  }

  if (!entry) {
    entry = {
      promise: stageFileForIpc(file),
      token: null,
      refs: 0,
      stagedAt: null,
      idleTimer: null,
      disposed: false,
    };
    sharedStagedByFile.set(file, entry);
  } else if (entry.idleTimer !== null) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }

  entry.refs += 1;
  const shared = entry;

  try {
    shared.token = await shared.promise;
  } catch (error) {
    shared.refs -= 1;
    if (shared.refs <= 0) disposeEntry(file, shared);
    throw error;
  }
  if (shared.stagedAt === null) shared.stagedAt = Date.now();

  let released = false;
  return {
    token: shared.token,
    release: () => {
      if (released) return;
      released = true;
      shared.refs -= 1;
      if (shared.refs > 0 || shared.disposed) return;
      shared.idleTimer = setTimeout(() => {
        shared.idleTimer = null;
        disposeEntry(file, shared);
      }, SHARED_TOKEN_IDLE_MS);
    },
  };
}
