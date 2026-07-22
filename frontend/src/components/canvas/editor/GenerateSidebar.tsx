import {
  AlertCircle,
  CheckCircle,
  Download,
  FileCode,
  FileSpreadsheet,
  Image as ImageIcon,
  Loader2,
  Printer,
  Search,
  Settings,
} from 'lucide-react';
import type { PdfQuality } from '../../../utils/pdfAssets';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import type { GenerateExportScope } from '../ops/generateExport';
import type { CanvasDocumentSummary } from '../types';
import { CanvasToggle } from './CanvasControls';
import { GenerateSegmented, GenerateStep } from './GenerateWizardChrome';

function dashedStyle(active: boolean) {
  return {
    borderColor: active ? 'var(--cv-accent)' : 'var(--cv-border-strong)',
    background: active ? 'var(--cv-accent-soft)' : undefined,
    color: active ? 'var(--cv-accent)' : 'var(--cv-text-secondary)',
  } as const;
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export interface GenerateSidebarProps {
  stepStates: boolean[];
  completedCount: number;
  logoLeft: string | null;
  logoRight: string | null;
  onLogoLeft: (url: string | null) => void;
  onLogoRight: (url: string | null) => void;
  templateValid: boolean;
  templateOptions: CanvasDocumentSummary[];
  selectedTemplateId: string;
  onSelectTemplate: (id: string) => void;
  templateName: string;
  layerCount: number;
  fieldKeys: string[];
  requiresImages: boolean;
  onRequiresImages: (v: boolean) => void;
  rows: Record<string, string>[];
  headers: string[];
  idColumn: string;
  onIdColumn: (v: string) => void;
  mappings: Record<string, string>;
  onMapping: (key: string, column: string) => void;
  images: File[];
  onImages: (files: File[]) => void;
  onAppendImages: (files: File[]) => void;
  dragData: boolean;
  setDragData: (v: boolean) => void;
  dragImages: boolean;
  setDragImages: (v: boolean) => void;
  onExcel: (file: File | null) => void;
  searchOrder: string;
  onSearchOrder: (term: string) => void;
  rowIndex: number;
  onRowIndex: (i: number) => void;
  exportScope: GenerateExportScope;
  onExportScope: (v: GenerateExportScope) => void;
  pdfQuality: PdfQuality;
  onPdfQuality: (v: PdfQuality) => void;
  showPlaceholders: boolean;
  onShowPlaceholders: (v: boolean) => void;
  busy: boolean;
  onExport: () => void;
  onPrint: () => void;
  error: string | null;
}

export default function GenerateSidebar(props: GenerateSidebarProps) {
  const {
    stepStates, completedCount,
    logoLeft, logoRight, onLogoLeft, onLogoRight,
    templateValid, templateOptions, selectedTemplateId, onSelectTemplate,
    templateName, layerCount, fieldKeys, requiresImages, onRequiresImages,
    rows, headers, idColumn, onIdColumn, mappings, onMapping,
    images, onImages, onAppendImages,
    dragData, setDragData, dragImages, setDragImages, onExcel,
    searchOrder, onSearchOrder, rowIndex, onRowIndex,
    exportScope, onExportScope, pdfQuality, onPdfQuality,
    showPlaceholders, onShowPlaceholders, busy, onExport, onPrint, error,
  } = props;

  return (
    <aside className="canvas-generate-aside">
      <div className="canvas-generate-progress">
        <div className="flex flex-1 gap-1" aria-hidden>
          {stepStates.map((done, i) => (
            <span
              key={i}
              className="h-1 flex-1 rounded-full transition-colors duration-300"
              style={{ background: done ? 'var(--cv-accent)' : 'var(--cv-border-strong)' }}
            />
          ))}
        </div>
        <span className="shrink-0 text-[9px] font-semibold tabular-nums leading-none" style={{ color: 'var(--cv-text-muted)' }}>
          {completedCount}/6
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
        <GenerateStep number="0" title="Logos y Cabecera" icon={<Settings size={12} />} defaultOpen={!!(logoLeft || logoRight)} status={stepStates[0] ? 'done' : 'pending'}>
          <div className="grid grid-cols-2 gap-1.5">
            {(['left', 'right'] as const).map((side) => {
              const logo = side === 'left' ? logoLeft : logoRight;
              const inputId = side === 'left' ? 'canvasLogoLeft' : 'canvasLogoRight';
              return (
                <div key={side}>
                  <button
                    type="button"
                    className="relative flex h-11 w-full cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed transition-colors"
                    style={{ borderColor: 'var(--cv-border-strong)' }}
                    onClick={() => document.getElementById(inputId)?.click()}
                  >
                    {logo ? (
                      <img src={logo} className="h-full object-contain" alt={`Logo ${side}`} />
                    ) : (
                      <span className="text-[9px]" style={{ color: 'var(--cv-text-muted)' }}>
                        {side === 'left' ? 'Logo Izq' : 'Logo Der'}
                      </span>
                    )}
                  </button>
                  <input
                    id={inputId}
                    type="file"
                    hidden
                    accept="image/*"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      const url = f ? await readFileAsDataUrl(f) : null;
                      if (side === 'left') onLogoLeft(url);
                      else onLogoRight(url);
                    }}
                  />
                </div>
              );
            })}
          </div>
        </GenerateStep>

        <GenerateStep
          number="1"
          title="Plantilla"
          icon={<FileCode size={12} />}
          badge={
            templateValid
              ? <CheckCircle size={11} style={{ color: 'var(--cv-accent)' }} />
              : <AlertCircle size={11} style={{ color: 'var(--cv-danger)' }} />
          }
          status={stepStates[1] ? 'done' : 'pending'}
        >
          <div className="space-y-1.5">
            <select
              className="canvas-input"
              aria-label="Elegir plantilla Canvas"
              value={selectedTemplateId}
              onChange={(e) => onSelectTemplate(e.target.value)}
            >
              {templateOptions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>

            <div
              className="flex items-center justify-between rounded-md border px-2 py-1 text-[9px]"
              style={{
                borderColor: templateValid ? 'color-mix(in srgb, var(--cv-accent) 25%, transparent)' : 'var(--cv-border)',
                background: templateValid ? 'var(--cv-accent-soft)' : 'var(--cv-hover)',
              }}
            >
              <span style={{ color: 'var(--cv-text-muted)' }}>Activa:</span>
              <span className="font-medium" style={{ color: templateValid ? 'var(--cv-accent)' : 'var(--cv-text-muted)' }}>
                {templateName || 'Sin título'} · {layerCount} capas
              </span>
            </div>

            {templateValid && fieldKeys.length === 0 && (
              <p className="canvas-callout-warn">
                No hay campos Excel. En <strong>Diseñar</strong> añade capas «Campo» (tecla F) y asígnales una clave.
              </p>
            )}

            <div
              className="flex items-center justify-between rounded-md border px-2 py-1"
              style={{ borderColor: 'var(--cv-border)', background: 'var(--cv-hover)' }}
            >
              <div className="flex items-center gap-1.5">
                <ImageIcon size={10} style={{ color: requiresImages ? 'var(--cv-text-muted)' : 'var(--cv-warn-text)' }} />
                <span className="text-[9px]" style={{ color: 'var(--cv-text-muted)' }}>Requiere imágenes</span>
              </div>
              <CanvasToggle checked={requiresImages} onChange={onRequiresImages} />
            </div>
          </div>
        </GenerateStep>

        <GenerateStep
          number="2"
          title="Datos"
          icon={<FileSpreadsheet size={12} />}
          badge={rows.length > 0 ? <span className="text-[9px] font-medium" style={{ color: 'var(--cv-accent)' }}>{rows.length}</span> : null}
          status={stepStates[2] ? 'done' : 'pending'}
        >
          <label className="block w-full cursor-pointer">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragData(true); }}
              onDragEnter={(e) => { e.preventDefault(); setDragData(true); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragData(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setDragData(false);
                const [file] = Array.from(e.dataTransfer.files || []);
                if (!file) return;
                const name = file.name.toLowerCase();
                if (name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls')) {
                  onExcel(file);
                }
              }}
              className="rounded-md border border-dashed py-1.5 text-center transition-colors"
              style={dashedStyle(dragData || rows.length > 0)}
            >
              <span className="text-[10px]">
                {dragData ? 'Soltar aquí' : rows.length > 0 ? `${rows.length} registros cargados` : 'Seleccionar Excel / CSV'}
              </span>
            </div>
            <input
              type="file"
              hidden
              accept=".csv,.xlsx,.xls"
              onChange={(e) => onExcel(e.target.files?.[0] || null)}
            />
          </label>
        </GenerateStep>

        <GenerateStep number="3" title="Mapeo de Columnas" icon={<Settings size={12} />} disabled={headers.length === 0} defaultOpen={false} status={stepStates[3] ? 'done' : 'pending'}>
          <div className="space-y-1.5">
            <label className="block">
              <span className="canvas-label">Columna ID (Clave)</span>
              <select className="canvas-input" value={idColumn} onChange={(e) => onIdColumn(e.target.value)}>
                <option value="">-- Seleccionar ID --</option>
                {headers.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </label>
            {fieldKeys.length > 0 && (
              <div className="max-h-40 space-y-1 overflow-y-auto pr-0.5">
                {fieldKeys.map((key) => (
                  <div key={key} className="grid grid-cols-[80px_1fr] items-center gap-1.5">
                    <WithHoverTooltip label={key} placement="top" variant="dark" className="min-w-0">
                      <span
                        className="block truncate text-[9px] font-medium uppercase"
                        style={{ color: 'var(--cv-text-muted)' }}
                      >
                        {key}
                      </span>
                    </WithHoverTooltip>
                    <select
                      className="canvas-input !h-[22px] !text-[9px]"
                      value={mappings[key] || ''}
                      onChange={(e) => onMapping(key, e.target.value)}
                    >
                      <option value="">Ignorar</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        </GenerateStep>

        <GenerateStep
          number="4"
          title={requiresImages ? 'Imágenes' : 'Imágenes (Opcional)'}
          icon={<ImageIcon size={12} />}
          disabled={!idColumn || !requiresImages}
          badge={images.length > 0 ? <span className="text-[9px] font-medium" style={{ color: 'var(--cv-accent)' }}>{images.length}</span> : null}
          status={stepStates[4] ? 'done' : 'pending'}
        >
          {requiresImages ? (
            <label className="block w-full cursor-pointer">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragImages(true); }}
                onDragEnter={(e) => { e.preventDefault(); setDragImages(true); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragImages(false); }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragImages(false);
                  const dropped = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'));
                  if (dropped.length) onAppendImages(dropped);
                }}
                className="rounded-md border border-dashed py-1.5 text-center transition-colors"
                style={dashedStyle(dragImages || images.length > 0)}
              >
                <span className="text-[10px]">
                  {dragImages ? 'Soltar aquí' : images.length > 0 ? `${images.length} imágenes` : 'Subir Carpeta de Fotos'}
                </span>
              </div>
              <input
                type="file"
                hidden
                multiple
                accept="image/*"
                onChange={(e) => onImages(Array.from(e.target.files || []))}
              />
            </label>
          ) : (
            <div className="rounded-md border border-dashed py-1.5 text-center" style={{ borderColor: 'var(--cv-border)', background: 'var(--cv-hover)' }}>
              <span className="text-[10px]" style={{ color: 'var(--cv-text-muted)' }}>No requerido</span>
            </div>
          )}
        </GenerateStep>

        <GenerateStep
          number="5"
          title="Seleccionar y Exportar"
          icon={<Search size={12} />}
          disabled={requiresImages ? images.length === 0 : rows.length === 0}
          status={stepStates[5] ? 'done' : 'pending'}
        >
          <div className="space-y-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2" size={12} style={{ color: 'var(--cv-text-muted)' }} />
              <input
                type="text"
                placeholder="Buscar orden..."
                value={searchOrder}
                onChange={(e) => {
                  const term = e.target.value;
                  onSearchOrder(term);
                  if (!term) return;
                  const matchIdx = rows.findIndex((row, idx) => {
                    const label = idColumn ? String(row[idColumn]) : `Fila ${idx + 1}`;
                    return label.toLowerCase().includes(term.toLowerCase()) || String(idx + 1).includes(term);
                  });
                  if (matchIdx !== -1) onRowIndex(matchIdx);
                }}
                className="canvas-input !pl-7"
              />
            </div>

            <select
              className="canvas-input"
              value={rows.length ? rowIndex : ''}
              onChange={(e) => onRowIndex(Number(e.target.value))}
              disabled={exportScope === 'all' || rows.length === 0}
            >
              {rows.length === 0 && <option value="">-- Seleccionar Fila --</option>}
              {rows.map((row, i) => (
                <option key={i} value={i}>
                  {i + 1}. {idColumn ? row[idColumn] : `Fila ${i + 1}`}
                </option>
              ))}
            </select>

            <div className="space-y-1.5 border-t pt-1.5" style={{ borderColor: 'var(--cv-border)' }}>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-medium" style={{ color: 'var(--cv-text-muted)' }}>Alcance</span>
                  <span className="text-[9px]" style={{ color: 'var(--cv-text-muted)' }}>
                    {exportScope === 'all' ? 'Consolidado' : 'Individual'}
                  </span>
                </div>
                <GenerateSegmented
                  aria-label="Alcance de exportación"
                  value={exportScope}
                  onChange={onExportScope}
                  options={[
                    { value: 'single', label: 'Solo actual' },
                    { value: 'all', label: `Todo (${rows.length})` },
                  ]}
                />
              </div>

              <div className="space-y-1">
                <span className="text-[9px] font-medium" style={{ color: 'var(--cv-text-muted)' }}>Calidad</span>
                <GenerateSegmented
                  aria-label="Calidad del PDF"
                  value={pdfQuality}
                  onChange={onPdfQuality}
                  options={[
                    { value: 'max', label: 'Max' },
                    { value: 'high', label: 'Buena' },
                    { value: 'low', label: 'Baja' },
                  ]}
                />
              </div>

              <CanvasToggle checked={showPlaceholders} onChange={onShowPlaceholders} label="Mostrar placeholders" />

              <div className="space-y-1.5 pt-0.5">
                <button
                  type="button"
                  disabled={busy || rows.length === 0 || (exportScope === 'single' && !rows[rowIndex])}
                  className="canvas-btn-primary !h-9 w-full justify-center gap-2"
                  onClick={onExport}
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  {busy ? 'Generando…' : exportScope === 'all' ? 'PDF Consolidado' : 'Descargar PDF'}
                </button>
                <button
                  type="button"
                  disabled={rows.length === 0 || exportScope === 'all'}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border py-1.5 text-[10px] font-medium transition-colors disabled:opacity-40"
                  style={{
                    borderColor: 'var(--cv-border-strong)',
                    background: 'var(--cv-hover)',
                    color: 'var(--cv-text-secondary)',
                  }}
                  onClick={onPrint}
                >
                  <Printer size={12} /> Imprimir
                </button>
              </div>
            </div>
          </div>
        </GenerateStep>

        {error && (
          <p className="px-1 text-[12px]" style={{ color: 'var(--cv-danger)' }}>
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}
