import React, { useRef, useMemo } from 'react';
import { Grid } from 'react-window';
import FileCard from './FileCard';

interface FileGridProps {
  files: string[];
  selectedFiles: Set<string>;
  selectedFile: string | null;
  onFileClick: (e: React.MouseEvent, path: string) => void;
  onRemoveFile: (path: string) => void;
  onSelectAll: () => void;
  videoFiles?: Set<string>;
}

interface CellData {
  files: string[];
  columnCount: number;
  selectedFiles: Set<string>;
  selectedFile: string | null;
  onFileClick: (e: React.MouseEvent, path: string) => void;
  onRemoveFile: (path: string) => void;
  videoFiles: Set<string>;
}

const COL_WIDTH = 152;
const ROW_HEIGHT = 198;

function FileGridCell({ rowIndex, columnIndex, style, files, columnCount, selectedFiles, selectedFile, onFileClick, onRemoveFile, videoFiles }: { ariaAttributes: { "aria-colindex": number; role: "gridcell" }; rowIndex: number; columnIndex: number; style: React.CSSProperties } & CellData) {
  const idx = rowIndex * columnCount + columnIndex;
  if (idx >= files.length) return <div style={style} />;
  const f = files[idx];
  return (
    <div style={style}>
      <FileCard
        path={f}
        selected={selectedFiles.has(f)}
        isPrimary={selectedFile === f}
        onClick={(e) => onFileClick(e, f)}
        onRemove={(e) => { e.stopPropagation(); onRemoveFile(f); }}
        index={idx}
        isVideo={videoFiles.has(f)}
      />
    </div>
  );
}

export default function FileGrid({ files, selectedFiles, selectedFile, onFileClick, onRemoveFile, onSelectAll, videoFiles = new Set() }: FileGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = React.useState({ width: 800, height: 500 });

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width: Math.floor(width), height: Math.floor(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columnCount = Math.max(1, Math.floor(dimensions.width / COL_WIDTH));
  const rowCount = Math.ceil(files.length / columnCount);
  const gridHeight = Math.min(rowCount * ROW_HEIGHT, 600);

  const cellProps = useMemo<CellData>(() => ({
    files, columnCount, selectedFiles, selectedFile, onFileClick, onRemoveFile, videoFiles,
  }), [files, columnCount, selectedFiles, selectedFile, onFileClick, onRemoveFile, videoFiles]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[#666666]">
          {selectedFiles.size > 0 ? `${selectedFiles.size} seleccionados` : `${files.length} total`}
        </span>
        <button
          onClick={onSelectAll}
          className="text-xs text-[#A0A0A0] hover:text-white transition-colors"
        >
          {selectedFiles.size === files.length ? 'Deseleccionar' : 'Seleccionar todos'}
        </button>
      </div>
      <div ref={containerRef} style={{ height: gridHeight }}>
        {files.length > 0 && (
          <Grid
            columnCount={columnCount}
            columnWidth={COL_WIDTH}
            defaultHeight={gridHeight}
            defaultWidth={dimensions.width}
            rowCount={rowCount}
            rowHeight={ROW_HEIGHT}
            overscanCount={3}
            cellComponent={FileGridCell}
            cellProps={cellProps}
          />
        )}
      </div>
    </div>
  );
}
