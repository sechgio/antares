import React from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { getColumnWidthClass, isMonospaceColumn, HighlightMatch, renderStatusBadge } from './dataPreviewFormat';

export interface VirtualRowItem {
  row: Record<string, unknown>;
  originalIndex: number;
  photoInfo: { count: number; files: File[] };
}

export interface VirtualRowData {
  rows: VirtualRowItem[];
  visibleHeaders: string[];
  selectedIndex: string;
  focusedRowIndex: number;
  densityPadding: string;
  wrapText: boolean;
  query: string;
  onSetFocused: (idx: number) => void;
  onHandleRowClick: (idx: number) => void;
}

export type VirtualRowProps = {
  index: number;
  style: React.CSSProperties;
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
} & VirtualRowData;

const PreviewVirtualRow = React.memo(function PreviewVirtualRowInner({
  index,
  style,
  rows,
  visibleHeaders: vHeaders,
  selectedIndex: selIdx,
  focusedRowIndex: focIdx,
  densityPadding: dPad,
  wrapText: wText,
  query,
  onSetFocused,
  onHandleRowClick,
}: VirtualRowProps) {
  const item = rows[index];
  if (!item) return <div style={style} />;
  const { row, originalIndex, photoInfo } = item;
  const isSelected = selIdx === String(originalIndex);
  const isFocused = focIdx === originalIndex;
  return (
    <div
      style={style}
      onClick={() => onSetFocused(originalIndex)}
      onDoubleClick={() => onHandleRowClick(originalIndex)}
      className={`flex items-center border-b border-[var(--border-subtle)] cursor-pointer transition-colors ${
        isSelected
          ? 'bg-[color-mix(in_srgb,var(--accent-primary)_15%,transparent)] font-medium'
          : isFocused
            ? 'bg-[color-mix(in_srgb,var(--bg-elevated)_75%,transparent)]'
            : 'bg-transparent hover:bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)]'
      }`}
    >
      <div
        className={`flex h-full w-12 shrink-0 items-center justify-center border-r border-[var(--border-subtle)] font-mono text-[11px] tabular-nums ${
          isSelected
            ? 'bg-[var(--bg-base)] font-bold text-[var(--accent-primary)] shadow-[inset_2px_0_0_var(--accent-primary)]'
            : isFocused
              ? 'bg-[var(--bg-elevated)]'
              : 'bg-[var(--bg-base)] text-[var(--text-muted)]'
        }`}
      >
        <span
          className={`inline-flex h-5 w-5 items-center justify-center rounded tabular-nums ${
            isSelected
              ? 'font-bold text-[var(--accent-primary)]'
              : isFocused
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-muted)]'
          }`}
        >
          {originalIndex + 1}
        </span>
      </div>
      {vHeaders.map((header) => {
        const rawValue = row[header];
        const cellText = rawValue !== null && rawValue !== undefined ? String(rawValue).trim() : '';
        const isStatusCol =
          header.toUpperCase().includes('ESTADO') || header.toUpperCase().includes('STATUS');
        const isMono = isMonospaceColumn(header);
        return (
          <div
            key={header}
            className={`flex h-full min-w-0 flex-1 items-center ${dPad} ${
              isSelected ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'
            } ${getColumnWidthClass(header)}`}
            title={cellText}
          >
            {isStatusCol && cellText ? (
              renderStatusBadge(cellText, query)
            ) : (
              <div
                className={`${isMono ? 'font-mono text-[11.5px] tabular-nums text-[var(--text-primary)]' : ''} ${
                  wText ? 'whitespace-normal break-words leading-snug' : 'truncate max-w-xs'
                } w-full`}
              >
                {cellText ? <HighlightMatch text={cellText} query={query} /> : <span className="text-[var(--text-muted)] opacity-50">—</span>}
              </div>
            )}
          </div>
        );
      })}
      <div
        className={`flex h-full w-28 shrink-0 items-center justify-center border-l border-[var(--border-subtle)] ${
          isSelected ? 'bg-[var(--bg-base)]' : isFocused ? 'bg-[var(--bg-elevated)]' : 'bg-[var(--bg-base)]'
        }`}
      >
        {photoInfo.count > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-green)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-green)] whitespace-nowrap">
            <ImageIcon size={11} />
            {photoInfo.count}
          </span>
        ) : (
          <span className="text-[11px] text-[var(--text-muted)] opacity-50">—</span>
        )}
      </div>
    </div>
  );
});

export default PreviewVirtualRow;
