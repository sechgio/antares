import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api';
import Badge from './ui/Badge';

interface ImagePreviewProps {
  path: string;
  formato: string;
  calidad: number;
  resizeAncho: string;
  resizeAlto: string;
}

interface PreviewCacheEntry {
  preview: string;
  width: string;
  height: string;
  orig_size_kb: string;
}

// LRU Cache implementation to prevent memory leaks with large image sets
class LRUCache<K, V> {
  private cache: Map<K, { value: V; timestamp: number }>;
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number = 100, ttl: number = 5 * 60 * 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, { value, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

const previewCache = new LRUCache<string, PreviewCacheEntry>(100, 5 * 60 * 1000);

function cacheKey(path: string, formato: string, calidad: number, resize: string): string {
  return `${path}::${formato}::${calidad}::${resize}`;
}

export default function ImagePreview({ path, formato, calidad, resizeAncho, resizeAlto }: ImagePreviewProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ width: string; height: string; orig_size_kb: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const generatePreview = useCallback(async () => {
    if (!path) return;

    const resize = resizeAncho && resizeAlto
      ? [parseInt(resizeAncho), parseInt(resizeAlto)]
      : null;
    const resizeStr = resize ? `${resize[0]}x${resize[1]}` : 'none';
    const key = cacheKey(path, formato, calidad, resizeStr);

    // Check cache first
    const cached = previewCache.get(key);
    if (cached) {
      setPreview(cached.preview);
      setMeta({ width: cached.width, height: cached.height, orig_size_kb: cached.orig_size_kb });
      setError(null);
      return;
    }

    // Cancel previous request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const r = await api.previewImage({ path, formato, calidad, resize });
      if (controller.signal.aborted) return;
      setPreview(r.preview);
      setMeta({ width: r.width, height: r.height, orig_size_kb: r.orig_size_kb });
      previewCache.set(key, {
        preview: r.preview,
        width: r.width,
        height: r.height,
        orig_size_kb: r.orig_size_kb,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      setPreview(null);
      setMeta(null);
      setError(err instanceof Error ? err.message : 'Error generando preview');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [path, formato, calidad, resizeAncho, resizeAlto]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) generatePreview();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, [path, formato, calidad, resizeAncho, resizeAlto]);

  const originalSrc = path.startsWith('file://') ? path : `file://${path}`;
  const displayFormat = formato.toUpperCase();

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-widest text-txt-muted">Vista previa</span>
          {meta && (
            <Badge variant="default" className="text-[10px]">
              {meta.width}×{meta.height}px · {meta.orig_size_kb} KB
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="default" className="text-[10px]">
            {displayFormat} · {calidad}%
          </Badge>
          <button
            onClick={() => setZoomed((z) => !z)}
            className="text-txt-muted hover:text-txt-primary transition-colors p-1"
            title={zoomed ? 'Restaurar' : 'Ampliar'}
          >
            {zoomed ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            )}
          </button>
        </div>
      </div>

      {/* Image panels */}
      <div className={`flex gap-3 flex-1 min-h-0 ${zoomed ? 'flex-col' : ''}`}>
        {/* Original */}
        <div className={`flex flex-col min-w-0 min-h-0 ${zoomed ? 'h-1/2' : 'flex-1'}`}>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-txt-muted mb-1.5">Original</span>
          <div className="flex-1 min-h-0 rounded-card bg-[linear-gradient(135deg,#151515,#0f0f0f)] border border-white/10 overflow-hidden p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="h-full w-full rounded-[10px] bg-dark-input/80 overflow-hidden flex items-center justify-center">
              <img src={originalSrc} alt="" className="max-h-full max-w-full object-contain" loading="lazy" />
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className={`flex flex-col min-w-0 min-h-0 ${zoomed ? 'h-1/2' : 'flex-1'}`}>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-txt-muted mb-1.5">
            Previsualización · {displayFormat}
          </span>
          <div className="flex-1 min-h-0 rounded-card bg-[linear-gradient(135deg,#151515,#0f0f0f)] border border-white/10 overflow-hidden p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="h-full w-full rounded-[10px] bg-dark-input/80 overflow-hidden flex items-center justify-center relative">
              {loading && (
                <div className="flex flex-col items-center gap-2 animate-pulse">
                  <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                  <span className="text-txt-muted text-xs">Generando preview...</span>
                </div>
              )}
              {!loading && preview && (
                <img src={preview} alt="" className="max-h-full max-w-full object-contain" loading="lazy" />
              )}
              {!loading && !preview && !error && (
                <span className="text-txt-muted text-sm">Selecciona una imagen</span>
              )}
              {error && (
                <div className="flex flex-col items-center gap-2 text-center px-4">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent-red"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  <span className="text-accent-red text-xs">{error}</span>
                  <button onClick={generatePreview} className="text-xs text-accent hover:underline">Reintentar</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
