import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle, AlertCircle, RotateCcw, ChevronLeft, ChevronRight,
  FileSpreadsheet, Image as ImageIcon, FileCode, Settings,
  Printer, Search, Table2, X, Download, Loader2,
} from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../hooks/useToast';
import PreviewPanel, { renderPreviewHtml } from './PreviewPanel';
import { REPORT_FIELDS, TEMPLATE_HEADERS } from './constants';
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

function Step({ number, title, icon, children, disabled }: StepProps) {
  return (
    <div className={`space-y-3 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[10px] font-bold text-[var(--text-on-accent)]">
          {number}
        </span>
        <span className="text-[12px] font-semibold text-[var(--text-primary)]">{title}</span>
        <span className="text-[var(--text-secondary)]">{icon}</span>
      </div>
      <div className="pl-7">{children}</div>
    </div>
  );
}

export default function PreviewPanelView() {
  const { addToast } = useToast();
  const panelRef = useRef<HTMLIFrameElement>(null);

  // ─── Data State ───
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [images, setImages] = useState<File[]>([]);

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
  useEffect(() => {
    api.templatesList().then(res => {
      setAvailableTemplates(res.templates || []);
    }).catch(() => addToast({ message: 'Error cargando plantillas', type: 'error' }));
  }, [addToast]);

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

  const parseFile = async (file: File) => {
    const XLSX = await import('xlsx');
    const reader = new FileReader();
    reader.onload = evt => {
      const bstr = evt.target?.result as string;
      const wb = XLSX.read(bstr, { type: 'binary', cellDates: false, cellNF: true });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const jsonData = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, dateNF: 'dd/mm/yy' }) as unknown[][];

      if (jsonData.length > 0) {
        const _headers = jsonData[0] as string[];
        const _data = jsonData.slice(1).map(row => {
          const obj: Record<string, unknown> = {};
          _headers.forEach((h, i) => {
            let cellValue = row[i];
            if (isDateColumn(h) && typeof cellValue === 'number' && cellValue > 1000 && cellValue < 100000) {
              cellValue = excelSerialToDate(cellValue);
            }
            obj[h] = cellValue;
          });
          return obj;
        });
        setHeaders(_headers);
        setData(_data);
        autoMapFields(_headers);
        setShowDataPreview(true);
      }
    };
    reader.readAsBinaryString(file);
  };

  const autoMapFields = (_headers: string[]) => {
    const newMap: Record<string, string> = {};
    REPORT_FIELDS.forEach(field => {
      const match = _headers.find(h =>
        h.toLowerCase().includes(field.id) ||
        h.toLowerCase().includes(field.label.toLowerCase())
      );
      if (match) newMap[field.id] = match;
    });
    setMappings(newMap);
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

  // ─── Navigation ───
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

  // ─── Download template Excel ───
  const handleDownloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Plantilla');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Plantilla_Importacion.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

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
      const documents = await Promise.all(selectedRows.map(async item => {
        const imageSources = await Promise.all(item.images.map((img, imageIndex) =>
          imageToPdfSource(img, pdfQuality, `row-${item.rowIndex}-img-${imageIndex}`)
        ));
        imageSources.forEach(source => {
          if (source.token && source.localPath) {
            localImagePaths[source.token] = source.localPath;
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
      }));

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
      <aside className={`flex flex-col bg-[var(--bg-surface)] border-r border-[var(--border-subtle)] transition-all duration-300 ${isFocusMode ? 'w-0 overflow-hidden opacity-0 border-none' : 'w-[380px]'}`}>
        <div className="flex-1 overflow-y-auto p-4 space-y-5">

          {/* Step 0: Logos */}
          <Step number="0" title="Logos y Cabecera" icon={<Settings size={14} />}>
            <div className="grid grid-cols-2 gap-2">
              <div className="text-center">
                <label className="block text-[10px] text-[var(--text-secondary)] mb-1">Logo Izq</label>
                <div
                  className="border border-dashed border-[var(--border-medium)] h-14 rounded-lg flex items-center justify-center cursor-pointer hover:bg-[var(--bg-elevated)] relative overflow-hidden"
                  onClick={() => document.getElementById('logoLeftInput')?.click()}
                >
                  {logoLeft ? <img src={logoLeft} className="h-full object-contain" alt="Logo" /> : <span className="text-[10px] text-[var(--text-secondary)]">Subir Logo</span>}
                </div>
                <input id="logoLeftInput" type="file" hidden accept="image/*" onChange={e => handleLogoUpload(e, 'left')} />
              </div>
              <div className="text-center">
                <label className="block text-[10px] text-[var(--text-secondary)] mb-1">Logo Der</label>
                <div
                  className="border border-dashed border-[var(--border-medium)] h-14 rounded-lg flex items-center justify-center cursor-pointer hover:bg-[var(--bg-elevated)] relative overflow-hidden"
                  onClick={() => document.getElementById('logoRightInput')?.click()}
                >
                  {logoRight ? <img src={logoRight} className="h-full object-contain" alt="Logo" /> : <span className="text-[10px] text-[var(--text-secondary)]">Subir Logo</span>}
                </div>
                <input id="logoRightInput" type="file" hidden accept="image/*" onChange={e => handleLogoUpload(e, 'right')} />
              </div>
            </div>
          </Step>

          {/* Step 1: Template */}
          <Step number="1" title="Cargar Plantilla" icon={<FileCode size={14} />}>
            <div className="space-y-2">
              <label className="block w-full cursor-pointer">
                <div className={`border border-dashed rounded-lg p-2.5 text-center transition-colors ${templateStatus === 'valid' ? 'border-green-500 bg-green-500/10' : templateStatus === 'invalid' ? 'border-red-500 bg-red-500/10' : 'border-[var(--border-medium)] hover:bg-[var(--bg-elevated)]'}`}>
                  <div className="flex items-center justify-center gap-2">
                    {templateStatus === 'valid' && <CheckCircle size={14} className="text-green-500" />}
                    {templateStatus === 'invalid' && <AlertCircle size={14} className="text-red-500" />}
                    <span className={`text-[11px] ${templateStatus === 'valid' ? 'text-green-400' : templateStatus === 'invalid' ? 'text-red-400' : 'text-[var(--text-secondary)]'}`}>
                      {customTemplate ? customTemplate.name : 'Subir Plantilla HTML'}
                    </span>
                  </div>
                </div>
                <input id="templateInput" type="file" hidden accept=".html" onChange={handleTemplateUpload} />
              </label>

              <div>
                <label className="block text-[10px] text-[var(--text-secondary)] mb-1">O seleccionar existente:</label>
                <select
                  className="w-full h-8 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-2 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
                  onChange={e => handleBackendTemplateSelect(e.target.value)}
                  value={availableTemplates.some(t => t.filename === customTemplate?.name) ? customTemplate?.name : ''}
                >
                  <option value="">{availableTemplates.length === 0 ? 'Sin plantillas' : '-- Elegir Plantilla --'}</option>
                  {availableTemplates.map(t => <option key={t.id} value={t.filename}>{t.name}</option>)}
                </select>
              </div>

              {templateStatus === 'invalid' && templateError && (
                <div className="text-[10px] text-red-400 px-1">⚠️ {templateError}</div>
              )}

              <div className={`flex items-center justify-between p-2 rounded text-[10px] border ${customTemplate ? 'bg-green-500/10 border-green-500/30' : 'bg-[var(--bg-elevated)] border-[var(--border-medium)]'}`}>
                <span className="text-[var(--text-secondary)]">Plantilla activa:</span>
                <span className={customTemplate ? 'text-green-400 font-medium' : 'text-[var(--text-muted)]'}>
                  {customTemplate ? customTemplate.name : 'Predeterminada'}
                </span>
              </div>

              {customTemplate && (
                <button onClick={handleResetTemplate} className="w-full flex items-center justify-center gap-2 border border-dashed border-[var(--border-medium)] hover:border-[var(--text-secondary)] rounded-lg p-2 text-center hover:bg-[var(--bg-elevated)] transition-all text-[10px] text-[var(--text-secondary)]">
                  <RotateCcw size={12} /> Usar Plantilla Predeterminada
                </button>
              )}

              <div className={`flex items-center justify-between p-2 rounded border ${requiresImages ? 'bg-[var(--bg-elevated)] border-[var(--border-medium)]' : 'bg-amber-500/10 border-amber-500/30'}`}>
                <div className="flex items-center gap-2">
                  <ImageIcon size={12} className={requiresImages ? 'text-[var(--text-secondary)]' : 'text-amber-400'} />
                  <span className="text-[10px] text-[var(--text-secondary)]">Requiere imágenes</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={requiresImages} onChange={e => setRequiresImages(e.target.checked)} className="sr-only peer" />
                  <div className="w-8 h-4 bg-[var(--bg-base)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-green-600 border border-[var(--border-medium)]"></div>
                </label>
              </div>
            </div>
          </Step>

          {/* Step 2: Data */}
          <Step number="2" title="Cargar Datos" icon={<FileSpreadsheet size={14} />}>
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
                className={`border border-dashed rounded-lg p-3 text-center transition-colors ${dragStep2 ? 'border-[var(--accent-primary)] bg-[var(--bg-elevated)]' : 'border-[var(--border-medium)] hover:bg-[var(--bg-elevated)]'}`}
              >
                <span className={`text-[11px] ${dragStep2 ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                  {dragStep2 ? 'Soltar aquí' : headers.length > 0 ? `${data.length} registros cargados` : 'Seleccionar Excel / CSV'}
                </span>
              </div>
              <input type="file" hidden accept=".csv,.xlsx,.xls" onChange={handleFileUpload} />
            </label>
            {data.length > 0 && (
              <button onClick={() => setShowDataPreview(true)} className="w-full mt-2 flex items-center justify-center gap-2 border border-[var(--border-medium)] hover:border-[var(--text-secondary)] rounded-lg p-2 text-center hover:bg-[var(--bg-elevated)] transition-all text-[11px] text-[var(--text-secondary)]">
                <Table2 size={14} /> Ver Datos Cargados
              </button>
            )}
          </Step>

          {/* Step 3: Mapping */}
          <Step number="3" title="Mapeo de Columnas" icon={<Settings size={14} />} disabled={headers.length === 0}>
            <div className="mb-2">
              <label className="block text-[var(--text-secondary)] text-[11px] mb-1 font-semibold">Columna ID (Clave)</label>
              <select
                className="w-full h-8 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-2 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
                value={idColumn}
                onChange={e => setIdColumn(e.target.value)}
              >
                <option value="">-- Seleccionar ID --</option>
                {headers.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>

            <div className="space-y-1.5 border-t border-[var(--border-subtle)] pt-2 max-h-48 overflow-y-auto pr-1">
              {REPORT_FIELDS.map(field => (
                <div key={field.id} className="grid grid-cols-[90px_1fr] gap-2 items-center">
                  <span className="text-[var(--text-secondary)] text-[10px] uppercase font-medium truncate" title={field.label}>{field.label}</span>
                  <select
                    className={`h-6 rounded-md border bg-[var(--bg-elevated)] px-1.5 text-[10px] text-[var(--text-primary)] outline-none ${mappings[field.id] ? 'border-l-2 border-l-green-500 border-[var(--border-medium)]' : 'border-[var(--border-medium)]'}`}
                    value={mappings[field.id] || ''}
                    onChange={e => setMappings(prev => ({ ...prev, [field.id]: e.target.value }))}
                  >
                    <option value="">Ignorar</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}

              {customColumns.map(col => (
                <div key={col.id} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center bg-[var(--bg-elevated)] rounded px-2 py-1">
                  <span className="text-[var(--text-primary)] text-[10px] uppercase font-medium">{col.name}</span>
                  <select
                    className={`h-6 rounded-md border bg-[var(--bg-base)] px-1.5 text-[10px] text-[var(--text-primary)] outline-none ${mappings[col.id] ? 'border-l-2 border-l-[var(--accent-primary)]' : 'border-[var(--border-medium)]'}`}
                    value={mappings[col.id] ?? col.mappedTo}
                    onChange={e => setMappings(prev => ({ ...prev, [col.id]: e.target.value }))}
                  >
                    <option value="">Ignorar</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <button onClick={() => removeCustomColumn(col.id)} className="text-red-400 hover:text-red-300 text-[10px] px-1 hover:bg-red-500/20 rounded transition-colors" title="Eliminar">✕</button>
                </div>
              ))}
            </div>

            <button onClick={() => setShowColumnModal(true)} className="w-full mt-2 border border-dashed border-[var(--text-secondary)] hover:border-[var(--text-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg p-2 text-center hover:bg-[var(--bg-elevated)] transition-all flex items-center justify-center gap-2 text-[11px]">
              <span>+</span> Agregar Columna Personalizada
            </button>
            <button onClick={handleDownloadTemplate} className="w-full mt-2 border border-dashed border-[var(--border-medium)] hover:border-[var(--text-secondary)] rounded-lg p-2 text-center hover:bg-[var(--bg-elevated)] transition-all flex items-center justify-center gap-2 text-[11px] text-[var(--text-secondary)]">
              📥 Descargar Plantilla Excel
            </button>
          </Step>

          {/* Step 4: Images */}
          <Step number="4" title={requiresImages ? 'Cargar Imágenes' : 'Imágenes (Opcional)'} icon={<ImageIcon size={14} />} disabled={!idColumn || !requiresImages}>
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
                  className={`border border-dashed rounded-lg p-3 text-center transition-colors ${dragStep4 ? 'border-[var(--accent-primary)] bg-[var(--bg-elevated)]' : 'border-[var(--border-medium)] hover:bg-[var(--bg-elevated)]'}`}
                >
                  <span className={`text-[11px] ${dragStep4 ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                    {dragStep4 ? 'Soltar aquí' : images.length > 0 ? `${images.length} imágenes` : 'Subir Carpeta de Fotos'}
                  </span>
                </div>
                <input type="file" hidden multiple accept="image/*" onChange={handleImageUpload} />
              </label>
            ) : (
              <div className="border border-dashed border-[var(--border-medium)] rounded-lg p-3 text-center bg-[var(--bg-elevated)]">
                <span className="text-[var(--text-muted)] text-[11px]">No requerido para esta plantilla</span>
              </div>
            )}
          </Step>

          {/* Step 5: Select Record & Export */}
          <Step number="5" title="Seleccionar y Exportar" icon={<Search size={14} />} disabled={requiresImages ? images.length === 0 : data.length === 0}>
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={14} />
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
                className="w-full pl-8 pr-3 py-1.5 bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-lg text-[var(--text-primary)] text-[12px] outline-none focus:border-[var(--accent-primary)] placeholder:text-[var(--text-muted)]"
              />
            </div>
            <select
              className="w-full h-8 rounded-lg border border-[var(--border-medium)] bg-white text-black font-bold px-2 text-[12px] outline-none disabled:opacity-50"
              value={selectedIndex}
              onChange={e => setSelectedIndex(e.target.value)}
              disabled={exportScope === 'all'}
            >
              <option value="">-- Seleccionar Fila --</option>
              {data.map((row, idx) => (
                <option key={idx} value={idx}>{idx + 1}. {idColumn ? String(row[idColumn]) : `Fila ${idx + 1}`}</option>
              ))}
            </select>

            <div className="mt-3 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-2">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Exportación</span>
                <span className="text-[10px] text-[var(--text-muted)]">{exportScope === 'all' ? 'PDF consolidado' : 'PDF'}</span>
              </div>

              <div className="mb-2 grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => setExportScope('single')}
                  className={`rounded-md px-2 py-1.5 text-[10px] font-semibold transition-colors ${exportScope === 'single' ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)]' : 'border border-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  Solo actual
                </button>
                <button
                  type="button"
                  onClick={() => setExportScope('all')}
                  className={`rounded-md px-2 py-1.5 text-[10px] font-semibold transition-colors ${exportScope === 'all' ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)]' : 'border border-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  Todo ({data.length})
                </button>
              </div>

              <div className="mb-2">
                <div className="mb-1 text-[10px] font-medium text-[var(--text-secondary)]">Calidad</div>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() => setPdfQuality('high')}
                    className={`rounded-md px-2 py-1.5 text-[10px] font-semibold transition-colors ${pdfQuality === 'high' ? 'bg-green-600 text-white' : 'border border-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                  >
                    Buena calidad
                  </button>
                  <button
                    type="button"
                    onClick={() => setPdfQuality('low')}
                    className={`rounded-md px-2 py-1.5 text-[10px] font-semibold transition-colors ${pdfQuality === 'low' ? 'bg-amber-600 text-white' : 'border border-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                  >
                    Baja calidad
                  </button>
                </div>
              </div>

              <button
                onClick={handleDownloadPdf}
                disabled={(exportScope === 'single' && selectedIndex === '') || data.length === 0 || isPdfLoading}
                className="mb-2 flex w-full items-center justify-center gap-2 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-[var(--text-on-accent)] font-semibold p-2.5 rounded-lg disabled:opacity-40 transition-colors text-[12px]"
              >
                {isPdfLoading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {isPdfLoading ? (pdfLoadingMessage || 'Generando PDF...') : exportScope === 'all' ? 'Descargar PDF Consolidado' : 'Descargar PDF'}
              </button>
              <button
                onClick={handlePrint}
                disabled={selectedIndex === '' || exportScope === 'all'}
                className="flex w-full items-center justify-center gap-2 border border-[var(--border-medium)] hover:border-[var(--text-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-semibold p-2 rounded-lg disabled:opacity-40 transition-colors text-[11px]"
              >
                <Printer size={14} /> Imprimir Vista Previa
              </button>
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
        {showDataPreview && data.length > 0 && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2 sm:p-4">
            <div className="bg-[var(--bg-surface)] border border-[var(--border-medium)] rounded-xl w-full max-w-[1400px] max-h-[88vh] flex flex-col shadow-2xl">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
                <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">Vista previa de datos ({data.length} registros)</h3>
                <button
                  onClick={() => setShowDataPreview(false)}
                  className="shrink-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  title="Cerrar vista previa"
                  aria-label="Cerrar vista previa"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto overflow-x-hidden p-3">
                <table className="w-full table-fixed border-collapse text-[10px] sm:text-[11px]">
                  <colgroup>
                    <col className="w-9" />
                    {headers.map(h => <col key={h} />)}
                    <col className="w-14" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-[var(--border-medium)]">
                      <th className="text-left py-1.5 px-1.5 text-[var(--text-secondary)] font-semibold">#</th>
                      {headers.map(h => (
                        <th
                          key={h}
                          className="text-left py-1.5 px-1.5 text-[var(--text-secondary)] font-semibold align-bottom whitespace-normal break-words leading-snug"
                          title={h}
                        >
                          {h}
                        </th>
                      ))}
                      <th className="text-left py-1.5 px-1.5 text-[var(--text-secondary)] font-semibold">Fotos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row, idx) => {
                      const recordId = idColumn ? String(row[idColumn]) : '';
                      const photoCount = recordId ? images.filter(img => matchesRecordId(img.name, recordId)).length : 0;
                      return (
                        <tr
                          key={idx}
                          className={`border-b border-[var(--border-subtle)] cursor-pointer hover:bg-[var(--bg-elevated)] transition-colors ${selectedIndex === String(idx) ? 'bg-[var(--accent-primary)]/10' : ''}`}
                          onClick={() => { setSelectedIndex(String(idx)); setShowDataPreview(false); }}
                        >
                          <td className="py-1.5 px-1.5 text-[var(--text-primary)] font-medium align-top">{idx + 1}</td>
                          {headers.map(h => {
                            const value = String(row[h] ?? '');
                            return (
                              <td
                                key={h}
                                className="py-1.5 px-1.5 text-[var(--text-secondary)] align-top whitespace-normal break-words leading-snug"
                                title={value}
                              >
                                {value}
                              </td>
                            );
                          })}
                          <td className="py-1.5 px-1.5 align-top">
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${photoCount > 0 ? 'bg-green-500/20 text-green-400' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'}`}>
                              {photoCount} 📷
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Custom Column Modal */}
        {showColumnModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                addCustomColumn();
              }}
              onKeyDown={handleCustomColumnKeyDown}
              className="bg-[var(--bg-surface)] border border-[var(--border-medium)] rounded-xl p-5 w-full max-w-md mx-4 shadow-2xl"
            >
              <h3 className="text-[var(--text-primary)] font-semibold text-sm mb-4 flex items-center gap-2">
                <span>+</span> Agregar Columna Personalizada
              </h3>
              {columnError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-[11px] rounded-lg p-2 mb-3 flex items-center gap-2">
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
                  <select value={newColumnMapping} onChange={e => setNewColumnMapping(e.target.value)} className="w-full h-8 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]">
                    <option value="">-- Seleccionar Columna --</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
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
            <div className="fixed top-4 right-4 z-[100] text-[var(--text-muted)] text-[10px] font-mono pointer-events-none select-none bg-black/40 px-3 py-1 rounded-full">
              MODO FOCUS (CTRL + .)
            </div>
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] text-[var(--text-muted)] text-sm font-mono bg-black/40 px-4 py-2 rounded-full">
              {selectedIndex !== '' ? `${parseInt(selectedIndex) + 1} / ${data.length}` : 'Sin registro seleccionado'}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
