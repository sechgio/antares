import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import {
  CheckCircle, AlertCircle, RotateCcw, ChevronLeft, ChevronRight, ChevronDown,
  FileSpreadsheet, Image as ImageIcon, FileCode, Settings,
  Printer, Search, Table2, Download, Loader2,
} from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../hooks/useToast';
import { useBackendStatus } from '../../hooks/useBackendStatus';
import { mapWithConcurrencyLimit } from '../../utils/mapWithConcurrencyLimit';
import PreviewPanel, { renderPreviewHtml } from './PreviewPanel';
import TemplatePicker from './TemplatePicker';
import { REPORT_FIELDS } from './constants';
import {
  excelSerialToDate, isDateColumn,
  validateTemplateStructure, matchesRecordId, naturalSortByName,
} from './utils';
import {
  buildPdfFilename,
  imageToPdfSource,
  mergeHtmlDocuments,
  selectRowsForPdfExport,
  type PdfExportScope,
  type PdfQuality,
} from './pdfExport';
import DataPreviewModal from './DataPreviewModal';
import './template-picker.css';

interface TemplateInfo {
  id: string;
  name: string;
  filename: string;
}

interface CustomColumn {
  id: string;
  name: string;
  mappedTo: string;
}

interface StepProps {
  number: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  status?: 'pending' | 'done';
}

const LOGO_LEFT_KEY = 'antares_preview_logo_left';
const LOGO_RIGHT_KEY = 'antares_preview_logo_right';
const CUSTOM_COLS_KEY = 'antares_preview_custom_columns';
const PERSISTED_LOGO_MAX_EDGE = 900;
const PERSISTED_LOGO_QUALITY = 0.86;

function loadPersistedLogo(key: string): { dataUrl: string; fileName: string } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function savePersistedLogo(key: string, dataUrl: string, fileName: string) {
  try { localStorage.setItem(key, JSON.stringify({ dataUrl, fileName })); } catch { /* ignore */ }
}

function clearPersistedLogo(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = evt => resolve(String(evt.target?.result || ''));
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo procesar la imagen'));
    img.src = dataUrl;
  });
}

async function compressLogoForStorage(file: File): Promise<string> {
  const original = await readFileAsDataUrl(file);
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return original;
  }

  try {
    const img = await loadImage(original);
    const maxEdge = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = maxEdge > PERSISTED_LOGO_MAX_EDGE ? PERSISTED_LOGO_MAX_EDGE / maxEdge : 1;
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0, width, height);
    const compressed = canvas.toDataURL('image/webp', PERSISTED_LOGO_QUALITY);
    return compressed.length < original.length ? compressed : original;
  } catch {
    return original;
  }
}

function Step({ number, title, icon, children, disabled, badge, defaultOpen = true, status = 'pending' }: StepProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const done = status === 'done';

  return (
    <div className={`rounded-lg border transition-colors ${isOpen ? 'border-[var(--border-medium)] bg-[var(--bg-elevated)]' : 'border-[var(--border-subtle)] bg-transparent hover:border-[var(--border-medium)]'} ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <button
        type="button"
        onClick={() => setIsOpen(v => !v)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2 px-2 py-2 group cursor-pointer select-none rounded-lg"
      >
        <span className={`inline-flex h-[20px] w-[20px] items-center justify-center rounded-full text-[10px] font-bold shrink-0 transition-colors ${done ? 'bg-[var(--accent-green)] text-[var(--text-on-accent)]' : isOpen ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)]' : 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] ring-1 ring-inset ring-[var(--accent-primary)]/30'}`}>
          {done ? <CheckCircle size={12} /> : number}
        </span>
        <span className="text-[11px] font-semibold text-[var(--text-primary)] truncate">{title}</span>
        <span className="text-[var(--text-muted)] shrink-0">{icon}</span>
        {badge && <span className="ml-auto mr-1">{badge}</span>}
        <ChevronDown
          size={12}
          className={`ml-auto text-[var(--text-muted)] transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-0' : '-rotate-90'}`}
        />
      </button>
      <div
        ref={contentRef}
        className="overflow-hidden transition-all duration-200 ease-in-out"
        style={{
          maxHeight: isOpen ? `${contentRef.current?.scrollHeight ?? 800}px` : '0px',
          opacity: isOpen ? 1 : 0,
        }}
      >
        <div className="px-2 pb-2 pt-0.5">{children}</div>
      </div>
    </div>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
}: {
  value: T;
  onChange: (next: T) => void;
  options: SegmentedOption<T>[];
  'aria-label'?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex gap-0.5 rounded-md bg-[var(--bg-input)] p-0.5">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`flex-1 rounded px-2 py-1.5 text-[10px] font-medium transition-all duration-150 ${
              active
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm ring-1 ring-[var(--border-medium)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default function PreviewPanelView() {
  const { addToast } = useToast();
  const { backendState } = useBackendStatus();
  const panelRef = useRef<HTMLIFrameElement>(null);

  // ─── Data State ───
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [images, setImages] = useState<File[]>([]);
  const [sheets, setSheets] = useState<Array<{ name: string; rows: unknown[][]; rowCount?: number }>>([]);
  const [selectedSheetName, setSelectedSheetName] = useState('');
  /** Spill cache token from spreadsheet_parse — rows loaded per sheet on demand. */
  const [spillToken, setSpillToken] = useState<string | null>(null);
  const spillTokenRef = useRef<string | null>(null);
  spillTokenRef.current = spillToken;
  const sheetLoadGenRef = useRef(0);

  const releaseSpillToken = useCallback(async (token: string | null) => {
    if (!token) return;
    try {
      await api.fileTokenCleanup(token);
    } catch (err) {
      // Best-effort: 24h sweep still covers leftovers.
      console.warn('[preview] spill cleanup failed:', err instanceof Error ? err.message : err);
    }
  }, []);

  useEffect(() => () => {
    void releaseSpillToken(spillTokenRef.current);
  }, [releaseSpillToken]);

  // ─── Config State ───
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [idColumn, setIdColumn] = useState('');

  // ─── Selection State ───
  const [selectedIndex, setSelectedIndex] = useState('');
  const [searchOrder, setSearchOrder] = useState('');

  // ─── Logos ───
  const [logoLeft, setLogoLeft] = useState<string | null>(null);
  const [logoRight, setLogoRight] = useState<string | null>(null);

  // ─── Template State ───
  const [customTemplate, setCustomTemplate] = useState<{ name: string; content: string } | null>(null);
  const [templateStatus, setTemplateStatus] = useState<'valid' | 'invalid' | null>(null);
  const [templateError, setTemplateError] = useState('');
  const [availableTemplates, setAvailableTemplates] = useState<TemplateInfo[]>([]);

  // ─── Custom Columns ───
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>(() => {
    try { const s = localStorage.getItem(CUSTOM_COLS_KEY); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [showColumnModal, setShowColumnModal] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [newColumnMapping, setNewColumnMapping] = useState('');
  const [columnError, setColumnError] = useState('');

  // ─── Images Required ───
  const [requiresImages, setRequiresImages] = useState(true);

  // ─── Data Preview ───
  const [showDataPreview, setShowDataPreview] = useState(false);

  // ─── Focus Mode ───
  const [isFocusMode, setIsFocusMode] = useState(false);

  // ─── PDF Export ───
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [pdfLoadingMessage, setPdfLoadingMessage] = useState('');
  const [exportScope, setExportScope] = useState<PdfExportScope>('single');
  const [pdfQuality, setPdfQuality] = useState<PdfQuality>('high');

  // ─── Drag states ───
  const [dragStep2, setDragStep2] = useState(false);
  const [dragStep4, setDragStep4] = useState(false);

  // ─── Load persisted logos ───
  useEffect(() => {
    const l = loadPersistedLogo(LOGO_LEFT_KEY);
    if (l) setLogoLeft(l.dataUrl);
    const r = loadPersistedLogo(LOGO_RIGHT_KEY);
    if (r) setLogoRight(r.dataUrl);
  }, []);

  useEffect(() => {
    if (logoLeft) savePersistedLogo(LOGO_LEFT_KEY, logoLeft, 'logo-left');
    else clearPersistedLogo(LOGO_LEFT_KEY);
  }, [logoLeft]);

  useEffect(() => {
    if (logoRight) savePersistedLogo(LOGO_RIGHT_KEY, logoRight, 'logo-right');
    else clearPersistedLogo(LOGO_RIGHT_KEY);
  }, [logoRight]);

  useEffect(() => {
    try { localStorage.setItem(CUSTOM_COLS_KEY, JSON.stringify(customColumns)); } catch { /* ignore */ }
  }, [customColumns]);

  // ─── Load backend templates ───
  const loadTemplates = useCallback(async () => {
    try {
      const res = await api.templatesList();
      const templates = (res.templates || []).filter(
        (t) => t.source !== 'canvas' && !String(t.filename || '').startsWith('canvas:'),
      );
      setAvailableTemplates(templates);
      return templates;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadTemplates().then((templates) => {
      if (cancelled) return;
      if (!templates || templates.length === 0) {
        const timer = setTimeout(() => {
          if (!cancelled) void loadTemplates();
        }, 1500);
        return () => clearTimeout(timer);
      }
    });
    return () => { cancelled = true; };
  }, [backendState, loadTemplates]);

  // ─── Logo upload ───
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>, side: 'left' | 'right') => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await compressLogoForStorage(file);
      if (side === 'left') setLogoLeft(result);
      else setLogoRight(result);
    } catch {
      addToast({ message: 'No se pudo cargar el logo seleccionado', type: 'error' });
    }
  };

  // ─── Template upload ───
  const handleTemplateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.html')) {
      setTemplateStatus('invalid');
      setTemplateError('Solo se aceptan archivos .html');
      return;
    }
    const reader = new FileReader();
    reader.onload = evt => {
      const content = String(evt.target?.result || '');
      const validation = validateTemplateStructure(content);
      if (validation.valid) {
        setCustomTemplate({ name: file.name, content });
        setTemplateStatus('valid');
        setTemplateError('');
        const lc = content.toLowerCase();
        setRequiresImages(lc.includes('report.images') || lc.includes('photo-grid') || lc.includes('panel-fotografico'));
      } else {
        setCustomTemplate(null);
        setTemplateStatus('invalid');
        setTemplateError(validation.error);
      }
    };
    reader.onerror = () => {
      setCustomTemplate(null);
      setTemplateStatus('invalid');
      setTemplateError('No se pudo leer la plantilla');
    };
    reader.readAsText(file);
  };

  const handleResetTemplate = () => {
    setCustomTemplate(null);
    setTemplateStatus(null);
    setTemplateError('');
    setRequiresImages(true);
    const input = document.getElementById('templateInput') as HTMLInputElement;
    if (input) input.value = '';
  };

  const handleBackendTemplateSelect = async (filename: string) => {
    if (!filename) return;
    try {
      const res = await api.templateGet(filename);
      const validation = validateTemplateStructure(res.content);
      if (validation.valid) {
        setCustomTemplate({ name: res.name, content: res.content });
        setTemplateStatus('valid');
        setTemplateError('');
        const lc = res.content.toLowerCase();
        setRequiresImages(lc.includes('report.images') || lc.includes('photo-grid') || lc.includes('panel-fotografico'));
      } else {
        setCustomTemplate(null);
        setTemplateStatus('invalid');
        setTemplateError(validation.error);
      }
    } catch {
      setTemplateStatus('invalid');
      setTemplateError('Error al cargar la plantilla del servidor');
    }
  };

  // ─── File upload (Excel/CSV) ───
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await parseFile(file);
  };

  const autoMapFields = useCallback((_headers: string[]) => {
    const newMap: Record<string, string> = {};
    REPORT_FIELDS.forEach(field => {
      const match = _headers.find(h =>
        h.toLowerCase().includes(field.id) ||
        h.toLowerCase().includes(field.label.toLowerCase())
      );
      if (match) newMap[field.id] = match;
    });
    setMappings(newMap);
    setIdColumn(prev => {
      if (prev && _headers.includes(prev)) return prev;
      return _headers[0] || '';
    });
  }, []);

  const loadSheetData = useCallback((sheet: { name: string; rows: unknown[][] }) => {
    const jsonData = sheet.rows;
    if (!jsonData.length) {
      addToast({ message: 'El archivo está vacío o no tiene filas con datos', type: 'error' });
      return false;
    }
    const _headers = (jsonData[0] ?? []).map(v => String(v ?? '').trim());
    if (_headers.every(h => !h)) {
      addToast({ message: 'El archivo no tiene cabeceras válidas', type: 'error' });
      return false;
    }
    const _data = jsonData.slice(1).map(row => {
      const obj: Record<string, unknown> = {};
      _headers.forEach((h, i) => {
        if (!h) return;
        let cellValue = row[i];
        if (isDateColumn(h) && typeof cellValue === 'number' && cellValue > 1000 && cellValue < 100000) {
          cellValue = excelSerialToDate(cellValue);
        }
        obj[h] = cellValue;
      });
      return obj;
    });
    if (_data.length === 0) { addToast({ message: 'El archivo no contiene filas de datos', type: 'error' }); return false; }
    setHeaders(_headers);
    setData(_data);
    autoMapFields(_headers);
    setSelectedIndex('');
    setShowDataPreview(true);
    return true;
  }, [addToast, autoMapFields]);

  const fetchSheetRows = useCallback(async (token: string, sheetName: string): Promise<unknown[][]> => {
    const rows: unknown[][] = [];
    let offset = 0;
    for (;;) {
      const page = await api.spreadsheetGetRows({
        result_file_token: token,
        sheet: sheetName,
        offset,
        limit: 2000,
      });
      rows.push(...page.rows);
      if (!page.has_more) break;
      offset += page.rows.length;
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    return rows;
  }, []);

  const handleSheetChange = useCallback(async (nextName: string) => {
    setSelectedSheetName(nextName);
    const gen = ++sheetLoadGenRef.current;
    let sh = sheets.find(s => s.name === nextName);
    if (spillToken) {
      // Spill rows are re-fetchable; keep only the selected sheet in RAM.
      setSheets(prev => prev.map(s => (
        s.name === nextName || s.rows.length === 0 ? s : { ...s, rows: [] }
      )));
    }
    if (sh && sh.rows.length === 0 && spillToken) {
      try {
        const rows = await fetchSheetRows(spillToken, nextName);
        if (gen !== sheetLoadGenRef.current) return;
        sh = { ...sh, rows, rowCount: rows.length };
        setSheets(prev => prev.map(s => (s.name === nextName ? sh! : s)));
      } catch (err: unknown) {
        if (gen !== sheetLoadGenRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        addToast({ message: msg || 'No se pudo cargar la hoja', type: 'error' });
        return;
      }
    }
    if (sh) loadSheetData(sh);
  }, [sheets, spillToken, fetchSheetRows, loadSheetData, addToast]);

  const applyParsedSheets = useCallback((allSheets: { name: string; rows: unknown[][]; rowCount?: number }[], warnings?: string[]) => {
    if (!allSheets.length) {
      addToast({ message: 'El archivo está vacío o no tiene hojas', type: 'error' });
      return;
    }
    warnings?.forEach(w => addToast({ message: w, type: 'warning' }));
    // Prefer a sheet with header + at least one data row (skip cover sheets with only a title)
    const rowLen = (s: { rows: unknown[][]; rowCount?: number }) =>
      s.rows.length > 0 ? s.rows.length : (s.rowCount ?? 0);
    const withData = allSheets.filter(s => rowLen(s) > 1);
    const fallback = allSheets.filter(s => rowLen(s) > 0);
    const pick = withData[0] ?? fallback[0];
    if (!pick) {
      addToast({ message: 'El archivo está vacío o no tiene filas con datos', type: 'error' });
      setSheets(allSheets);
      return;
    }
    setSheets(allSheets);
    setSelectedSheetName(pick.name);
    if (pick.rows.length > 0) {
      loadSheetData(pick);
    }
  }, [addToast, loadSheetData]);

  /** Parse Excel/CSV via backend staging only (no SheetJS on the renderer). */
  const parseFile = async (file: File) => {
    const win = window as unknown as {
      electronAPI?: {
        fileStagedCreate: (n: string, s: number) => Promise<{ token: string }>;
        fileStagedAppend: (t: string, c: ArrayBuffer | Uint8Array | string) => Promise<unknown>;
        fileStagedComplete: (t: string) => Promise<{ file_token: string }>;
      };
    };

    if (!win.electronAPI?.fileStagedCreate) {
      addToast({ message: 'Importar Excel requiere la app de escritorio Antares', type: 'error' });
      return;
    }

    try {
      const { stageFileForIpc } = await import('../../utils/stageFile');
      const fileToken = await stageFileForIpc(file);
      if (!fileToken) throw new Error('No se pudo preparar el archivo para lectura');
      const ext = file.name.toLowerCase().split('.').pop() || '';
      const formatHint = ['xlsx', 'xls', 'csv'].includes(ext) ? ext : undefined;
      // Avoid hydrating multi-MB spill JSON in one shot — page via get_rows.
      const prevSpill = spillTokenRef.current;
      const res = await api.spreadsheetParse(
        { file_token: fileToken, format_hint: formatHint },
        { hydrate: false },
      );
      if (prevSpill && prevSpill !== res.result_file_token) {
        void releaseSpillToken(prevSpill);
      }

      if (res.result_file_token && res.sheet_meta?.length) {
        const token = res.result_file_token;
        setSpillToken(token);
        const stubs = res.sheet_meta.map((m) => ({
          name: m.name,
          rows: [] as unknown[][],
          rowCount: m.rowCount,
        }));
        const withData = stubs.filter((s) => (s.rowCount ?? 0) > 1);
        const fallback = stubs.filter((s) => (s.rowCount ?? 0) > 0);
        const pick = withData[0] ?? fallback[0];
        if (!pick) {
          applyParsedSheets(stubs, res.warnings);
          return;
        }
        const rows = await fetchSheetRows(token, pick.name);
        const loaded = stubs.map((s) =>
          s.name === pick.name ? { ...s, rows, rowCount: rows.length } : s,
        );
        applyParsedSheets(loaded, res.warnings);
        return;
      }

      setSpillToken(null);
      applyParsedSheets(res.sheets, res.warnings);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast({ message: msg || 'No se pudo leer el archivo Excel/CSV', type: 'error' });
    }
  };

  // ─── Image upload ───
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
    setImages(prev => [...prev, ...files]);
  };

  // ─── Custom Columns ───
  const addCustomColumn = () => {
    if (!newColumnName.trim()) { setColumnError('El nombre de la columna es requerido'); return; }
    if (!newColumnMapping) { setColumnError('Debe seleccionar una columna del Excel'); return; }

    const allNames = [
      ...REPORT_FIELDS.map(f => f.label.toLowerCase()),
      ...customColumns.map(c => c.name.toLowerCase()),
    ];
    if (allNames.includes(newColumnName.trim().toLowerCase())) {
      setColumnError('Ya existe una columna con ese nombre'); return;
    }

    const newCol: CustomColumn = {
      id: `custom_${Date.now()}`,
      name: newColumnName.trim().toUpperCase(),
      mappedTo: newColumnMapping,
    };
    setCustomColumns(prev => [...prev, newCol]);
    setMappings(prev => ({ ...prev, [newCol.id]: newColumnMapping }));
    resetColumnModal();
  };

  const handleCustomColumnKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    // Solo desde inputs de texto: el picker usa Enter para elegir opción.
    if ((event.target as HTMLElement).tagName !== 'INPUT') return;
    event.preventDefault();
    addCustomColumn();
  };

  const removeCustomColumn = (id: string) => {
    setCustomColumns(prev => prev.filter(c => c.id !== id));
    setMappings(prev => { const n = { ...prev }; delete n[id]; return n; });
  };

  const resetColumnModal = () => {
    setShowColumnModal(false);
    setNewColumnName('');
    setNewColumnMapping('');
    setColumnError('');
  };

  // ─── Filtered images for selected row ───
  const filteredImages = useMemo(() => {
    if (selectedIndex === '' || !idColumn) return [];
    const idx = Number(selectedIndex);
    if (Number.isNaN(idx) || idx < 0 || idx >= data.length) return [];
    const row = data[idx];
    const recordId = String(row[idColumn] ?? '');
    if (!recordId) return [];

    const filtered = images.filter(img => matchesRecordId(img.name, recordId));
    const seen = new Set<string>();
    const unique = filtered.filter(img => {
      if (seen.has(img.name)) return false;
      seen.add(img.name);
      return true;
    });
    return unique.sort(naturalSortByName);
  }, [selectedIndex, data, idColumn, images]);

  // ─── Per-step completion (drives sidebar progress + status badges) ───
  const stepStates = useMemo(() => [
    !!(logoLeft || logoRight),
    templateStatus === 'valid',
    data.length > 0,
    !!idColumn,
    !requiresImages || images.length > 0,
    data.length > 0 && (exportScope === 'all' || selectedIndex !== ''),
  ], [logoLeft, logoRight, templateStatus, data.length, idColumn, requiresImages, images.length, exportScope, selectedIndex]);
  const completedCount = stepStates.filter(Boolean).length;
  const columnOptions = useMemo(
    () => headers.map((h) => ({ value: h, label: h })),
    [headers],
  );

  const canPrevRow = selectedIndex !== '' && parseInt(selectedIndex) > 0;
  const canNextRow = selectedIndex !== '' && parseInt(selectedIndex) < data.length - 1;
  const goToPrevRow = () => { if (canPrevRow) setSelectedIndex(String(parseInt(selectedIndex) - 1)); };
  const goToNextRow = () => { if (canNextRow) setSelectedIndex(String(parseInt(selectedIndex) + 1)); };

  // ─── Keyboard shortcuts ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '.' && e.ctrlKey) {
        e.preventDefault();
        setIsFocusMode(v => !v);
      }
      if (isFocusMode) {
        if (e.key === 'ArrowLeft') goToPrevRow();
        if (e.key === 'ArrowRight') goToNextRow();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isFocusMode, canPrevRow, canNextRow, selectedIndex]);

  const handlePrint = () => {
    const iframe = panelRef.current;
    if (iframe?.contentWindow) iframe.contentWindow.print();
  };

  const handleDownloadPdf = async () => {
    if (exportScope === 'single' && selectedIndex === '') {
      addToast({ message: 'Selecciona una fila antes de descargar el PDF.', type: 'error' });
      return;
    }

    try {
      setIsPdfLoading(true);
      const selectedRows = selectRowsForPdfExport({
        data,
        selectedIndex,
        exportScope,
        idColumn,
        requiresImages,
        images,
      });

      if (selectedRows.length === 0) {
        throw new Error(exportScope === 'all'
          ? 'No hay registros con imágenes asociadas para consolidar.'
          : 'No hay una vista previa lista para exportar.');
      }

      const filename = buildPdfFilename({
        exportScope,
        templateName: customTemplate?.name,
        idValue: selectedRows[0]?.idValue,
      });
      const saveTarget = await api.dialogSave({
        title: 'Guardar PDF',
        defaultPath: filename,
        filters: [
          { name: 'PDF', extensions: ['pdf'] },
          { name: 'Todos los archivos', extensions: ['*'] },
        ],
      });
      const outputPath = saveTarget.paths[0];
      if (!outputPath) return;

      setPdfLoadingMessage(exportScope === 'all'
        ? `Generando PDF consolidado (${selectedRows.length})...`
        : 'Generando PDF...');

      const localImagePaths: Record<string, string> = {};
      const documents = await mapWithConcurrencyLimit(selectedRows, 2, async item => {
        const imageSources = await mapWithConcurrencyLimit(item.images, 4, (img, imageIndex) =>
          imageToPdfSource(img, pdfQuality, `row-${item.rowIndex}-img-${imageIndex}`)
        );
        imageSources.forEach(source => {
          if (source.token && source.fileToken) {
            localImagePaths[source.token] = source.fileToken;
          }
        });
        return renderPreviewHtml({
          data: item.row,
          images: item.images,
          imageUrls: imageSources.map(source => source.src),
          mappings,
          logoLeft,
          logoRight,
          customTemplate,
          customColumns,
        });
      });

      const html = exportScope === 'all' ? mergeHtmlDocuments(documents) : documents[0];
      const res = await api.htmlToPdf({
        html,
        filename,
        outputPath,
        localImagePaths: Object.keys(localImagePaths).length > 0 ? localImagePaths : undefined,
      });
      addToast({
        message: res.saved_path
          ? `PDF guardado: ${res.filename || filename}`
          : 'PDF generado correctamente.',
        type: 'success',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo generar el PDF.';
      addToast({ message, type: 'error' });
    } finally {
      setIsPdfLoading(false);
      setPdfLoadingMessage('');
    }
  };

  return (
    <div className="flex h-full w-full bg-[var(--bg-base)] text-[var(--text-primary)] overflow-hidden">
      {/* Sidebar */}
      <aside className={`flex flex-col bg-[var(--bg-surface)] border-r border-[var(--border-subtle)] transition-all duration-300 ${isFocusMode ? 'w-0 overflow-hidden opacity-0 border-none' : 'w-[340px]'}`}>
        {/* Sidebar header — identity + workflow progress */}
        <div className="shrink-0 h-11 px-3 flex items-center border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2 w-full">
            <div className="flex-1 flex gap-1" aria-hidden>
              {stepStates.map((done, i) => (
                <span key={i} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${done ? 'bg-[var(--accent-green)]' : 'bg-[var(--border-medium)]'}`} />
              ))}
            </div>
            <span className="text-[9px] font-semibold text-[var(--text-muted)] tabular-nums shrink-0 leading-none">{completedCount}/6</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">

          {/* Step 0: Logos */}
          <Step number="0" title="Logos y Cabecera" icon={<Settings size={12} />} defaultOpen={!!(logoLeft || logoRight)} status={stepStates[0] ? 'done' : 'pending'}>
            <div className="grid grid-cols-2 gap-1.5">
              {(['left', 'right'] as const).map(side => {
                const logo = side === 'left' ? logoLeft : logoRight;
                const inputId = side === 'left' ? 'logoLeftInput' : 'logoRightInput';
                return (
                  <div
                    key={side}
                    className="border border-dashed border-[var(--border-medium)] h-11 rounded-md flex items-center justify-center cursor-pointer hover:bg-[var(--bg-elevated)] relative overflow-hidden transition-colors"
                    onClick={() => document.getElementById(inputId)?.click()}
                  >
                    {logo
                      ? <img src={logo} className="h-full object-contain" alt={`Logo ${side}`} />
                      : <span className="text-[9px] text-[var(--text-muted)]">{side === 'left' ? 'Logo Izq' : 'Logo Der'}</span>
                    }
                  </div>
                );
              })}
              <input id="logoLeftInput" type="file" hidden accept="image/*" onChange={e => handleLogoUpload(e, 'left')} />
              <input id="logoRightInput" type="file" hidden accept="image/*" onChange={e => handleLogoUpload(e, 'right')} />
            </div>
          </Step>

          {/* Step 1: Template */}
          <Step
            number="1"
            title="Plantilla"
            icon={<FileCode size={12} />}
            badge={templateStatus === 'valid' ? <CheckCircle size={11} className="text-[var(--accent-green)]" /> : templateStatus === 'invalid' ? <AlertCircle size={11} className="text-[var(--accent-red)]" /> : null}
            status={stepStates[1] ? 'done' : 'pending'}
          >
            <div className="space-y-1.5">
              <label className="block w-full cursor-pointer">
                <div className={`border border-dashed rounded-md py-1.5 px-2 text-center transition-colors text-[10px] ${templateStatus === 'valid' ? 'border-[var(--accent-green)]/50 bg-[var(--accent-green)]/5 text-[var(--accent-green)]' : templateStatus === 'invalid' ? 'border-[var(--accent-red)]/50 bg-[var(--accent-red)]/5 text-[var(--accent-red)]' : 'border-[var(--border-medium)] hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)]'}`}>
                  {customTemplate ? customTemplate.name : 'Subir Plantilla HTML'}
                </div>
                <input id="templateInput" type="file" hidden accept=".html" onChange={handleTemplateUpload} />
              </label>

              <TemplatePicker
                aria-label="Elegir plantilla"
                placeholder={availableTemplates.length === 0 ? 'Sin plantillas' : '-- Elegir Plantilla --'}
                value={availableTemplates.some(t => t.filename === customTemplate?.name) ? customTemplate?.name ?? '' : ''}
                options={availableTemplates.map(t => ({ value: t.filename, label: t.name }))}
                onChange={handleBackendTemplateSelect}
              />

              {templateStatus === 'invalid' && templateError && (
                <div className="text-[9px] text-[var(--accent-red)] px-0.5">⚠️ {templateError}</div>
              )}

              <div className="flex items-center justify-between gap-2">
                <div className={`flex-1 flex items-center justify-between px-2 py-1 rounded-md text-[9px] border ${customTemplate ? 'bg-[var(--accent-green)]/5 border-[var(--accent-green)]/20' : 'bg-[var(--bg-elevated)] border-[var(--border-medium)]'}`}>
                  <span className="text-[var(--text-muted)]">Activa:</span>
                  <span className={customTemplate ? 'text-[var(--accent-green)] font-medium' : 'text-[var(--text-muted)]'}>
                    {customTemplate ? customTemplate.name : 'Predeterminada'}
                  </span>
                </div>
                {customTemplate && (
                  <WithHoverTooltip label="Usar Plantilla Predeterminada" placement="bottom">
                    <button onClick={handleResetTemplate} className="shrink-0 p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors">
                      <RotateCcw size={12} />
                    </button>
                  </WithHoverTooltip>
                )}
              </div>

              <div className="flex items-center justify-between px-2 py-1 rounded-md border border-[var(--border-medium)] bg-[var(--bg-elevated)]">
                <div className="flex items-center gap-1.5">
                  <ImageIcon size={10} className={requiresImages ? 'text-[var(--text-muted)]' : 'text-amber-400'} />
                  <span className="text-[9px] text-[var(--text-muted)]">Requiere imágenes</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={requiresImages} onChange={e => setRequiresImages(e.target.checked)} className="sr-only peer" />
                  <div className="w-7 h-3.5 bg-[var(--bg-base)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-[var(--text-on-accent)] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[var(--text-primary)] after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-[var(--accent-green)] border border-[var(--border-medium)]"></div>
                </label>
              </div>
            </div>
          </Step>

          {/* Step 2: Data */}
          <Step
            number="2"
            title="Datos"
            icon={<FileSpreadsheet size={12} />}
            badge={data.length > 0 ? <span className="text-[9px] text-[var(--accent-green)] font-medium">{data.length}</span> : null}
            status={stepStates[2] ? 'done' : 'pending'}
          >
            <div className="space-y-1.5">
              <label className="block w-full cursor-pointer">
                <div
                  onDragOver={e => { e.preventDefault(); setDragStep2(true); }}
                  onDragEnter={e => { e.preventDefault(); setDragStep2(true); }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragStep2(false); }}
                  onDrop={e => {
                    e.preventDefault(); setDragStep2(false);
                    const [file] = Array.from(e.dataTransfer.files || []);
                    if (!file) return;
                    const name = file.name.toLowerCase();
                    if (name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls')) {
                      parseFile(file);
                    }
                  }}
                  className={`border border-dashed rounded-md py-1.5 text-center transition-colors ${dragStep2 ? 'border-[var(--accent-primary)] bg-[var(--bg-elevated)]' : 'border-[var(--border-medium)] hover:bg-[var(--bg-elevated)]'}`}
                >
                  <span className={`text-[10px] ${dragStep2 ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                    {dragStep2 ? 'Soltar aquí' : headers.length > 0 ? `${data.length} registros cargados` : 'Seleccionar Excel / CSV'}
                  </span>
                </div>
                <input type="file" hidden accept=".csv,.xlsx,.xls" onChange={handleFileUpload} />
              </label>
              {sheets.length > 1 && (
                <div>
                  <label className="block text-[var(--text-muted)] text-[9px] mb-0.5 font-semibold uppercase">Hoja</label>
                  <TemplatePicker
                    aria-label="Hoja"
                    placeholder="-- Seleccionar Hoja --"
                    value={selectedSheetName}
                    options={sheets.map(s => {
                      const n = s.rows.length > 0 ? s.rows.length : (s.rowCount ?? 0);
                      return { value: s.name, label: `${s.name} (${Math.max(0, n - 1)} filas)` };
                    })}
                    onChange={(v) => { void handleSheetChange(v); }}
                  />
                </div>
              )}
              {data.length > 0 && (
                <button onClick={() => setShowDataPreview(true)} className="w-full flex items-center justify-center gap-1.5 border border-[var(--border-medium)] hover:border-[var(--text-secondary)] rounded-md py-1 text-center hover:bg-[var(--bg-elevated)] transition-all text-[10px] text-[var(--text-secondary)]">
                  <Table2 size={12} /> Ver Datos
                </button>
              )}
            </div>
          </Step>

          {/* Step 3: Mapping */}
          <Step number="3" title="Mapeo de Columnas" icon={<Settings size={12} />} disabled={headers.length === 0} defaultOpen={false} status={stepStates[3] ? 'done' : 'pending'}>
            <div className="space-y-1.5">
              <div>
                <label className="block text-[var(--text-muted)] text-[9px] mb-0.5 font-semibold uppercase">Columna ID (Clave)</label>
                <TemplatePicker
                  aria-label="Columna ID (Clave)"
                  placeholder="-- Seleccionar ID --"
                  value={idColumn}
                  options={columnOptions}
                  onChange={setIdColumn}
                />
              </div>

              <div className="space-y-1 max-h-40 overflow-y-auto pr-0.5">
                {REPORT_FIELDS.map(field => {
                  const mapped = mappings[field.id] || '';
                  return (
                    <div key={field.id} className="grid grid-cols-[80px_1fr] gap-1.5 items-center">
                      <span className="text-[var(--text-muted)] text-[9px] uppercase font-medium truncate" title={field.label}>{field.label}</span>
                      <TemplatePicker
                        aria-label={field.label}
                        placeholder="Ignorar"
                        value={mapped}
                        options={columnOptions}
                        onChange={(next) => setMappings((prev) => ({ ...prev, [field.id]: next }))}
                        triggerClassName={mapped ? 'border-l-2 border-l-[var(--accent-green)]' : undefined}
                      />
                    </div>
                  );
                })}

                {customColumns.map(col => {
                  const mapped = mappings[col.id] ?? col.mappedTo;
                  return (
                    <div key={col.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-1.5 items-center bg-[var(--bg-elevated)] rounded px-1.5 py-0.5">
                      <span className="text-[var(--text-primary)] text-[9px] uppercase font-medium truncate" title={col.name}>{col.name}</span>
                      <TemplatePicker
                        aria-label={col.name}
                        placeholder="Ignorar"
                        value={mapped}
                        options={columnOptions}
                        onChange={(next) => setMappings((prev) => ({ ...prev, [col.id]: next }))}
                        triggerClassName={mapped ? 'border-l-2 border-l-[var(--accent-primary)]' : undefined}
                      />
                      <WithHoverTooltip label="Eliminar" placement="bottom">
                        <button
                          type="button"
                          aria-label="Eliminar"
                          onClick={() => removeCustomColumn(col.id)}
                          className="text-[var(--accent-red)] hover:opacity-80 text-[9px] px-0.5 hover:bg-[var(--accent-red)]/20 rounded transition-colors"
                        >
                          ✕
                        </button>
                      </WithHoverTooltip>
                    </div>
                  );
                })}
              </div>

              <button onClick={() => setShowColumnModal(true)} className="w-full border border-dashed border-[var(--border-medium)] hover:border-[var(--text-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-md py-1 text-center hover:bg-[var(--bg-elevated)] transition-all flex items-center justify-center gap-1.5 text-[10px]">
                + Columna Personalizada
              </button>
            </div>
          </Step>

          {/* Step 4: Images */}
          <Step
            number="4"
            title={requiresImages ? 'Imágenes' : 'Imágenes (Opcional)'}
            icon={<ImageIcon size={12} />}
            disabled={!idColumn || !requiresImages}
            badge={images.length > 0 ? <span className="text-[9px] text-[var(--accent-green)] font-medium">{images.length}</span> : null}
            status={stepStates[4] ? 'done' : 'pending'}
          >
            {requiresImages ? (
              <label className="block w-full cursor-pointer">
                <div
                  onDragOver={e => { e.preventDefault(); setDragStep4(true); }}
                  onDragEnter={e => { e.preventDefault(); setDragStep4(true); }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragStep4(false); }}
                  onDrop={e => {
                    e.preventDefault(); setDragStep4(false);
                    const dropped = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
                    if (dropped.length) setImages(prev => [...prev, ...dropped]);
                  }}
                  className={`border border-dashed rounded-md py-1.5 text-center transition-colors ${dragStep4 ? 'border-[var(--accent-primary)] bg-[var(--bg-elevated)]' : 'border-[var(--border-medium)] hover:bg-[var(--bg-elevated)]'}`}
                >
                  <span className={`text-[10px] ${dragStep4 ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                    {dragStep4 ? 'Soltar aquí' : images.length > 0 ? `${images.length} imágenes` : 'Subir Carpeta de Fotos'}
                  </span>
                </div>
                <input type="file" hidden multiple accept="image/*" onChange={handleImageUpload} />
              </label>
            ) : (
              <div className="border border-dashed border-[var(--border-medium)] rounded-md py-1.5 text-center bg-[var(--bg-elevated)]">
                <span className="text-[var(--text-muted)] text-[10px]">No requerido</span>
              </div>
            )}
          </Step>

          {/* Step 5: Select Record & Export */}
          <Step number="5" title="Seleccionar y Exportar" icon={<Search size={12} />} disabled={requiresImages ? images.length === 0 : data.length === 0} status={stepStates[5] ? 'done' : 'pending'}>
            <div className="space-y-1.5">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={12} />
                <input
                  type="text"
                  placeholder="Buscar orden..."
                  value={searchOrder}
                  onChange={e => {
                    const term = e.target.value;
                    setSearchOrder(term);
                    if (term) {
                      const matchIdx = data.findIndex((row, idx) => {
                        const label = idColumn ? String(row[idColumn]) : `Fila ${idx + 1}`;
                        return label.toLowerCase().includes(term.toLowerCase()) || String(idx + 1).includes(term);
                      });
                      if (matchIdx !== -1) setSelectedIndex(String(matchIdx));
                    }
                  }}
                  className="w-full pl-7 pr-2 py-1 bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-md text-[var(--text-primary)] text-[10px] outline-none focus:border-[var(--accent-primary)] placeholder:text-[var(--text-muted)]"
                />
              </div>
              <TemplatePicker
                aria-label="Seleccionar fila"
                placeholder="-- Seleccionar Fila --"
                value={selectedIndex}
                options={data.map((row, idx) => ({
                  value: String(idx),
                  label: `${idx + 1}. ${idColumn ? String(row[idColumn]) : `Fila ${idx + 1}`}`,
                }))}
                onChange={setSelectedIndex}
                disabled={exportScope === 'all'}
                maxMenuHeight={280}
                triggerClassName="font-semibold"
              />

              <div className="space-y-1.5 border-t border-[var(--border-subtle)] pt-1.5">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-medium text-[var(--text-muted)]">Alcance</span>
                    <span className="text-[9px] text-[var(--text-muted)]">
                      {exportScope === 'all' ? 'Consolidado' : 'Individual'}
                    </span>
                  </div>
                  <SegmentedControl
                    aria-label="Alcance de exportación"
                    value={exportScope}
                    onChange={setExportScope}
                    options={[
                      { value: 'single', label: 'Solo actual' },
                      { value: 'all', label: `Todo (${data.length})` },
                    ]}
                  />
                </div>

                <div className="space-y-1">
                  <span className="text-[9px] font-medium text-[var(--text-muted)]">Calidad</span>
                  <SegmentedControl
                    aria-label="Calidad del PDF"
                    value={pdfQuality}
                    onChange={setPdfQuality}
                    options={[
                      { value: 'max', label: 'Max' },
                      { value: 'high', label: 'Buena' },
                      { value: 'low', label: 'Baja' },
                    ]}
                  />
                </div>

                <div className="space-y-1.5 pt-0.5">
                  <button
                    onClick={handleDownloadPdf}
                    disabled={(exportScope === 'single' && selectedIndex === '') || data.length === 0 || isPdfLoading}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent-primary)] py-2 px-3 text-[11px] font-semibold text-[var(--text-on-accent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-primary)_40%,transparent)] transition-colors hover:bg-[var(--accent-primary-hover)] disabled:opacity-40"
                  >
                    {isPdfLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    {isPdfLoading ? (pdfLoadingMessage || 'Generando...') : exportScope === 'all' ? 'PDF Consolidado' : 'Descargar PDF'}
                  </button>
                  <button
                    onClick={handlePrint}
                    disabled={selectedIndex === '' || exportScope === 'all'}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[var(--border-medium)] bg-[var(--bg-elevated)] py-1.5 text-[10px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-active)] hover:text-[var(--text-primary)] disabled:opacity-40"
                  >
                    <Printer size={12} /> Imprimir
                  </button>
                </div>
              </div>
            </div>
          </Step>

        </div>


      </aside>

      {/* Main Preview */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <PreviewPanel
          ref={panelRef}
          data={selectedIndex !== '' ? data[parseInt(selectedIndex)] : null}
          images={filteredImages}
          mappings={mappings}
          logoLeft={logoLeft}
          logoRight={logoRight}
          customTemplate={customTemplate}
          customColumns={customColumns}
          isFocusMode={isFocusMode}
        />

        {/* Data Preview Modal */}
        <DataPreviewModal
          open={showDataPreview && data.length > 0}
          onClose={() => setShowDataPreview(false)}
          data={data}
          headers={headers}
          images={images}
          idColumn={idColumn}
          selectedIndex={selectedIndex}
          onSelectRow={(idx) => setSelectedIndex(String(idx))}
          sheetName={selectedSheetName}
        />

        {/* Custom Column Modal */}
        {showColumnModal && (
          <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'color-mix(in srgb, var(--bg-base) 85%, transparent)', backdropFilter: 'blur(6px)' }}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                addCustomColumn();
              }}
              onKeyDown={handleCustomColumnKeyDown}
              className="bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-xl p-5 w-full max-w-md mx-4"
              style={{
                boxShadow:
                  '0 24px 48px color-mix(in srgb, var(--bg-base) 55%, transparent), 0 0 0 1px color-mix(in srgb, var(--border-subtle) 80%, transparent)',
              }}
            >
              <h3 className="text-[var(--text-primary)] font-semibold text-sm mb-4 flex items-center gap-2">
                <span>+</span> Agregar Columna Personalizada
              </h3>
              {columnError && (
                <div className="bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/30 text-[var(--accent-red)] text-[11px] rounded-lg p-2 mb-3 flex items-center gap-2">
                  <AlertCircle size={14} /> {columnError}
                </div>
              )}
              <div className="space-y-3">
                <div>
                  <label className="block text-[var(--text-secondary)] text-[11px] mb-1 font-medium uppercase">Nombre de la Columna</label>
                  <input type="text" value={newColumnName} onChange={e => setNewColumnName(e.target.value)} placeholder="Ej: FECHA CORTE" className="w-full h-8 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-3 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]" />
                </div>
                <div>
                  <label className="block text-[var(--text-secondary)] text-[11px] mb-1 font-medium uppercase">Columna del Excel a Mapear</label>
                  <TemplatePicker
                    aria-label="Columna del Excel a Mapear"
                    placeholder="-- Seleccionar Columna --"
                    value={newColumnMapping}
                    options={columnOptions}
                    onChange={setNewColumnMapping}
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button type="button" onClick={resetColumnModal} className="flex-1 border border-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)] rounded-lg py-2 text-[12px] transition-colors">Cancelar</button>
                <button type="submit" className="flex-1 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-[var(--text-on-accent)] rounded-lg py-2 text-[12px] font-semibold transition-colors">Agregar</button>
              </div>
            </form>
          </div>
        )}

        {/* Focus Mode Navigation */}
        {isFocusMode && (
          <>
            <button onClick={goToPrevRow} disabled={!canPrevRow} className={`fixed left-4 top-1/2 -translate-y-1/2 p-2 transition-colors z-[100] ${!canPrevRow ? 'text-[var(--text-muted)] opacity-30 cursor-not-allowed' : 'text-[var(--accent-primary)] hover:opacity-100 opacity-70'}`}>
              <ChevronLeft size={64} strokeWidth={1.5} />
            </button>
            <button onClick={goToNextRow} disabled={!canNextRow} className={`fixed right-4 top-1/2 -translate-y-1/2 p-2 transition-colors z-[100] ${!canNextRow ? 'text-[var(--text-muted)] opacity-30 cursor-not-allowed' : 'text-[var(--accent-primary)] hover:opacity-100 opacity-70'}`}>
              <ChevronRight size={64} strokeWidth={1.5} />
            </button>
            <div className="fixed top-4 right-4 z-[100] text-[var(--text-muted)] text-[10px] font-mono pointer-events-none select-none px-3 py-1 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--bg-base) 40%, transparent)' }}>
              MODO FOCUS (CTRL + .)
            </div>
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] text-[var(--text-muted)] text-sm font-mono px-4 py-2 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--bg-base) 40%, transparent)' }}>
              {selectedIndex !== '' ? `${parseInt(selectedIndex) + 1} / ${data.length}` : 'Sin registro seleccionado'}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
