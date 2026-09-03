import React, { useRef, useMemo } from 'react';
import { Grid } from 'react-window';
import FileCard from './FileCard';

interface FileGridProps {
  files: string[];
  selectedFiles: Set<string>;
  selectedFile: string | null;
  onFileClick: (e: React.MouseEvent, path: string) => void;
  onFileDoubleClick: (e: React.MouseEvent, path: string) => void;
  onRemoveFile: (path: string) => void;
  fileTokens?: Record<string, string>;
  fileObjects?: Record<string, File>;
  videoFiles?: Set<string>;
}

interface CellData {
  files: string[];
  columnCount: number;
  selectedFiles: Set<string>;
  selectedFile: string | null;
  onFileClick: (e: React.MouseEvent, path: string) => void;
  onFileDoubleClick: (e: React.MouseEvent, path: string) => void;
  onRemoveFile: (path: string) => void;
  fileTokens: Record<string, string>;
  fileObjects: Record<string, File>;
  videoFiles: Set<string>;
}

const COL_WIDTH = 152;
const ROW_HEIGHT = 198;

type CellComponentProps = {
  ariaAttributes: { "aria-colindex": number; role: "gridcell" };
  rowIndex: number;
  columnIndex: number;
  style: React.CSSProperties;
} & CellData;

const MemoizedFileGridCell = React.memo(function FileGridCell(
  { rowIndex, columnIndex, style, files, columnCount, selectedFiles, selectedFile, onFileClick, onFileDoubleClick, onRemoveFile, fileTokens, fileObjects, videoFiles }: CellComponentProps
): React.ReactElement | null {
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
        onDoubleClick={(e) => onFileDoubleClick(e, f)}
        onRemove={(e) => { e.stopPropagation(); onRemoveFile(f); }}
        fileToken={fileTokens[f]}
        file={fileObjects[f]}
        isVideo={videoFiles.has(f)}
      />
    </div>
  );
});

export default function FileGrid({ files, selectedFiles, selectedFile, onFileClick, onFileDoubleClick, onRemoveFile, fileTokens = {}, fileObjects = {}, videoFiles = new Set() }: FileGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = React.useState<{ width: number; height: number } | null>(null);

  React.useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setDimensions({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    }
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width: Math.floor(width), height: Math.floor(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columnCount = dimensions ? Math.max(1, Math.floor(dimensions.width / COL_WIDTH)) : 1;
  const rowCount = Math.ceil(files.length / columnCount);

  const cellProps = useMemo<CellData>(() => ({
    files, columnCount, selectedFiles, selectedFile, onFileClick, onFileDoubleClick, onRemoveFile, fileTokens, fileObjects, videoFiles,
  }), [files, columnCount, selectedFiles, selectedFile, onFileClick, onFileDoubleClick, onRemoveFile, fileTokens, fileObjects, videoFiles]);

  return (
    <div ref={containerRef} className="h-full w-full">
      {files.length > 0 && dimensions && (
        <Grid
          columnCount={columnCount}
          columnWidth={COL_WIDTH}
          defaultHeight={dimensions.height}
          defaultWidth={dimensions.width}
          rowCount={rowCount}
          rowHeight={ROW_HEIGHT}
          overscanCount={3}
          cellComponent={MemoizedFileGridCell as (props: CellComponentProps) => React.ReactElement | null}
          cellProps={cellProps}
        />
      )}
    </div>
  );
}
