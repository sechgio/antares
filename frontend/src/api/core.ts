import ipcMethodCatalog from '../../../shared/ipc-method-catalog.json';
import { errorMessage } from '@/utils/errors';
import { reportFrontendError } from '../utils/observability';

declare global {
  interface Window {
    electronAPI?: {
      invoke: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
      backendStatus: () => Promise<{ state: string; ready: boolean; lastError: { kind: string; message: string; stderrTail: string } | null; stderrTail: string }>;
      backendRestart: () => Promise<{ success: boolean; state: string }>;
      onNotify: (callback: (method: string, params: unknown) => void) => () => void;
      minimizeWindow: () => Promise<unknown>;
      maximizeWindow: () => Promise<unknown>;
      closeWindow: () => Promise<unknown>;
      showAppMenu: (menuIndex: number, position: { x: number; y: number }) => Promise<unknown>;
      autoUpdateCheck: () => Promise<{ success: boolean; reason?: string }>;
      autoUpdateInstall: () => Promise<{ success: boolean; reason?: string }>;
      onAutoUpdateStatus: (callback: (data: { status: string; version: string | null; progress: number; message?: string }) => void) => () => void;
      getPathForFile: (file: File) => string;
      canvasFlushAck?: () => Promise<unknown>;
      fileStagedCreate?: (name: string, size: number) => Promise<{ token: string }>;
      fileStagedAppend?: (token: string, chunk: ArrayBuffer | Uint8Array | string) => Promise<unknown>;
      fileStagedComplete?: (token: string) => Promise<{ file_token: string }>;
      fileStagedAbort?: (token: string) => Promise<unknown>;
      resolveFileToken?: (token: string) => Promise<{ path: string; name?: string; size?: number }>;
      cleanupFileToken?: (token: string) => Promise<{ cleaned: boolean }>;
      canvasAssetPut?: (chunk: ArrayBuffer | Uint8Array) => Promise<{ asset_id: string; ref: string; bytes: number }>;
      canvasAssetGet?: (ref: string) => Promise<{ ref: string; chunk: ArrayBuffer; bytes: number }>;
      canvasAssetInfo?: (ref: string) => Promise<{ ref: string; asset_id: string; bytes: number }>;
      reportRendererError?: (report: Record<string, unknown>) => Promise<unknown>;
      reportRendererEvent?: (event: string, fields?: Record<string, unknown>, level?: string) => void;
    };
  }
}

type IpcTimeoutTier = keyof typeof ipcMethodCatalog.timeouts;
const IPC_METHOD_TIMEOUTS: Record<IpcTimeoutTier, number> = ipcMethodCatalog.timeouts;
const IPC_METHOD_ENTRIES = ipcMethodCatalog.methods as Record<string, { timeout?: IpcTimeoutTier; handler?: string }>;
const FE_STARTUP_BUFFER_MS = 60_000;
const FE_TIMEOUT_BUFFER_MS = 10_000;
// El buffer de startup solo cubre el cold-start del backend: tras el primer
// invoke exitoso deja de aplicar y los tiers del catálogo mandan.
let _backendSeenReady = false;

export function _resetBackendReadyForTests(): void {
  _backendSeenReady = false;
}

export type APIErrorCategory =
  | 'INTERNAL_ERROR'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'RESOURCE_LOCKED'
  | 'TIMEOUT'
  | 'MEMORY_PRESSURE'
  | 'CAPACITY_EXCEEDED'
  | 'INVALID_REQUEST'
  | 'METHOD_NOT_FOUND'
  | 'AUTHENTICATION_ERROR'
  | 'RENDERING_ERROR';

export class AntaresAPIError extends Error {
  code: number;
  category: APIErrorCategory | string;
  details?: Record<string, unknown>;
  requestId?: string;

  constructor(message: string, code = -32000, category: APIErrorCategory | string = 'INTERNAL_ERROR', details?: Record<string, unknown>, requestId?: string) {
    super(message);
    this.name = 'AntaresAPIError';
    this.code = code;
    this.category = category;
    this.details = details;
    this.requestId = requestId;
  }
}

const RETRYABLE_DEFAULT_DELAY_MS = 2_000;
const RETRY_AFTER_CAP_MS = 60_000;

// Delay hint for rejections the backend/Electron raised before executing the
// request (memory pressure, queue capacity), so retrying is safe regardless of
// method idempotency. Duck-typed: mocked errors in tests aren't class instances.
export function apiRetryAfterMs(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const rec = err as { category?: unknown; details?: unknown };
  const details =
    rec.details && typeof rec.details === 'object' && !Array.isArray(rec.details)
      ? (rec.details as Record<string, unknown>)
      : null;
  if (
    rec.category !== 'MEMORY_PRESSURE' &&
    rec.category !== 'CAPACITY_EXCEEDED' &&
    details?.retryable !== true
  ) {
    return null;
  }
  const ms = details?.retry_after_ms;
  if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) {
    return Math.min(Math.ceil(ms), RETRY_AFTER_CAP_MS);
  }
  return RETRYABLE_DEFAULT_DELAY_MS;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
type CacheEntry<T> =
  | { status: 'ok'; value: T; expires: number }
  | { status: 'pending'; promise: Promise<T> };
const _cache = new Map<string, CacheEntry<unknown>>();
const _cacheGenerations = new Map<string, number>();
export function cachedInvoke<T>(key: string, fn: () => Promise<T>, ttl = CACHE_TTL_MS): Promise<T> {
  const now = Date.now();
  const generation = _cacheGenerations.get(key) ?? 0;
  const hit = _cache.get(key);
  if (hit?.status === 'pending') return hit.promise as Promise<T>;
  if (hit?.status === 'ok' && hit.expires > now) return Promise.resolve(hit.value as T);
  const p = fn()
    .then((v) => {
      if ((_cacheGenerations.get(key) ?? 0) === generation) {
        _cache.set(key, { status: 'ok', value: v, expires: now + ttl });
      }
      return v;
    })
    .finally(() => {
      const e = _cache.get(key);
      if (e?.status === 'pending' && e.promise === p) _cache.delete(key);
    });
  _cache.set(key, { status: 'pending', promise: p });
  return p;
}
export function invalidateApiCache(key?: string) {
  if (key) {
    _cacheGenerations.set(key, (_cacheGenerations.get(key) ?? 0) + 1);
    _cache.delete(key);
    return;
  }
  for (const cacheKey of _cache.keys()) {
    _cacheGenerations.set(cacheKey, (_cacheGenerations.get(cacheKey) ?? 0) + 1);
  }
  _cache.clear();
}

export function invalidateDatabaseCaches() {
  invalidateApiCache('db_fields');
  invalidateApiCache('db_columns');
}

export function _invokeInvalidating<T>(
  method: string,
  invalidate: () => void,
  params?: Record<string, unknown> | object,
): Promise<T> {
  return _invoke<T>(method, params).then((v) => {
    invalidate();
    return v;
  });
}

const ANTARES_IPC_ERROR_PREFIX = 'ANTARES_IPC_ERROR:';
const ELECTRON_INVOKE_PREFIX = /^Error invoking remote method '[^']+': (?:Error: )?/;

function stripElectronInvokePrefix(message: string): string {
  return message.replace(ELECTRON_INVOKE_PREFIX, '');
}

function antaresErrorFromPayload(raw: {
  message?: unknown;
  code?: unknown;
  category?: unknown;
  details?: unknown;
  request_id?: unknown;
}, fallbackMessage: string): AntaresAPIError {
  return new AntaresAPIError(
    typeof raw.message === 'string' ? raw.message : fallbackMessage,
    typeof raw.code === 'number' ? raw.code : -32000,
    typeof raw.category === 'string' ? raw.category : 'INTERNAL_ERROR',
    raw.details && typeof raw.details === 'object' && !Array.isArray(raw.details)
      ? raw.details as Record<string, unknown>
      : undefined,
    typeof raw.request_id === 'string' ? raw.request_id : undefined,
  );
}

function parseIpcInvokeError(err: unknown): AntaresAPIError | null {
  if (err instanceof AntaresAPIError) return err;

  if (err instanceof Error) {
    const body = stripElectronInvokePrefix(err.message);
    if (body.startsWith(ANTARES_IPC_ERROR_PREFIX)) {
      try {
        const payload = JSON.parse(body.slice(ANTARES_IPC_ERROR_PREFIX.length)) as {
          message?: unknown;
          code?: unknown;
          category?: unknown;
          details?: unknown;
          request_id?: unknown;
        };
        return antaresErrorFromPayload(payload, body);
      } catch {
        return new AntaresAPIError(body);
      }
    }
    return null;
  }

  if (err && typeof err === 'object' && 'message' in err) {
    return antaresErrorFromPayload(
      err as { message?: unknown; code?: unknown; category?: unknown; details?: unknown },
      String(err),
    );
  }
  return null;
}

const INVOKE_RETRY_MAX_DELAY_MS = 10_000;

const _invokeOnce = async <T>(method: string, params?: Record<string, unknown> | object): Promise<T> => {
  if (!window.electronAPI) {
    throw new AntaresAPIError('Electron IPC no disponible', -32000, 'INTERNAL_ERROR');
  }

  const timeoutTier = IPC_METHOD_ENTRIES[method]?.timeout ?? 'normal';
  const baseTimeout = IPC_METHOD_TIMEOUTS[timeoutTier] ?? IPC_METHOD_TIMEOUTS.normal;
  const timeoutMs = baseTimeout + FE_TIMEOUT_BUFFER_MS + (_backendSeenReady ? 0 : FE_STARTUP_BUFFER_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeoutErr = () => new AntaresAPIError(`IPC timeout: ${method}`, -32001, 'TIMEOUT');
  const invokePromise = window.electronAPI.invoke(method, params as Record<string, unknown>).then(
    (value) => {
      if (timedOut) throw timeoutErr();
      return value as T;
    },
    (err: unknown) => {
      if (timedOut) throw timeoutErr();
      throw err;
    },
  );
  invokePromise.catch(() => {});
  try {
    const result = await Promise.race<T>([
      invokePromise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(timeoutErr());
        }, timeoutMs);
      }),
    ]);
    if (IPC_METHOD_ENTRIES[method]?.handler?.startsWith('backend:')) {
      _backendSeenReady = true;
    }
    return result as T;
  } catch (err: unknown) {
    if (timedOut) throw timeoutErr();
    const parsed = parseIpcInvokeError(err);
    if (parsed) throw parsed;
    if (err instanceof Error) {
      throw new AntaresAPIError(stripElectronInvokePrefix(err.message));
    }
    throw new AntaresAPIError(String(err));
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const _invoke = async <T>(method: string, params?: Record<string, unknown> | object): Promise<T> => {
  try {
    try {
      return await _invokeOnce<T>(method, params);
    } catch (err: unknown) {
      const retryAfterMs = apiRetryAfterMs(err);
      if (retryAfterMs === null) throw err;
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(retryAfterMs, INVOKE_RETRY_MAX_DELAY_MS)),
      );
      return await _invokeOnce<T>(method, params);
    }
  } catch (err: unknown) {
    const errorName =
      err instanceof AntaresAPIError && err.category
        ? `${err.name}[${err.category}]`
        : err instanceof Error
          ? err.name
          : 'AntaresAPIError';
    reportFrontendError({
      kind: 'api_error',
      view: `api:${method}`,
      name: errorName,
      message: errorMessage(err, String(err)),
      stack: err instanceof Error ? err.stack : undefined,
      requestId: err instanceof AntaresAPIError ? err.requestId : undefined,
    });
    throw err;
  }
};

export function onNotify(callback: (method: string, params: unknown) => void) {
  if (!window.electronAPI) return () => {};
  return window.electronAPI.onNotify(callback);
}

export interface BackendHealthStatus {
  last_probe_at: string | null;
  last_success_at: string | null;
  last_probe_ms: number | null;
  last_probe_outcome: string | null;
  consecutive_failures: number;
  skipped_total: number;
  last_skip_reason: string | null;
  last_failure_at: string | null;
}

export interface BackendStatus {
  state: string;
  ready: boolean;
  lastError: { kind: string; message: string; stderrTail: string } | null;
  stderrTail: string;
  health?: BackendHealthStatus;
}

export async function getBackendStatus(): Promise<BackendStatus> {
  if (!window.electronAPI) {
    return { state: 'unavailable', ready: false, lastError: null, stderrTail: '' };
  }
  return window.electronAPI.backendStatus() as Promise<BackendStatus>;
}

export async function restartBackend(): Promise<{ success: boolean; state: string }> {
  if (!window.electronAPI) {
    throw new Error('Electron IPC no disponible');
  }
  try {
    return await (window.electronAPI.backendRestart() as Promise<{ success: boolean; state: string }>);
  } catch (err: unknown) {
    reportFrontendError({
      kind: 'api_error',
      view: 'api:backend_restart',
      name: err instanceof Error ? err.name : 'BackendRestartError',
      message: errorMessage(err, String(err)),
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  }
}
