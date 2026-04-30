import React from 'react';
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

export default function FileCard({ path, selected, isPrimary, onClick, onRemove, isVideo = false }: FileCardProps) {
  const filename = path.split(/[\\/]/).pop() || path;

  return (
    <div
      onClick={onClick}
      className={`group relative cursor-pointer rounded-lg overflow-hidden border transition-all duration-200 ${
        isPrimary
          ? 'border-[#5E6AD2] shadow-[0_0_0_4px_rgba(94,106,210,0.15)]'
          : selected
          ? 'border-[#5E6AD2]/40'
          : 'border-transparent hover:border-[#333333] hover:scale-[1.02]'
      }`}
    >
      <div className="relative aspect-square bg-[#1A1A1A]">
        <Thumbnail path={path} variant="card" />
        {/* Video badge */}
        {isVideo && (
          <Badge variant="warning" className="absolute left-2 top-2 text-[10px] font-bold">
            VIDEO
          </Badge>
        )}
        {/* Checkbox */}
        <div
          className={`absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all ${
            selected ? 'bg-[#5E6AD2] border-[#5E6AD2]' : 'bg-black/40 border-white/30 group-hover:border-white/60'
          } ${isVideo ? 'left-auto right-2' : ''}`}
        >
          {selected && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
        {/* Remove button */}
        <button
          onClick={onRemove}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-[#EF4444] group-hover:opacity-100"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div className="px-2 py-2">
        <p className="text-[11px] font-medium text-white truncate">{filename}</p>
      </div>
    </div>
  );
}
