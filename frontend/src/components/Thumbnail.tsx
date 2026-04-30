import { useState, useCallback } from 'react';

interface ThumbnailProps {
  path: string;
  size?: number;
  variant?: 'compact' | 'card';
}

export default function Thumbnail({ path, size = 48, variant = 'compact' }: ThumbnailProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const parts = path.split(/[\\/]/);
  const filename = parts[parts.length - 1] || path;
  const ext = filename.split('.').pop()?.toUpperCase() ?? '';
  const src = path.startsWith('file://') ? path : `file://${path}`;
  const isCard = variant === 'card';

  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => { setError(true); setLoaded(true); }, []);

  return (
    <div
      className={`relative shrink-0 group overflow-hidden bg-dark-input ${
        isCard
          ? 'w-full h-full rounded-[10px] border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
          : 'rounded-[10px]'
      }`}
      style={isCard ? undefined : { width: size, height: size }}
    >
      {/* Skeleton loader */}
      {!loaded && (
        <div className="absolute inset-0 animate-pulse bg-dark-elevated">
          <div className="h-full w-full bg-gradient-to-r from-transparent via-white/5 to-transparent animate-shimmer" />
        </div>
      )}

      {!error ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          className={`h-full w-full object-cover transition-all duration-300 group-hover:scale-105 ${
            isCard ? 'rounded-[10px]' : 'rounded-[10px] border border-bdr-subtle shadow-sm'
          } ${loaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={handleLoad}
          onError={handleError}
        />
      ) : (
        <div className="h-full w-full flex items-center justify-center bg-dark-elevated">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-txt-muted">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/70 to-transparent opacity-80" />
      <span
        className={`absolute bg-black/70 text-white font-bold shadow-sm border border-white/10 backdrop-blur-sm ${
          isCard
            ? 'bottom-2 right-2 rounded-[6px] px-2 py-1 text-[10px]'
            : '-bottom-0.5 -right-0.5 rounded-pill px-1.5 py-0.5 text-[8px]'
        }`}
      >
        {ext}
      </span>
    </div>
  );
}
