import React, { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { List } from 'react-window';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import {
  Table2,
  Search,
  X,
  Image as ImageIcon,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  Check,
  WrapText,
  AlignLeft,
  Info,
  Layers,
  SlidersHorizontal,
  Download,
  Copy,
  PanelRight,
  PanelRightClose,
  RotateCcw,
  CheckCheck,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { buildImagesByRecordId, normalizeRecordId } from '../canvas/runtime/excel';

export interface DataPreviewModalProps {
  open: boolean;
  onClose: () => void;
  data: Record<string, unknown>[];
  headers: string[];
  images: File[];
  idColumn: string;
  selectedIndex: string;
  onSelectRow: (index: number) => void;
  sheetName?: string;
}

type SortDirection = 'asc' | 'desc';
type FilterPhotoType = 'all' | 'with-photos' | 'without-photos';
type RowDensity = 'compact' | 'normal' | 'spacious';

function getColumnWidthClass(header: string): string {
  const h = header.toUpperCase().trim();
  if (h === 'ID' || h === 'NIS' || h === 'OT' || h.includes('NRO') || h === 'SECTOR' || h === 'CUADRILLA') {
    return 'min-w-[110px]';
  }
  if (h.includes('OBSERVACION') || h.includes('OBS') || h.includes('DETALLE') || h.includes('DESCRIPCION')) {
    return 'min-w-[280px] max-w-[440px]';
  }
  if (h.includes('DIRECCION') || h.includes('UBICACION')) {
    return 'min-w-[240px] max-w-[360px]';
  }
  if (h.includes('ACTIVIDAD') || h.includes('TRABAJO')) {
    return 'min-w-[220px] max-w-[340px]';
  }
  if (h.includes('ESTADO') || h.includes('STATUS')) {
    return 'min-w-[130px]';
  }
  if (h.includes('CONTRATA') || h.includes('LOCALIDAD') || h.includes('DISTRITO') || h.includes('CENTRO') || h.includes('RED')) {
    return 'min-w-[140px]';
  }
  if (h.includes('FECHA') || h.includes('DATE') || h.includes('CORTE')) {
    return 'min-w-[120px]';
  }
  return h.length > 15 ? 'min-w-[180px]' : 'min-w-[130px]';
}

function isMonospaceColumn(header: string): boolean {
  const h = header.toUpperCase();
  return h === 'ID' || h === 'NIS' || h === 'OT' || h.includes('NRO') || h.includes('CODIGO') || h === 'SECTOR' || h === 'CUADRILLA';
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  const cleanQuery = query.trim();
  if (!cleanQuery || !text) return <span>{text}</span>;

  try {
    const escaped = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(regex);
    return (
      <span>
        {parts.map((part, i) =>
          part.toLowerCase() === cleanQuery.toLowerCase() ? (
            <mark
              key={i}
              className="rounded-[2px] bg-[var(--accent-primary)]/30 text-[var(--text-primary)] px-0.5 font-semibold"
            >
              {part}
            </mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </span>
    );
  } catch {
    return <span>{text}</span>;
  }
}

function renderStatusBadge(value: string, query = '') {
  const normalized = value.trim().toUpperCase();
  if (['ATENDIDO', 'COMPLETO', 'COMPLETADO', 'EJECUTADO', 'FINALIZADO', 'OK', 'APROBADO', 'ACTIVO'].includes(normalized)) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[var(--accent-green)]/15 text-[var(--accent-green)] border border-[var(--accent-green)]/30 whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-green)]" />
        <HighlightMatch text={value} query={query} />
      </span>
    );
  }
  if (['PENDIENTE', 'EN PROCESO', 'EN CURSO', 'INICIADO', 'ASIGNADO', 'REVISION', 'EN ESPERA'].includes(normalized)) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)] border border-[var(--accent-yellow)]/30 whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-yellow)]" />
        <HighlightMatch text={value} query={query} />
      </span>
    );
  }
  if (['CANCELADO', 'ANULADO', 'RECHAZADO', 'NO ATENDIDO', 'URGENTE', 'ERROR', 'BAJA'].includes(normalized)) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[var(--accent-red)]/15 text-[var(--accent-red)] border border-[var(--accent-red)]/30 whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-red)]" />
        <HighlightMatch text={value} query={query} />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)] whitespace-nowrap">
      <HighlightMatch text={value} query={query} />
    </span>
  );
}

export default function DataPreviewModal({
  open,
  onClose,
  data,
  headers,
  images,
  idColumn,
  selectedIndex,
  onSelectRow,
  sheetName,
}: DataPreviewModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebouncedValue(searchQuery, 200);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [photoFilter, setPhotoFilter] = useState<FilterPhotoType>('all');
  const [wrapText, setWrapText] = useState(true);
  const [density, setDensity] = useState<RowDensity>('normal');
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [showColumnDropdown, setShowColumnDropdown] = useState(false);
  const [showDetailPane, setShowDetailPane] = useState(false);
  const [columnFilterQuery, setColumnFilterQuery] = useState('');
  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);

  const [focusedRowIndex, setFocusedRowIndex] = useState<number>(() => {
    const idx = parseInt(selectedIndex, 10);
    return isNaN(idx) ? 0 : idx;
  });

  const searchInputRef = useRef<HTMLInputElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const columnMenuRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(modalRef, open && data.length > 0, searchInputRef);

  useEffect(() => {
    const idx = parseInt(selectedIndex, 10);
    if (!isNaN(idx) && idx >= 0 && idx < data.length) {
      setFocusedRowIndex(idx);
    }
  }, [selectedIndex, data.length]);

  useEffect(() => {
    if (!showColumnDropdown) return;
    const onClickOutside = (e: MouseEvent) => {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Node)) {
        setShowColumnDropdown(false);
      }
    };
    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, [showColumnDropdown]);

  const imagesByRecordId = useMemo(
    () => buildImagesByRecordId(data as Record<string, string>[], idColumn, images),
    [data, idColumn, images],
  );

  const rowPhotoMap = useMemo(() => {
    const map = new Map<number, { count: number; files: File[] }>();
    data.forEach((row, idx) => {
      const normalized = normalizeRecordId(String(row[idColumn] ?? '').trim());
      if (!normalized) {
        map.set(idx, { count: 0, files: [] });
        return;
      }
      const files = imagesByRecordId.get(normalized) ?? [];
      map.set(idx, { count: files.length, files });
    });
    return map;
  }, [data, idColumn, imagesByRecordId]);

  const photoStats = useMemo(() => {
    let withPhotos = 0;
    let withoutPhotos = 0;
    data.forEach((_, idx) => {
      const count = rowPhotoMap.get(idx)?.count ?? 0;
      if (count > 0) withPhotos++;
      else withoutPhotos++;
    });
    return { total: data.length, withPhotos, withoutPhotos };
  }, [data, rowPhotoMap]);

  const visibleHeaders = useMemo(() => {
    return headers.filter((h) => !hiddenColumns.has(h));
  }, [headers, hiddenColumns]);

  const filteredAndSortedRows = useMemo(() => {
    const query = debouncedQuery.trim().toLowerCase();

    let items = data.map((row, originalIndex) => ({
      row,
      originalIndex,
      photoInfo: rowPhotoMap.get(originalIndex) ?? { count: 0, files: [] },
    }));

    if (photoFilter === 'with-photos') {
      items = items.filter((item) => item.photoInfo.count > 0);
    } else if (photoFilter === 'without-photos') {
      items = items.filter((item) => item.photoInfo.count === 0);
    }

    if (query) {
      items = items.filter(({ row }) => {
        return headers.some((h) => {
          const val = String(row[h] ?? '').toLowerCase();
          return val.includes(query);
        });
      });
    }

    if (sortCol) {
      items.sort((a, b) => {
        if (sortCol === '#') {
          return sortDir === 'asc' ? a.originalIndex - b.originalIndex : b.originalIndex - a.originalIndex;
        }
        if (sortCol === '__fotos__') {
          return sortDir === 'asc'
            ? a.photoInfo.count - b.photoInfo.count
            : b.photoInfo.count - a.photoInfo.count;
        }
        const valA = String(a.row[sortCol] ?? '').trim();
        const valB = String(b.row[sortCol] ?? '').trim();

        const numA = Number(valA);
        const numB = Number(valB);
        if (!isNaN(numA) && !isNaN(numB) && valA !== '' && valB !== '') {
          return sortDir === 'asc' ? numA - numB : numB - numA;
        }

        return sortDir === 'asc'
          ? valA.localeCompare(valB, 'es', { numeric: true, sensitivity: 'base' })
          : valB.localeCompare(valA, 'es', { numeric: true, sensitivity: 'base' });
      });
    }

    return items;
  }, [data, headers, rowPhotoMap, photoFilter, debouncedQuery, sortCol, sortDir]);

  const handleHeaderClick = (colKey: string) => {
    if (sortCol === colKey) {
      if (sortDir === 'asc') {
        setSortDir('desc');
      } else {
        setSortCol(null);
        setSortDir('asc');
      }
    } else {
      setSortCol(colKey);
      setSortDir('asc');
    }
  };

  const handleRowClick = useCallback(
    (originalIdx: number) => {
      setFocusedRowIndex(originalIdx);
      onSelectRow(originalIdx);
      onClose();
    },
    [onSelectRow, onClose]
  );

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (showColumnDropdown) {
          setShowColumnDropdown(false);
          return;
        }
        onClose();
        return;
      }

      if (document.activeElement === searchInputRef.current && !['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
        return;
      }

      if (filteredAndSortedRows.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedRowIndex((prev) => {
          const currentPos = filteredAndSortedRows.findIndex((r) => r.originalIndex === prev);
          const nextPos = currentPos === -1 ? 0 : Math.min(currentPos + 1, filteredAndSortedRows.length - 1);
          return filteredAndSortedRows[nextPos].originalIndex;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedRowIndex((prev) => {
          const currentPos = filteredAndSortedRows.findIndex((r) => r.originalIndex === prev);
          const prevPos = currentPos === -1 ? 0 : Math.max(currentPos - 1, 0);
          return filteredAndSortedRows[prevPos].originalIndex;
        });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const activeItem = filteredAndSortedRows.find((r) => r.originalIndex === focusedRowIndex);
        if (activeItem) {
          onSelectRow(activeItem.originalIndex);
          onClose();
        } else if (filteredAndSortedRows.length > 0) {
          onSelectRow(filteredAndSortedRows[0].originalIndex);
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose, filteredAndSortedRows, focusedRowIndex, onSelectRow, showColumnDropdown]);

  const toggleColumnVisibility = (header: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(header)) next.delete(header);
      else {
        if (headers.length - next.size > 1) {
          next.add(header);
        }
      }
      return next;
    });
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopiedNotification(`${label} copiado`);
        setTimeout(() => setCopiedNotification(null), 2000);
      }
    } catch {
    }
  };

  const exportFilteredToCsv = () => {
    if (filteredAndSortedRows.length === 0) return;
    const csvHeaders = ['#', ...visibleHeaders, 'Fotos'];
    const csvRows = filteredAndSortedRows.map(({ row, originalIndex, photoInfo }) => {
      const values = [
        String(originalIndex + 1),
        ...visibleHeaders.map((h) => {
          const raw = String(row[h] ?? '');
          return `"${raw.replace(/"/g, '""')}"`;
        }),
        String(photoInfo.count),
      ];
      return values.join(',');
    });

    const csvContent = '\uFEFF' + [csvHeaders.join(','), ...csvRows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `datos_vista_previa_${sheetName || 'export'}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const VIRTUALIZE_THRESHOLD = 100;
  const ROW_HEIGHT_MAP = { compact: 32, normal: 40, spacious: 48 } as const;
  const virtualRowHeight = ROW_HEIGHT_MAP[density];
  const useVirtual = filteredAndSortedRows.length >= VIRTUALIZE_THRESHOLD;
  const [listHeight, setListHeight] = useState(400);

  useLayoutEffect(() => {
    if (!useVirtual || !open) return;
    const el = tableContainerRef.current;
    if (!el) return;
    const update = () => {
      const h = el.getBoundingClientRect().height;
      if (h > 0) setListHeight(Math.floor(h));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [useVirtual, open]);

  const currentSelectedOriginalIdx = parseInt(selectedIndex, 10);
  const selectedRecordId =
    idColumn && !isNaN(currentSelectedOriginalIdx) && data[currentSelectedOriginalIdx]
      ? String(data[currentSelectedOriginalIdx][idColumn] ?? '')
      : '';

  const focusedRowData =
    focusedRowIndex >= 0 && focusedRowIndex < data.length ? data[focusedRowIndex] : null;
  const focusedRowPhotoInfo = rowPhotoMap.get(focusedRowIndex) ?? { count: 0, files: [] };

  const densityPadding =
    density === 'compact' ? 'px-3 py-1.5 text-[11px]' : density === 'spacious' ? 'px-4 py-3 text-[13px]' : 'px-3.5 py-2.5 text-[12px]';

  type VirtualRowData = {
    rows: typeof filteredAndSortedRows;
    visibleHeaders: string[];
    selectedIndex: string;
    focusedRowIndex: number;
    densityPadding: string;
    wrapText: boolean;
    query: string;
    onSetFocused: (idx: number) => void;
    onHandleRowClick: (idx: number) => void;
  };

  type VirtualRowProps = {
    index: number;
    style: React.CSSProperties;
    ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
  } & VirtualRowData;

  const PreviewVirtualRow = useMemo(
    () =>
      React.memo(function PreviewVirtualRowInner({
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
                  : index % 2 === 0
                    ? 'bg-transparent hover:bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)]'
                    : 'bg-[color-mix(in_srgb,var(--bg-surface)_25%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)]'
            }`}
          >
            <div
              className={`flex h-full w-12 shrink-0 items-center justify-center border-r border-[var(--border-subtle)] font-mono text-[11px] tabular-nums ${
                isSelected
                  ? 'bg-[var(--bg-base)] font-bold text-[var(--accent-primary)]'
                  : isFocused
                    ? 'bg-[var(--bg-elevated)]'
                    : 'bg-[var(--bg-base)] text-[var(--text-muted)]'
              }`}
            >
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded ${
                  isSelected
                    ? 'bg-[var(--accent-primary)] font-semibold text-[var(--text-on-accent)] shadow-sm'
                    : isFocused
                      ? 'bg-[var(--border-medium)] text-[var(--text-primary)]'
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
                  className={`flex h-full min-w-0 flex-1 items-center border-r border-[var(--border-subtle)] ${dPad} ${
                    isSelected ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'
                  } ${getColumnWidthClass(header)}`}
                  title={cellText}
                >
                  {isStatusCol && cellText ? (
                    renderStatusBadge(cellText, query)
                  ) : (
                    <div
                      className={`${isMono ? 'font-mono text-[11.5px] tabular-nums text-[var(--text-primary)]' : ''} ${
                        wText ? 'whitespace-normal break-words leading-relaxed' : 'truncate max-w-xs'
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
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--accent-green)]/30 bg-[var(--accent-green)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-green)] whitespace-nowrap shadow-sm">
                  <ImageIcon size={11} />
                  {photoInfo.count} {photoInfo.count === 1 ? 'foto' : 'fotos'}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)] whitespace-nowrap">
                  <ImageIcon size={11} className="opacity-35" />
                  0 fotos
                </span>
              )}
            </div>
          </div>
        );
      }),
    [],
  );

  const virtualRowProps = useMemo<VirtualRowData>(
    () => ({
      rows: filteredAndSortedRows,
      visibleHeaders,
      selectedIndex,
      focusedRowIndex,
      densityPadding,
      wrapText,
      query: debouncedQuery,
      onSetFocused: setFocusedRowIndex,
      onHandleRowClick: handleRowClick,
    }),
    [filteredAndSortedRows, visibleHeaders, selectedIndex, focusedRowIndex, densityPadding, wrapText, debouncedQuery, handleRowClick],
  );

  if (!open || data.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 animate-fade-in"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--bg-base) 85%, transparent)',
        backdropFilter: 'blur(8px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="data-preview-modal-title"
    >
      <div
        ref={modalRef}
        className={`w-full flex flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] shadow-2xl transition-all duration-200 animate-scale-in ${
          isFullScreen ? 'h-[96vh] max-w-[98vw]' : 'h-[90vh] max-h-[940px] max-w-[1500px]'
        }`}
        tabIndex={-1}
        style={{
          boxShadow:
            '0 24px 60px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px color-mix(in srgb, var(--border-medium) 60%, transparent)',
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/80 px-5 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] border border-[var(--accent-primary)]/30 shadow-sm">
              <Table2 size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h3 id="data-preview-modal-title" className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
                  Vista previa de datos
                </h3>
                <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
                  {data.length} {data.length === 1 ? 'registro' : 'registros'}
                </span>
                {sheetName && (
                  <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">
                    <Layers size={11} /> {sheetName}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                {visibleHeaders.length} de {headers.length} columnas visibles · Navega con las flechas o haz clic en una fila
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <div className="relative flex items-center min-w-[210px] sm:min-w-[280px]">
              <Search size={14} className="pointer-events-none absolute left-2.5 text-[var(--text-muted)]" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar en todas las columnas..."
                className="h-8 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] pl-8 pr-7 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none transition-all focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary-glow)]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  aria-label="Limpiar búsqueda"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <div className="relative" ref={columnMenuRef}>
              <WithHoverTooltip label="Configurar columnas visibles" placement="bottom">
                <button
                  type="button"
                  onClick={() => setShowColumnDropdown((v) => !v)}
                  className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors ${
                    showColumnDropdown || hiddenColumns.size > 0
                      ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]'
                  }`}
                  aria-label="Gestionar columnas"
                >
                  <SlidersHorizontal size={13} />
                  <span className="hidden md:inline">Columnas</span>
                  {hiddenColumns.size > 0 && (
                    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-primary)] px-1 text-[9px] font-bold text-[var(--text-on-accent)]">
                      {visibleHeaders.length}
                    </span>
                  )}
                </button>
              </WithHoverTooltip>

              {showColumnDropdown && (
                <div
                  className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-[var(--border-medium)] bg-[var(--bg-base)] p-3 shadow-2xl animate-fade-in"
                  style={{
                    boxShadow: '0 16px 36px rgba(0, 0, 0, 0.6), 0 0 0 1px color-mix(in srgb, var(--border-medium) 80%, transparent)',
                  }}
                >
                  <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]">
                    <span className="text-[12px] font-semibold text-[var(--text-primary)]">Columnas ({visibleHeaders.length}/{headers.length})</span>
                    <div className="flex gap-1 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setHiddenColumns(new Set())}
                        className="text-[var(--accent-primary)] hover:underline"
                      >
                        Todas
                      </button>
                      <span className="text-[var(--text-muted)]">·</span>
                      <button
                        type="button"
                        onClick={() => {
                          const keep = headers.slice(0, 4);
                          setHiddenColumns(new Set(headers.filter((h) => !keep.includes(h))));
                        }}
                        className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      >
                        Básicas
                      </button>
                    </div>
                  </div>

                  <div className="my-2">
                    <input
                      type="text"
                      value={columnFilterQuery}
                      onChange={(e) => setColumnFilterQuery(e.target.value)}
                      placeholder="Filtrar columna..."
                      className="h-7 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
                    />
                  </div>

                  <div className="max-h-52 overflow-y-auto space-y-1 pr-1 pp-data-table-scroll">
                    {headers
                      .filter((h) => h.toLowerCase().includes(columnFilterQuery.toLowerCase()))
                      .map((header) => {
                        const isVisible = !hiddenColumns.has(header);
                        return (
                          <label
                            key={header}
                            className="flex items-center justify-between gap-2 px-2 py-1 rounded-md text-[11px] hover:bg-[var(--bg-elevated)] cursor-pointer select-none text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          >
                            <span className="truncate">{header}</span>
                            <input
                              type="checkbox"
                              checked={isVisible}
                              onChange={() => toggleColumnVisibility(header)}
                              className="rounded border-[var(--border-medium)] accent-[var(--accent-primary)]"
                            />
                          </label>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>

            <WithHoverTooltip label={`Densidad: ${density}`} placement="bottom">
              <button
                type="button"
                onClick={() =>
                  setDensity((d) => (d === 'compact' ? 'normal' : d === 'normal' ? 'spacious' : 'compact'))
                }
                className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)] transition-colors"
                aria-label="Cambiar densidad de filas"
              >
                <span className="text-[10px] uppercase font-mono tracking-wider">{density[0]}</span>
                <span className="hidden lg:inline capitalize">{density}</span>
              </button>
            </WithHoverTooltip>

            <WithHoverTooltip label={wrapText ? 'Modo compacto (una línea)' : 'Modo legible (ajustar texto)'} placement="bottom">
              <button
                type="button"
                onClick={() => setWrapText((v) => !v)}
                className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors ${
                  wrapText
                    ? 'border-[var(--border-medium)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                    : 'border-[var(--border-subtle)] bg-transparent text-[var(--text-secondary)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]'
                }`}
                aria-label="Alternar ajuste de texto"
              >
                {wrapText ? <WrapText size={13} /> : <AlignLeft size={13} />}
                <span className="hidden lg:inline">{wrapText ? 'Ajustado' : 'Compacto'}</span>
              </button>
            </WithHoverTooltip>

            <WithHoverTooltip label={showDetailPane ? 'Ocultar panel de detalle' : 'Ver detalle del registro'} placement="bottom">
              <button
                type="button"
                onClick={() => setShowDetailPane((v) => !v)}
                className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors ${
                  showDetailPane
                    ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]'
                }`}
                aria-label="Alternar panel de detalle"
              >
                {showDetailPane ? <PanelRightClose size={13} /> : <PanelRight size={13} />}
                <span className="hidden lg:inline">Detalle</span>
              </button>
            </WithHoverTooltip>

            <WithHoverTooltip label="Descargar tabla filtrada como CSV" placement="bottom">
              <button
                type="button"
                onClick={exportFilteredToCsv}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)] transition-colors"
                aria-label="Exportar a CSV"
              >
                <Download size={14} />
              </button>
            </WithHoverTooltip>

            <WithHoverTooltip label={isFullScreen ? 'Reducir tamaño' : 'Pantalla completa'} placement="bottom">
              <button
                type="button"
                onClick={() => setIsFullScreen((v) => !v)}
                className="hidden sm:flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)] transition-colors"
                aria-label="Alternar pantalla completa"
              >
                {isFullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </WithHoverTooltip>

            <WithHoverTooltip label="Cerrar vista previa" placement="bottom" shortcut="Esc">
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-all"
                aria-label="Cerrar vista previa"
              >
                <X size={16} />
              </button>
            </WithHoverTooltip>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 px-5 py-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPhotoFilter('all')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                photoFilter === 'all'
                  ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span>Todos</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                  photoFilter === 'all' ? 'bg-[color:var(--text-on-accent)]/20 text-[var(--text-on-accent)]' : 'bg-[var(--bg-input)] text-[var(--text-muted)]'
                }`}
              >
                {photoStats.total}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setPhotoFilter('with-photos')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                photoFilter === 'with-photos'
                  ? 'bg-[var(--accent-green)] text-[var(--text-on-accent)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
              }`}
            >
              <ImageIcon size={12} />
              <span>Con fotos</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                  photoFilter === 'with-photos'
                    ? 'bg-[color:var(--text-on-accent)]/20 text-[var(--text-on-accent)]'
                    : 'bg-[var(--accent-green)]/10 text-[var(--accent-green)]'
                }`}
              >
                {photoStats.withPhotos}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setPhotoFilter('without-photos')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                photoFilter === 'without-photos'
                  ? 'bg-[var(--border-active)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span>Sin fotos</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                  photoFilter === 'without-photos' ? 'bg-[color:var(--text-on-accent)]/20 text-[var(--text-on-accent)]' : 'bg-[var(--bg-input)] text-[var(--text-muted)]'
                }`}
              >
                {photoStats.withoutPhotos}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
            {copiedNotification && (
              <span className="flex items-center gap-1 text-[var(--accent-green)] font-medium animate-fade-in">
                <CheckCheck size={12} /> {copiedNotification}
              </span>
            )}

            {searchQuery && (
              <span>
                Mostrando <strong className="text-[var(--text-primary)]">{filteredAndSortedRows.length}</strong> de{' '}
                {data.length} registros
              </span>
            )}

            {sortCol && (
              <button
                type="button"
                onClick={() => {
                  setSortCol(null);
                  setSortDir('asc');
                }}
                className="flex items-center gap-1 text-[var(--accent-primary)] hover:underline"
              >
                <RotateCcw size={10} /> Quitar orden ({sortCol})
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden bg-[var(--bg-base)]">
          <div ref={tableContainerRef} className="pp-data-table-scroll flex-1 overflow-auto select-text relative pb-1">
            {filteredAndSortedRows.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center p-6 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                  <Search size={22} />
                </div>
                <h4 className="text-[14px] font-semibold text-[var(--text-primary)]">No se encontraron resultados</h4>
                <p className="mt-1 max-w-sm text-[12px] text-[var(--text-muted)]">
                  No hay ningún registro que coincida con los filtros aplicados{' '}
                  {searchQuery && <span className="font-medium text-[var(--text-primary)]">"{searchQuery}"</span>}.
                </p>
                <div className="mt-4 flex gap-2">
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:border-[var(--accent-primary)] transition-colors"
                    >
                      Limpiar búsqueda
                    </button>
                  )}
                  {photoFilter !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setPhotoFilter('all')}
                      className="rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:border-[var(--accent-primary)] transition-colors"
                    >
                      Ver todos
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <table className="w-full min-w-full border-collapse text-left">
                <thead>
                  <tr className="sticky top-0 z-20 border-b border-[var(--border-medium)] bg-[var(--bg-elevated)]/95 backdrop-blur-md shadow-sm">
                    <th
                      className="sticky left-0 z-30 w-12 px-3 py-2.5 text-center font-semibold text-[11px] uppercase tracking-wider text-[var(--text-secondary)] bg-[var(--bg-elevated)]/95 border-r border-[var(--border-subtle)] cursor-pointer hover:text-[var(--text-primary)] select-none transition-colors"
                      onClick={() => handleHeaderClick('#')}
                      title="Ordenar por número de fila"
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span>#</span>
                        {sortCol === '#' &&
                          (sortDir === 'asc' ? (
                            <ChevronUp size={12} className="text-[var(--accent-primary)]" />
                          ) : (
                            <ChevronDown size={12} className="text-[var(--accent-primary)]" />
                          ))}
                      </div>
                    </th>

                    {visibleHeaders.map((header) => {
                      const isSorted = sortCol === header;
                      return (
                        <th
                          key={header}
                          onClick={() => handleHeaderClick(header)}
                          className={`px-3.5 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer select-none transition-colors border-r border-[var(--border-subtle)] ${getColumnWidthClass(
                            header
                          )}`}
                          title={`Ordenar por ${header}`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="truncate leading-tight">{header}</span>
                            <span className="shrink-0 text-[var(--text-muted)]">
                              {isSorted ? (
                                sortDir === 'asc' ? (
                                  <ChevronUp size={13} className="font-bold text-[var(--accent-primary)]" />
                                ) : (
                                  <ChevronDown size={13} className="font-bold text-[var(--accent-primary)]" />
                                )
                              ) : (
                                <ArrowUpDown size={11} className="opacity-30 hover:opacity-100 transition-opacity" />
                              )}
                            </span>
                          </div>
                        </th>
                      );
                    })}

                    <th
                      onClick={() => handleHeaderClick('__fotos__')}
                      className="sticky right-0 z-20 w-28 px-3 py-2.5 text-center font-semibold text-[11px] uppercase tracking-wider text-[var(--text-secondary)] bg-[var(--bg-elevated)]/95 border-l border-[var(--border-subtle)] cursor-pointer hover:text-[var(--text-primary)] select-none transition-colors"
                      title="Ordenar por cantidad de fotos vinculadas"
                    >
                      <div className="flex items-center justify-center gap-1.5">
                        <ImageIcon size={13} />
                        <span>Fotos</span>
                        {sortCol === '__fotos__' &&
                          (sortDir === 'asc' ? (
                            <ChevronUp size={12} className="text-[var(--accent-primary)]" />
                          ) : (
                            <ChevronDown size={12} className="text-[var(--accent-primary)]" />
                          ))}
                      </div>
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {useVirtual ? (
                    <tr>
                      <td colSpan={visibleHeaders.length + 2} className="p-0">
                        <List
                          rowCount={filteredAndSortedRows.length}
                          rowHeight={virtualRowHeight}
                          defaultHeight={listHeight}
                          overscanCount={5}
                          rowComponent={PreviewVirtualRow as never}
                          rowProps={virtualRowProps}
                          style={{ height: listHeight, width: '100%' }}
                        />
                      </td>
                    </tr>
                  ) : (
                    filteredAndSortedRows.map(({ row, originalIndex, photoInfo }) => {
                    const isSelected = selectedIndex === String(originalIndex);
                    const isFocused = focusedRowIndex === originalIndex;

                    return (
                      <tr
                        key={originalIndex}
                        onClick={() => setFocusedRowIndex(originalIndex)}
                        onDoubleClick={() => handleRowClick(originalIndex)}
                        className={`group cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-[var(--accent-primary)]/15 font-medium'
                            : isFocused
                            ? 'bg-[var(--bg-elevated)]/75'
                            : 'even:bg-[var(--bg-surface)]/25 hover:bg-[var(--accent-primary)]/8'
                        }`}
                      >
                        <td
                          className={`sticky left-0 z-10 px-2 py-2 text-center font-mono text-[11px] tabular-nums border-r border-[var(--border-subtle)] transition-colors ${
                            isSelected
                              ? 'bg-[var(--bg-base)] font-bold text-[var(--accent-primary)]'
                              : isFocused
                              ? 'bg-[var(--bg-elevated)]'
                              : 'bg-[var(--bg-base)] group-hover:bg-[var(--bg-surface)] text-[var(--text-muted)]'
                          }`}
                        >
                          <span
                            className={`inline-flex h-5 w-5 items-center justify-center rounded ${
                              isSelected
                                ? 'bg-[var(--accent-primary)] font-semibold text-[var(--text-on-accent)] shadow-sm'
                                : isFocused
                                ? 'bg-[var(--border-medium)] text-[var(--text-primary)]'
                                : 'text-[var(--text-muted)]'
                            }`}
                          >
                            {originalIndex + 1}
                          </span>
                        </td>

                        {visibleHeaders.map((header) => {
                          const rawValue = row[header];
                          const cellText = rawValue !== null && rawValue !== undefined ? String(rawValue).trim() : '';
                          const isStatusCol =
                            header.toUpperCase().includes('ESTADO') || header.toUpperCase().includes('STATUS');
                          const isMono = isMonospaceColumn(header);

                          return (
                            <td
                              key={header}
                              className={`align-top border-r border-[var(--border-subtle)] ${densityPadding} ${
                                isSelected ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'
                              } ${getColumnWidthClass(header)}`}
                              title={cellText}
                            >
                              {isStatusCol && cellText ? (
                                renderStatusBadge(cellText, debouncedQuery)
                              ) : (
                                <div
                                  className={`${
                                    isMono ? 'font-mono text-[11.5px] tabular-nums text-[var(--text-primary)]' : ''
                                  } ${
                                    wrapText
                                      ? 'whitespace-normal break-words leading-relaxed'
                                      : 'truncate max-w-xs'
                                  }`}
                                >
                                  {cellText ? (
                                    <HighlightMatch text={cellText} query={debouncedQuery} />
                                  ) : (
                                    <span className="text-[var(--text-muted)] opacity-50">—</span>
                                  )}
                                </div>
                              )}
                            </td>
                          );
                        })}

                        <td
                          className={`sticky right-0 z-10 px-3 py-2.5 text-center align-middle border-l border-[var(--border-subtle)] transition-colors ${
                            isSelected
                              ? 'bg-[var(--bg-base)]'
                              : isFocused
                              ? 'bg-[var(--bg-elevated)]'
                              : 'bg-[var(--bg-base)] group-hover:bg-[var(--bg-surface)]'
                          }`}
                        >
                          {photoInfo.count > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--accent-green)]/30 bg-[var(--accent-green)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-green)] whitespace-nowrap shadow-sm">
                              <ImageIcon size={11} />
                              {photoInfo.count} {photoInfo.count === 1 ? 'foto' : 'fotos'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)] whitespace-nowrap">
                              <ImageIcon size={11} className="opacity-35" />
                              0 fotos
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                  )}
                </tbody>
              </table>
            )}
          </div>

          {showDetailPane && focusedRowData && (
            <aside className="w-80 sm:w-96 border-l border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 flex flex-col overflow-hidden animate-fade-in">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent-primary)] font-mono text-xs font-bold text-[var(--text-on-accent)]">
                    #{focusedRowIndex + 1}
                  </span>
                  <span className="text-[13px] font-semibold text-[var(--text-primary)]">Detalle del Registro</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => copyToClipboard(JSON.stringify(focusedRowData, null, 2), 'Registro JSON')}
                    className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
                    title="Copiar JSON del registro"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDetailPane(false)}
                    className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
                    aria-label="Cerrar panel de detalle"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4 pp-data-table-scroll">
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                      <ImageIcon size={13} className="text-[var(--accent-primary)]" />
                      Fotos Vinculadas
                    </span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        focusedRowPhotoInfo.count > 0
                          ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)] border border-[var(--accent-green)]/30'
                          : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
                      }`}
                    >
                      {focusedRowPhotoInfo.count} {focusedRowPhotoInfo.count === 1 ? 'foto' : 'fotos'}
                    </span>
                  </div>

                  {focusedRowPhotoInfo.count > 0 ? (
                    <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                      {focusedRowPhotoInfo.files.map((file, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between text-[11px] text-[var(--text-secondary)] bg-[var(--bg-elevated)]/60 px-2 py-1 rounded border border-[var(--border-subtle)]"
                        >
                          <span className="truncate font-mono">{file.name}</span>
                          <span className="text-[9px] text-[var(--text-muted)] shrink-0 font-mono ml-2">
                            {(file.size / 1024).toFixed(0)} KB
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-[var(--text-muted)] italic">
                      No se encontraron fotos que coincidan con el ID de este registro.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] block">
                    Campos de Datos
                  </span>
                  {headers.map((header) => {
                    const val = focusedRowData[header];
                    const text = val !== null && val !== undefined ? String(val).trim() : '';
                    return (
                      <div
                        key={header}
                        className="group/field relative rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5 hover:border-[var(--border-medium)] transition-colors"
                      >
                        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
                          <span className="font-semibold">{header}</span>
                          {text && (
                            <button
                              type="button"
                              onClick={() => copyToClipboard(text, header)}
                              className="opacity-0 group-hover/field:opacity-100 p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
                              title={`Copiar ${header}`}
                            >
                              <Copy size={11} />
                            </button>
                          )}
                        </div>
                        <div className="text-[12px] text-[var(--text-primary)] font-medium break-words leading-snug">
                          {text || <span className="text-[var(--text-muted)] opacity-50 italic">Vacío</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                <button
                  type="button"
                  onClick={() => handleRowClick(focusedRowIndex)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-[var(--text-on-accent)] text-[12px] font-semibold transition-colors shadow-sm"
                >
                  <Check size={13} /> Cargar este registro en el visor
                </button>
              </div>
            </aside>
          )}
        </div>

        <div className="relative z-20 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-3 text-[11px] shadow-[0_-6px_20px_rgba(0,0,0,0.28)]">
          <div className="flex items-center gap-3 text-[var(--text-secondary)]">
            <span className="flex items-center gap-1.5 font-medium text-[var(--accent-primary)]">
              <Info size={13} />
              <span>Doble clic en una fila o presiona <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] font-mono text-[10px]">Enter</kbd> para seleccionarla</span>
            </span>

            {selectedRecordId && (
              <span className="hidden sm:inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-[var(--accent-primary)]/10 px-2 py-0.5 font-medium text-[var(--accent-primary)]">
                <Check size={11} />
                Seleccionado: #{currentSelectedOriginalIdx + 1} ({selectedRecordId})
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-4 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] hover:border-[var(--border-active)] hover:text-[var(--text-primary)] transition-colors"
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={() => {
                if (focusedRowIndex >= 0 && focusedRowIndex < data.length) {
                  onSelectRow(focusedRowIndex);
                  onClose();
                }
              }}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-4 py-1.5 text-[12px] font-semibold text-[var(--text-on-accent)] shadow-sm hover:bg-[var(--accent-primary-hover)] transition-colors"
            >
              <Check size={13} />
              Cargar registro #{focusedRowIndex + 1}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
