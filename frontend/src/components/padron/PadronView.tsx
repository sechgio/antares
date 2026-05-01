/**
 * Padron Generator - Vista principal
 * Adaptado al estilo del proyecto principal COSMO
 */
import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { toCanvas, getFontEmbedCSS } from 'html-to-image';
import {
  Upload,
  Download,
  Printer,
  Trash2,
  CheckCircle,
  PanelLeft,
} from 'lucide-react';
import PreviewPage from './PreviewPage';
import {
  HEADER_FIELDS,
  ORIENTATION_OPTIONS,
  DATE_FIELDS,
  toDisplayDate,
  toISODate,
  createDefaultHeaderData,
  createInitialItems,
  type HeaderData,
  type PadronItem,
  type Orientation,
} from './data';
import { parseWorkbook } from './excel';
import type { ExcelRecord } from './data';
import accionaLogoSrc from '../../assets/vpad-assets/logo_acciona.png';
import sedapalLogoSrc from '../../assets/vpad-assets/logo_sedapal.jpg';
import { api } from '../../api';
import './vpad-styles.css';

async function saveToHistory(runType: string, label: string, details: Record<string, unknown>, count = 1) {
  try {
    await api.historySave({
      run_type: runType,
      files: [label],
      options: details,
      formato: label,
      patron: '',
      calidad: 0,
      resize: null,
      ok_count: count,
      err_count: 0,
    });
  } catch {
    // Silently ignore history save errors so main flow is never blocked
  }
}

const ACCIONA_LOGO = accionaLogoSrc;
const SEDAPAL_LOGO = sedapalLogoSrc;

function loadImageAsBase64(url: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(url);
        return;
      }
      ctx.drawImage(img, 0, 0);
      try {
        const dataUrl = canvas.toDataURL('image/png');
        resolve(dataUrl);
      } catch {
        resolve(url);
      }
    };
    img.onerror = () => resolve(url);
    img.src = url;
  });
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks.length ? chunks : [[]];
}

function canvasToJpegBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (canvas.toBlob) {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          reject(new Error('No se pudo codificar la página PDF en JPEG.'));
          return;
        }
        try {
          resolve(new Uint8Array(await blob.arrayBuffer()));
        } catch (error) {
          reject(error);
        }
      }, 'image/jpeg', quality);
      return;
    }
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const base64 = dataUrl.split(',')[1] || '';
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      resolve(bytes);
    } catch (error) {
      reject(error);
    }
  });
}

const MAX_PREVIEW_PAGES = 5;

export default function PadronView() {
  const previewRef = useRef<HTMLDivElement>(null);
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [headerData, setHeaderData] = useState<HeaderData>(createDefaultHeaderData());
  const [items, setItems] = useState<PadronItem[]>(createInitialItems());
  const [startItem, setStartItem] = useState(1);
  const [endItem, setEndItem] = useState(18);
  const [totalItemsCount, setTotalItemsCount] = useState(36);
  const [excelRecords, setExcelRecords] = useState<ExcelRecord[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState('');
  const [importedFileName, setImportedFileName] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [logosBase64, setLogosBase64] = useState<{ acciona: string | null; sedapal: string | null }>({ acciona: null, sedapal: null });
  const [logosLoaded, setLogosLoaded] = useState(false);
  const [pdfProgress, setPdfProgress] = useState('');
  const [previewPageOffset, setPreviewPageOffset] = useState(0);
  const [sidebarVisible, setSidebarVisible] = useState(true);

  const pdfContainerRef = useRef<HTMLDivElement>(null);

  // Inject @page rule dynamically so it only applies while this component is mounted
  useEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-vpad-page', 'true');
    style.textContent = '@page { size: A4 landscape; margin: 0; }';
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  useEffect(() => {
    Promise.all([
      loadImageAsBase64(ACCIONA_LOGO),
      loadImageAsBase64(SEDAPAL_LOGO),
    ]).then(([acciona, sedapal]) => {
      setLogosBase64({ acciona, sedapal });
      setLogosLoaded(true);
    });
  }, []);

  const rowsPerPage = orientation === 'landscape' ? 18 : 37;
  const maxItem = totalItemsCount;

  const handleTotalItemsChange = useCallback((value: string) => {
    const count = Math.max(1, Number(value) || 1);
    setTotalItemsCount(count);
    setItems((prevItems) => {
      const newItems = createInitialItems(count);
      prevItems.forEach((existing) => {
        const idx = Number(existing.item) - 1;
        if (idx >= 0 && idx < count) {
          newItems[idx] = { ...existing };
        }
      });
      return newItems;
    });
    setEndItem((prev) => Math.min(prev, count));
  }, []);

  const visibleItems = useMemo(() => {
    const s = clamp(startItem, 1, maxItem);
    const e = clamp(endItem, s, maxItem);
    return items
      .filter((item) => {
        const n = Number(item.item) || 0;
        return n >= s && n <= e;
      })
      .sort((a, b) => Number(a.item) - Number(b.item));
  }, [items, startItem, endItem, maxItem]);

  const pages = useMemo(
    () => chunkArray(visibleItems, rowsPerPage),
    [visibleItems, rowsPerPage],
  );

  const previewPages = useMemo(() => {
    const start = Math.min(
      previewPageOffset,
      Math.max(0, pages.length - MAX_PREVIEW_PAGES),
    );
    const end = Math.min(start + MAX_PREVIEW_PAGES, pages.length);
    return { start, end, items: pages.slice(start, end) };
  }, [pages, previewPageOffset]);

  useEffect(() => {
    setPreviewPageOffset(0);
  }, [startItem, endItem, orientation]);

  const handleHeaderChange = useCallback((field: string, value: string) => {
    setHeaderData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleReset = useCallback(() => {
    setHeaderData(createDefaultHeaderData());
    setItems(createInitialItems());
    setTotalItemsCount(36);
    setStartItem(1);
    setEndItem(18);
    setExcelRecords([]);
    setSelectedRecordId('');
    setImportedFileName('');
    setImportStatus('');
  }, []);

  const handleExcelUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsImporting(true);
      setImportStatus('Leyendo archivo...');
      const data = await parseWorkbook(file);
      setExcelRecords(data.records);
      setImportedFileName(file.name);

      const first = data.records[0];
      setHeaderData(first.data);
      setSelectedRecordId(first.id);

      const importedCount = Number(first.data.cantidadItems) || 0;
      if (data.importedItems.length > 0) {
        const sorted = [...data.importedItems].sort(
          (a, b) => Number(a.item) - Number(b.item),
        );
        const total = importedCount > 0 ? importedCount : sorted.length;
        const finalItems =
          total > sorted.length
            ? [
                ...sorted,
                ...Array.from({ length: total - sorted.length }, (_, i) => ({
                  item: sorted.length + i + 1,
                  nombresApellidos: '',
                  direccion: '',
                  horaComunicacion: '',
                  firmaSuministro: '',
                })),
              ]
            : sorted.slice(0, total);
        setItems(finalItems);
        setTotalItemsCount(total);
        setStartItem(1);
        setEndItem(total);
      } else if (importedCount > 0) {
        handleTotalItemsChange(String(importedCount));
      }

      const missing = HEADER_FIELDS.filter(
        (f) => f.required && !String(first.data[f.key] ?? '').trim(),
      );
      setImportStatus(
        `${data.records.length} registro(s) encontrado(s).` +
          (missing.length
            ? ` ${missing.length} campo(s) por completar.`
            : ' Todos los campos completos.'),
      );
    } catch (err) {
      setImportStatus(
        `Error al leer el archivo: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsImporting(false);
      event.target.value = '';
    }
  }, [handleTotalItemsChange]);

  const handleRecordSelect = useCallback((id: string) => {
    setSelectedRecordId(id);
    const rec = excelRecords.find((r) => r.id === id);
    if (rec) {
      setHeaderData(rec.data);
      const importedCount = Number(rec.data.cantidadItems) || 0;
      if (importedCount > 0) {
        handleTotalItemsChange(String(importedCount));
        setStartItem(1);
        setEndItem(importedCount);
      } else {
        const fallback = items.length || 36;
        handleTotalItemsChange(String(fallback));
        setStartItem(1);
        setEndItem(fallback);
      }
    }
  }, [excelRecords, handleTotalItemsChange, items.length]);

  const handleOrientationChange = useCallback((next: string) => {
    setOrientation(next as Orientation);
    const rows = next === 'landscape' ? 18 : 37;
    setEndItem((prev) =>
      Math.max(startItem, Math.min(prev, maxItem, startItem + rows - 1)),
    );
  }, [startItem, maxItem]);

  const waitForPdfRender = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

  const yieldToBrowser = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

  const handleGeneratePdf = useCallback(async () => {
    if (!logosLoaded) return;

    setIsGeneratingPdf(true);
    setPdfProgress('Preparando...');

    let wrapper: HTMLDivElement | null = null;
    let root: ReturnType<typeof createRoot> | null = null;

    try {
      if (document.fonts?.ready) await document.fonts.ready;

      const isLandscape = orientation === 'landscape';
      const { default: jsPDF } = await import('jspdf');
      const pdf = new jsPDF({
        unit: 'mm',
        format: 'a4',
        orientation: isLandscape ? 'landscape' : 'portrait',
        compress: true,
        putOnlyUsedFonts: true,
      });

      const pdfW = isLandscape ? 297 : 210;
      const pdfH = isLandscape ? 210 : 297;

      const PX_PER_MM = 3.7795;
      const SCALE = 2;
      const targetPxW = Math.round(pdfW * PX_PER_MM * SCALE);

      const container = pdfContainerRef.current;
      if (!container) return;

      const exportHostWidth = isLandscape ? 1123 : 794;

      wrapper = document.createElement('div');
      wrapper.className = 'vpad-pdf-export-root vpad-export-mode';
      wrapper.style.cssText = [
        'position:fixed',
        'left:-200vw',
        'top:0',
        `width:${exportHostWidth}px`,
        'overflow:visible',
        'pointer-events:none',
        'z-index:-1',
      ].join(';');
      container.appendChild(wrapper);
      root = createRoot(wrapper);

      const BATCH_SIZE = 10;
      const JPEG_QUALITY = 0.92;
      const totalBatches = Math.ceil(pages.length / BATCH_SIZE);
      let measuredWidth = 0;
      let sharedFontEmbedCSS: string | undefined;

      for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        const batchStart = batchIdx * BATCH_SIZE;
        const batchEnd = Math.min(batchStart + BATCH_SIZE, pages.length);
        const batchPages = pages.slice(batchStart, batchEnd);

        setPdfProgress(`Páginas ${batchStart + 1}-${batchEnd} de ${pages.length}`);

        root.render(
          <>
            {batchPages.map((pageItems, j) => (
              <div key={j} data-pdf-page={j}>
                <PreviewPage
                  headerData={headerData}
                  items={pageItems}
                  orientation={orientation}
                  accionaLogo={logosBase64.acciona || ACCIONA_LOGO}
                  sedapalLogo={logosBase64.sedapal || SEDAPAL_LOGO}
                  pageNumber={batchStart + j + 1}
                  totalPages={pages.length}
                  isLastPage={batchStart + j === pages.length - 1}
                />
              </div>
            ))}
          </>,
        );

        await waitForPdfRender();

        const targets = wrapper.querySelectorAll('.vpad-sheet');

        if (!sharedFontEmbedCSS && targets.length > 0) {
          sharedFontEmbedCSS = await getFontEmbedCSS(targets[0] as HTMLElement, {
            preferredFontFormat: 'woff2',
          });
        }

        for (let k = 0; k < targets.length; k++) {
          const target = targets[k] as HTMLElement;
          const globalIdx = batchStart + k;
          const width = target.offsetWidth;

          if (width === 0) continue;

          if (!measuredWidth) {
            measuredWidth = width;
          }

          const height = target.offsetHeight;
          const captureScale = targetPxW / measuredWidth;
          const canvas = await toCanvas(target, {
            backgroundColor: '#ffffff',
            pixelRatio: captureScale,
            width: measuredWidth,
            height,
            canvasWidth: targetPxW,
            canvasHeight: Math.round(height * captureScale),
            fontEmbedCSS: sharedFontEmbedCSS,
            preferredFontFormat: 'woff2',
          });
          const jpegBytes = await canvasToJpegBytes(canvas, JPEG_QUALITY);

          if (globalIdx > 0) pdf.addPage();
          pdf.addImage(jpegBytes, 'JPEG', 0, 0, pdfW, pdfH);
        }

        await yieldToBrowser();
      }

      pdf.save(`padron-${startItem}-${endItem}.pdf`);
      await saveToHistory(
        'padron',
        `padron-${startItem}-${endItem}`,
        { orientation, startItem, endItem, pages: pages.length },
        visibleItems.length,
      );
    } finally {
      if (root) {
        root.unmount();
      }
      if (wrapper?.parentNode) {
        wrapper.parentNode.removeChild(wrapper);
      }
      setIsGeneratingPdf(false);
      setPdfProgress('');
    }
  }, [logosLoaded, orientation, pages, headerData, logosBase64, startItem, endItem, visibleItems.length]);

  const handlePrint = useCallback(() => window.print(), []);

  return (
    <div className="vpad-app vpad-app-embedded">
      <aside className={`vpad-sidebar${sidebarVisible ? '' : ' collapsed'}`}>
        {sidebarVisible && (
          <div className="vpad-config-panel">
            <section className="vpad-section">
              <div className="vpad-section-header">
                <span className="vpad-section-number">1</span>
                <h3 className="vpad-section-title">Importar Excel</h3>
              </div>

              <label
                className={`vpad-upload-zone${isImporting ? ' active' : ''}${importedFileName ? ' loaded' : ''}`}
              >
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleExcelUpload}
                  disabled={isImporting}
                />
                {importedFileName ? (
                  <>
                    <div className="vpad-upload-icon vpad-upload-icon-loaded">
                      <CheckCircle size={20} />
                    </div>
                    <div
                      style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}
                    >
                      <span className="vpad-upload-text">{importedFileName}</span>
                      <span className="vpad-upload-hint">{importStatus}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="vpad-upload-icon">
                      <Upload size={20} />
                    </div>
                    <div
                      style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
                    >
                      <span className="vpad-upload-text">
                        {isImporting
                          ? 'Procesando archivo...'
                          : 'Selecciona o arrastra el archivo'}
                      </span>
                      <span className="vpad-upload-hint">
                        Soporte para .xlsx, .xls, .csv
                      </span>
                    </div>
                  </>
                )}
              </label>

              {excelRecords.length > 1 && (
                <div className="vpad-field">
                  <span>Seleccionar registro</span>
                  <select
                    value={selectedRecordId}
                    onChange={(e) => handleRecordSelect(e.target.value)}
                  >
                    {excelRecords.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </section>

            <section className="vpad-section">
              <div className="vpad-section-header">
                <span className="vpad-section-number">2</span>
                <h3 className="vpad-section-title">Formato de Salida</h3>
              </div>

              <div className="vpad-card">
                <div className="vpad-field">
                  <span>Cantidad total de ítems</span>
                  <input
                    type="number"
                    min={1}
                    value={totalItemsCount}
                    onChange={(e) => handleTotalItemsChange(e.target.value)}
                  />
                </div>
                <div className="vpad-field-row">
                  <div className="vpad-field">
                    <span>Orientación</span>
                    <select
                      value={orientation}
                      onChange={(e) => handleOrientationChange(e.target.value)}
                    >
                      {ORIENTATION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="vpad-field">
                    <span>Item inicial</span>
                    <input
                      type="number"
                      min={1}
                      max={maxItem}
                      value={clamp(startItem, 1, maxItem)}
                      onChange={(e) =>
                        setStartItem(clamp(Number(e.target.value), 1, maxItem))
                      }
                    />
                  </div>
                  <div className="vpad-field">
                    <span>Item final</span>
                    <input
                      type="number"
                      min={clamp(startItem, 1, maxItem)}
                      max={maxItem}
                      value={clamp(
                        endItem,
                        clamp(startItem, 1, maxItem),
                        maxItem,
                      )}
                      onChange={(e) =>
                        setEndItem(
                          clamp(
                            Number(e.target.value),
                            clamp(startItem, 1, maxItem),
                            maxItem,
                          ),
                        )
                      }
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="vpad-section">
              <div className="vpad-section-header">
                <span className="vpad-section-number">3</span>
                <h3 className="vpad-section-title">Datos del Padrón</h3>
              </div>

              <div className="vpad-card">
                <div className="vpad-form-grid">
                  {HEADER_FIELDS.map((field) => (
                    <div
                      key={field.key}
                      className={`vpad-field ${field.wide ? 'wide' : ''}`}
                    >
                      <span>{field.shortLabel || field.label}</span>
                      {DATE_FIELDS.has(field.key) ? (
                        <input
                          type="date"
                          value={toISODate(headerData[field.key] ?? '')}
                          onChange={(e) =>
                            handleHeaderChange(
                              field.key,
                              toDisplayDate(e.target.value),
                            )
                          }
                        />
                      ) : field.wide &&
                        field.key !== 'codigoServicio' &&
                        field.key !== 'descripcionServicio' ? (
                        <textarea
                          rows={2}
                          value={headerData[field.key] ?? ''}
                          onChange={(e) =>
                            handleHeaderChange(field.key, e.target.value)
                          }
                          placeholder={
                            field.required ? 'Campo requerido' : 'Opcional'
                          }
                        />
                      ) : (
                        <input
                          type="text"
                          value={headerData[field.key] ?? ''}
                          onChange={(e) =>
                            handleHeaderChange(field.key, e.target.value)
                          }
                          placeholder={
                            field.required ? 'Campo requerido' : 'Opcional'
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <div className="vpad-action-box">
              <button
                className="vpad-btn vpad-btn-primary"
                onClick={handleGeneratePdf}
                disabled={isGeneratingPdf}
              >
                <Download size={18} />{' '}
                {isGeneratingPdf ? pdfProgress || 'Generando...' : 'Descargar PDF'}
              </button>
              <div className="vpad-actions-row">
                <button
                  className="vpad-btn vpad-btn-secondary"
                  onClick={handlePrint}
                >
                  <Printer size={18} /> Imprimir
                </button>
                <button className="vpad-btn vpad-btn-ghost" onClick={handleReset}>
                  <Trash2 size={18} /> Limpiar
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>

      <main className="vpad-preview-area">
        <header className="vpad-preview-toolbar">
          <button
            className="vpad-btn vpad-btn-nav"
            onClick={() => setSidebarVisible(v => !v)}
            title={sidebarVisible ? 'Ocultar panel' : 'Mostrar panel'}
          >
            <PanelLeft size={18} />
          </button>
          <div className="vpad-badges">
            <span className="vpad-badge">
              {orientation === 'landscape' ? 'Horizontal' : 'Vertical'}
            </span>
            <span className="vpad-badge">{visibleItems.length} ítems</span>
            <span className="vpad-badge">{pages.length} página(s)</span>
          </div>
          {pages.length > MAX_PREVIEW_PAGES && (
            <div className="vpad-preview-nav">
              <button
                className="vpad-btn vpad-btn-nav"
                disabled={previewPages.start === 0}
                onClick={() =>
                  setPreviewPageOffset(
                    Math.max(0, previewPageOffset - MAX_PREVIEW_PAGES),
                  )
                }
              >
                &laquo;
              </button>
              <span className="vpad-preview-nav-info">
                Pág. {previewPages.start + 1}–{previewPages.end} de{' '}
                {pages.length}
              </span>
              <button
                className="vpad-btn vpad-btn-nav"
                disabled={previewPages.end >= pages.length}
                onClick={() =>
                  setPreviewPageOffset(
                    Math.min(
                      pages.length - 1,
                      previewPageOffset + MAX_PREVIEW_PAGES,
                    ),
                  )
                }
              >
                &raquo;
              </button>
            </div>
          )}
        </header>

        <div className="vpad-preview-scroll-container">
          <div className="vpad-print-doc" ref={previewRef}>
            {previewPages.items.map((pageItems, i) => {
              const globalIndex = previewPages.start + i;
              return (
                <div className="vpad-print-page" key={globalIndex}>
                  <PreviewPage
                    headerData={headerData}
                    items={pageItems}
                    orientation={orientation}
                    accionaLogo={logosBase64.acciona || ACCIONA_LOGO}
                    sedapalLogo={logosBase64.sedapal || SEDAPAL_LOGO}
                    pageNumber={globalIndex + 1}
                    totalPages={pages.length}
                    isLastPage={globalIndex === pages.length - 1}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </main>
      <div ref={pdfContainerRef} className="vpad-pdf-hidden-container" />
    </div>
  );
}
