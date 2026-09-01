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
import CanvasSelect from './CanvasSelect';

function dashedStyle(active: boolean) {
  return {
    borderColor: active ? 'var(--cv-accent)' : 'var(--cv-border-strong)',
    background: active ? 'var(--cv-accent-soft)' : undefined,
    color: active ? 'var(--cv-accent)' : 'var(--cv-text-secondary)',
  } as const;
}

export interface GenerateSidebarProps {
  stepStates: boolean[];
  completedCount: number;
  logoLeft: string | null;
  logoRight: string | null;
  onLogoLeft: (url: string | null, file?: File | null) => void;
  onLogoRight: (url: string | null, file?: File | null) => void;
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
  colorMode: 'rgb' | 'cmyk';
  onColorMode: (v: 'rgb' | 'cmyk') => void;
  colorProfile: string;
  onColorProfile: (v: string) => void;
  bleedMm: number;
  onBleedMm: (v: number) => void;
  showCropMarks: boolean;
  onShowCropMarks: (v: boolean) => void;
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
    colorMode, onColorMode, colorProfile, onColorProfile,
    bleedMm, onBleedMm, showCropMarks, onShowCropMarks,
    showPlaceholders, onShowPlaceholders, busy, onExport, onPrint, error,
  } = props;

  return (
    <aside className="canvas-generate-aside">
      <div className="canvas-generate-progress">
        <span className="canvas-generate-progress-label">Progreso</span>
        <div
          className="flex flex-1 gap-1"
          role="progressbar"
          aria-label={`Progreso de generación: ${completedCount} de 6`}
          aria-valuemin={0}
          aria-valuemax={6}
          aria-valuenow={completedCount}
          aria-valuetext={`${completedCount} de 6 pasos listos`}
        >
          {stepStates.map((done, i) => (
            <span
              key={i}
              aria-hidden
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
        <GenerateStep number="0" title="Logos y Cabecera" icon={<Settings size={12} />} defaultOpen={!!(logoLeft || logoRight)} status={stepStates[0] ? 'done' : 'pending'} statusLabel={stepStates[0] ? 'Listo' : 'Pendiente'}>
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
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      // ObjectURL for sidebar/preview; parent revokes on replace/unmount.
                      const url = f ? URL.createObjectURL(f) : null;
                      // Pass the File too: RGB PDF export can reference it via an
                      // antares-local-image: token instead of base64 per page.
                      if (side === 'left') onLogoLeft(url, f);
                      else onLogoRight(url, f);
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
          statusLabel={stepStates[1] ? 'Listo' : 'Pendiente'}
        >
          <div className="space-y-1.5">
            <CanvasSelect
              aria-label="Elegir plantilla Canvas"
              value={selectedTemplateId}
              onChange={(val) => onSelectTemplate(val)}
              options={templateOptions.map((d) => ({ value: d.id, label: d.name }))}
            />

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
            <p className="canvas-generate-helper">
              Actívalo solo si cada fila necesita fotos para completar el PDF.
            </p>
          </div>
        </GenerateStep>

        <GenerateStep
          number="2"
          title="Datos"
          icon={<FileSpreadsheet size={12} />}
          badge={rows.length > 0 ? <span className="text-[9px] font-medium" style={{ color: 'var(--cv-accent)' }}>{rows.length}</span> : null}
          status={stepStates[2] ? 'done' : 'pending'}
          statusLabel={stepStates[2] ? 'Listo' : 'Pendiente'}
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

        <GenerateStep
          key={headers.length > 0 ? 'mapping-ready' : 'mapping-locked'}
          number="3"
          title="Mapeo de Columnas"
          icon={<Settings size={12} />}
          disabled={headers.length === 0}
          defaultOpen={headers.length > 0}
          status={stepStates[3] ? 'done' : 'pending'}
          statusLabel={stepStates[3] ? 'Listo' : 'Pendiente'}
        >
          <div className="space-y-1.5">
            <label className="block">
              <span className="canvas-label">Columna ID (Clave)</span>
              <CanvasSelect
                value={idColumn}
                onChange={(val) => onIdColumn(val)}
                aria-label="Columna ID (Clave)"
                options={[
                  { value: '', label: '-- Seleccionar ID --' },
                  ...headers.map((h) => ({ value: h, label: h })),
                ]}
              />
            </label>
            {fieldKeys.length > 0 ? (
              <div className="space-y-1 pr-0.5">
                {fieldKeys.map((key) => (
                  <div key={key} className="grid grid-cols-[minmax(0,88px)_1fr] items-center gap-1.5">
                    <WithHoverTooltip label={key} placement="top" variant="dark" className="min-w-0">
                      <span
                        className="block truncate text-[9px] font-medium uppercase"
                        style={{ color: 'var(--cv-text-muted)' }}
                      >
                        {key}
                      </span>
                    </WithHoverTooltip>
                    <CanvasSelect
                      value={mappings[key] || ''}
                      onChange={(val) => onMapping(key, val)}
                      aria-label={`Mapeo ${key}`}
                      options={[
                        { value: '', label: 'Ignorar' },
                        ...headers.map((h) => ({ value: h, label: h })),
                      ]}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="canvas-callout-info">
                Sin campos en la plantilla. Añade capas «Campo» en Diseñar para mapear columnas.
              </p>
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
          statusLabel={stepStates[4] ? 'Listo' : 'Pendiente'}
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
          statusLabel={stepStates[5] ? 'Listo' : 'Pendiente'}
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

            <CanvasSelect
              value={rows.length ? String(rowIndex) : ''}
              onChange={(val) => onRowIndex(Number(val))}
              disabled={exportScope === 'all' || rows.length === 0}
              aria-label="Seleccionar Fila"
              options={
                rows.length === 0
                  ? [{ value: '', label: '-- Seleccionar Fila --' }]
                  : rows.map((row, i) => ({
                      value: String(i),
                      label: `${i + 1}. ${idColumn && row[idColumn] ? row[idColumn] : `Fila ${i + 1}`}`,
                    }))
              }
            />

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
                <span className="text-[9px] font-medium" style={{ color: 'var(--cv-text-muted)' }}>Espacio de Color</span>
                <GenerateSegmented
                  aria-label="Espacio de Color PDF"
                  value={colorMode}
                  onChange={onColorMode}
                  options={[
                    { value: 'rgb', label: 'RGB (Digital)' },
                    { value: 'cmyk', label: 'CMYK (Imprenta)' },
                  ]}
                />
              </div>

              {colorMode === 'cmyk' ? (
                <div className="space-y-1.5 rounded-md border p-1.5" style={{ borderColor: 'var(--cv-border-strong)', background: 'var(--cv-hover)' }}>
                  <p className="text-[9px] leading-snug" style={{ color: 'var(--cv-text-muted)' }}>
                    Formas recortadas, tablas y grids se imprimen como caja; usa RGB si necesitas fidelidad total.
                  </p>
                  <div className="space-y-1">
                    <span className="text-[9px] font-medium" style={{ color: 'var(--cv-text-muted)' }}>Perfil ICC Imprenta</span>
                    <CanvasSelect
                      value={colorProfile}
                      onChange={onColorProfile}
                      aria-label="Perfil ICC"
                      options={[
                        { value: 'cmyk_iso_coated_v2', label: 'ISO Coated v2 (ECI)' },
                        { value: 'cmyk_swop', label: 'US Web Coated (SWOP)' },
                        { value: 'cmyk_device', label: 'DeviceCMYK Directo' },
                      ]}
                    />
                  </div>

                  <div className="space-y-1">
                    <span className="text-[9px] font-medium" style={{ color: 'var(--cv-text-muted)' }}>Sangrado (Bleed)</span>
                    <GenerateSegmented
                      aria-label="Sangrado Bleed"
                      value={String(bleedMm)}
                      onChange={(v) => onBleedMm(Number(v))}
                      options={[
                        { value: '0', label: '0 mm' },
                        { value: '3', label: '3 mm' },
                        { value: '5', label: '5 mm' },
                      ]}
                    />
                  </div>

                  <CanvasToggle
                    checked={showCropMarks}
                    onChange={onShowCropMarks}
                    label="Marcas de corte y registro"
                  />
                </div>
              ) : (
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
              )}

              <CanvasToggle checked={showPlaceholders} onChange={onShowPlaceholders} label="Mostrar placeholders" />

              <p className="canvas-export-scope-hint" data-testid="canvas-export-scope-hint">
                {rows.length === 0
                  ? 'Carga un Excel/CSV para habilitar la exportación.'
                  : exportScope === 'all'
                    ? `Se exportarán ${rows.length} filas en un PDF consolidado.`
                    : 'Se exportará solo la fila seleccionada.'}
              </p>

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
