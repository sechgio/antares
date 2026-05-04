import React, { useState, useMemo } from 'react';
import Thumbnail from '../Thumbnail';
import Badge from '../ui/Badge';

interface FileCardProps {
  path: string;
  selected: boolean;
  isPrimary: boolean;
  onClick: (e: React.MouseEvent) => void;
  onRemove: (e: React.MouseEvent) => void;
  index: number;
  isVideo?: boolean;
}

export default React.memo(function FileCard({ path, selected, isPrimary, onClick, onRemove, isVideo = false }: FileCardProps) {
  const filename = useMemo(() => path.split(/[\\/]/).pop() || path, [path]);
  const ext = useMemo(() => filename.slice(filename.lastIndexOf('.')).toUpperCase(), [filename]);
  const [showRemove, setShowRemove] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setShowRemove(true)}
      onMouseLeave={() => setShowRemove(false)}
      className={`group relative cursor-pointer rounded-xl overflow-hidden border transition-all duration-200 ${
        isPrimary
          ? 'border-[var(--accent-primary)] shadow-[0_0_0_3px_var(--accent-primary-glow)] scale-[1.02] z-10'
          : selected
          ? 'border-[var(--accent-primary)]/50 bg-[var(--accent-primary)]/5'
          : 'border-[var(--border-subtle)] hover:border-[var(--border-medium)] hover:shadow-lg hover:scale-[1.01]'
      }`}
    >
      <div className="relative aspect-square bg-[var(--bg-elevated)] overflow-hidden">
        <Thumbnail path={path} variant="card" />

        <div className="absolute right-2 bottom-2 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[9px] font-bold text-white/90 uppercase tracking-wide">
          {ext.replace('.', '')}
        </div>

        {isVideo && (
          <Badge variant="warning" className="absolute left-2 top-2 text-[9px] font-bold shadow-sm">
            VIDEO
          </Badge>
        )}

        <div
          className={`absolute left-2 top-2 flex h-5.5 w-5.5 items-center justify-center rounded-full border-2 transition-all duration-200 ${
            selected
              ? 'bg-[var(--accent-primary)] border-[var(--accent-primary)]'
              : 'bg-black/50 border-white/40 group-hover:border-white/80 group-hover:bg-black/60'
          } ${isVideo ? 'left-auto right-2 top-8' : ''}`}
        >
          {selected && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>

        <button
          onClick={onRemove}
          className={`absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-all duration-200 hover:bg-[var(--accent-red)] shadow-sm ${
            showRemove || isPrimary ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>

        <div className={`absolute inset-0 bg-[var(--accent-primary)]/5 transition-opacity duration-200 pointer-events-none ${isPrimary ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
      </div>
      <div className="px-2.5 py-2 bg-[var(--bg-surface)]">
        <p className="text-[11px] font-medium text-[var(--text-primary)] truncate leading-tight">{filename}</p>
      </div>
    </div>
  );
});
