import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../api';
import type { PdfQuality } from '../../../utils/pdfAssets';
import { imageToPdfSource } from '../../../utils/pdfAssets';
import type { CanvasDocument, CanvasDocumentSummary } from '../types';
import { A4_HEIGHT_PX, A4_WIDTH_PX, normalizeDocument } from '../types';
import { collectDemoFieldKeys } from '../runtime/demoFill';
import { buildRowData, matchesRecordId, naturalSortByName, parseSpreadsheetFile } from '../runtime/excel';
import { type FillContext } from '../runtime/renderHtml';
import { planMultiPageDocuments, renderMultiPageHtml } from '../ops/pages';
import { exportCanvasPdf } from '../export/exportPdf';
import { selectGenerateRowIndices, type GenerateExportScope } from '../ops/generateExport';
import GenerateSidebar from './GenerateSidebar';
import PageLayerPreview, { documentWithFill } from './PageLayerPreview';
import PreviewViewport, { type PreviewViewportHandle } from './PreviewViewport';

const PAGE_STACK_GAP_PX = 24;

interface GeneratePanelProps {
  document: CanvasDocument;
  /**
   * Unused on mount: Generar only lists via canvasList.
   * Shell focus sync (useCanvasSync) already covers cloud pull — do not call here.
   * Kept optional so CanvasView can keep passing it without a pull on open.
   */
  runCloudSync?: () => Promise<void>;
}

function revokeIfBlobUrl(url: string | null | undefined): void {
  if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
}

/** Revoke after two animation frames so the new preview can paint first. */
function revokeBlobUrlsAfterPaint(urls: string[]): void {
  if (urls.length === 0) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      for (const u of urls) revokeIfBlobUrl(u);
    });
  });
}

/** Persist blob:/http(s) URLs to data: for PDF export (cross-context safe). */
async function toPersistentUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  if (!url.startsWith('blob:') && !url.startsWith('http://') && !url.startsWith('https://')) {
    return url;
  }
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
}

export default function GeneratePanel({
  document: designDocument,
}: GeneratePanelProps) {
  const previewRef = useRef<PreviewViewportHandle>(null);
  /** Preview ObjectURLs created for the current row — revoked on refresh/unmount. */
  const previewObjectUrlsRef = useRef<string[]>([]);

  const [docs, setDocs] = useState<CanvasDocumentSummary[]>([]);
  const [externalDoc, setExternalDoc] = useState<CanvasDocument | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState(designDocument.id);

  /** Live design doc when selected; disk-loaded doc when user picks another template. */
  const templateDoc = useMemo(
    () => (selectedTemplateId === designDocument.id ? designDocument : externalDoc ?? designDocument),
    [selectedTemplateId, designDocument, externalDoc],
  );

  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [idColumn, setIdColumn] = useState('');
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [images, setImages] = useState<File[]>([]);
  const [logoLeft, setLogoLeft] = useState<string | null>(null);
  const [logoRight, setLogoRight] = useState<string | null>(null);

  const setLogoLeftSafe = useCallback((url: string | null) => {
    setLogoLeft((prev) => {
      if (prev && prev !== url) revokeIfBlobUrl(prev);
      return url;
    });
  }, []);
  const setLogoRightSafe = useCallback((url: string | null) => {
    setLogoRight((prev) => {
      if (prev && prev !== url) revokeIfBlobUrl(prev);
      return url;
    });
  }, []);

  const logoLeftRef = useRef(logoLeft);
  const logoRightRef = useRef(logoRight);
  logoLeftRef.current = logoLeft;
  logoRightRef.current = logoRight;
  useEffect(
    () => () => {
      revokeIfBlobUrl(logoLeftRef.current);
      revokeIfBlobUrl(logoRightRef.current);
      for (const u of previewObjectUrlsRef.current) revokeIfBlobUrl(u);
      previewObjectUrlsRef.current = [];
    },
    [],
  );

  const [rowIndex, setRowIndex] = useState(0);
  const [searchOrder, setSearchOrder] = useState('');
  const [exportScope, setExportScope] = useState<GenerateExportScope>('single');
  const [pdfQuality, setPdfQuality] = useState<PdfQuality>('high');
  const [colorMode, setColorMode] = useState<'rgb' | 'cmyk'>('rgb');
  const [colorProfile, setColorProfile] = useState('cmyk_iso_coated_v2');
  const [bleedMm, setBleedMm] = useState(0);
  const [showCropMarks, setShowCropMarks] = useState(false);
  const [requiresImages, setRequiresImages] = useState(true);
  const [showPlaceholders, setShowPlaceholders] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewPages, setPreviewPages] = useState<CanvasDocument[]>([]);
  const [dragData, setDragData] = useState(false);
  const [dragImages, setDragImages] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // List only — shell focus sync already covers cloud; do not pull here.
        const res = await api.canvasList();
        if (!cancelled) setDocs(res.documents);
      } catch {
        if (!cancelled) setDocs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fieldKeys = useMemo(
    () => collectDemoFieldKeys(templateDoc),
    [templateDoc],
  );

  const layerCount = templateDoc.layers.filter((l) => l.type !== 'frame').length;
  const templateValid = layerCount > 0;

  const templateOptions = useMemo(() => {
    const byId = new Map(docs.map((d) => [d.id, d]));
    byId.set(designDocument.id, {
      id: designDocument.id,
      name: designDocument.name || byId.get(designDocument.id)?.name || 'Sin título',
    });
    return [...byId.values()];
  }, [docs, designDocument.id, designDocument.name]);

  const stepStates = useMemo(
    () => [
      !!(logoLeft || logoRight),
      templateValid,
      rows.length > 0,
      !!idColumn,
      !requiresImages || images.length > 0,
      rows.length > 0 && (exportScope === 'all' || rows[rowIndex] != null),
    ],
    [logoLeft, logoRight, templateValid, rows, idColumn, requiresImages, images.length, exportScope, rowIndex],
  );
  const completedCount = stepStates.filter(Boolean).length;

  const onSelectTemplate = async (id: string) => {
    if (!id) return;
    setError(null);
    try {
      if (id === designDocument.id) {
        setExternalDoc(null);
        setSelectedTemplateId(id);
        return;
      }
      const res = await api.canvasGet(id);
      setExternalDoc(normalizeDocument(res.document as CanvasDocument));
      setSelectedTemplateId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la plantilla');
    }
  };

  const buildContexts = useCallback(
    async (
      indices: number[],
      quality: PdfQuality | 'preview',
    ): Promise<{ contexts: FillContext[]; localImagePaths: Record<string, string> }> => {
      const contexts: FillContext[] = [];
      const localImagePaths: Record<string, string> = {};
      for (const i of indices) {
        const row = rows[i];
        if (!row) continue;
        const data = buildRowData(row, mappings);
        const recordId = idColumn ? row[idColumn] : '';
        const matched = images
          .filter((f) => matchesRecordId(f.name, recordId))
          .sort((a, b) => naturalSortByName(a.name, b.name));

        let urls: string[];
        let logos: { logoLeft: string | null; logoRight: string | null };
        if (quality === 'preview') {
          urls = matched.map((f) => URL.createObjectURL(f));
          logos = { logoLeft, logoRight };
        } else {
          const sources = await Promise.all(
            matched.map((f, idx) => imageToPdfSource(f, quality, `row-${i}-img-${idx}`)),
          );
          urls = sources.map((s) => s.src);
          for (const s of sources) {
            if (s.token && s.localPath) localImagePaths[s.token] = s.localPath;
          }
          // PDF path needs durable data: URLs — blob: is session-local.
          logos = {
            logoLeft: await toPersistentUrl(logoLeft),
            logoRight: await toPersistentUrl(logoRight),
          };
        }
        const imageMeta = matched.map((f) => ({ name: f.name }));
        contexts.push({ data, images: urls, ...logos, imageMeta });
      }
      return { contexts, localImagePaths };
    },
    [rows, mappings, idColumn, images, logoLeft, logoRight],
  );

  const refreshPreview = useCallback(async () => {
    try {
      let ctx: FillContext = { data: {}, images: [], logoLeft, logoRight };
      if (rows.length > 0) {
        const { contexts } = await buildContexts([rowIndex], 'preview');
        ctx = contexts[0] || ctx;
      } else if (showPlaceholders) {
        // Match design artboard: empty data → field.meta.fallback ("-"), Logo L/R, Foto N.
        ctx = { data: {}, images: [], logoLeft, logoRight };
      }
      const prevPreviewUrls = previewObjectUrlsRef.current;
      previewObjectUrlsRef.current = ctx.images.filter((u) => u.startsWith('blob:'));
      // Screen preview uses LayerNode (same as Diseño). HTML kept for print/PDF only.
      const plan = planMultiPageDocuments(templateDoc, ctx);
      setPreviewPages(plan.map(({ pageDoc, pageCtx }) => documentWithFill(pageDoc, pageCtx)));
      const html = renderMultiPageHtml(templateDoc, ctx, { forScreen: true });
      setPreviewHtml(html);
      setError(null);
      // Wait until after paint so <img> of the new row is not left on a revoked blob:.
      revokeBlobUrlsAfterPaint(prevPreviewUrls);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al renderizar preview');
    }
  }, [templateDoc, rows, rowIndex, buildContexts, logoLeft, logoRight, showPlaceholders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshPreview();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [refreshPreview]);

  const onExcel = async (file: File | null) => {
    if (!file) return;
    setError(null);
    try {
      const parsed = await parseSpreadsheetFile(file);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setRowIndex(0);
      if (parsed.headers.length) setIdColumn(parsed.headers[0]);
      const auto: Record<string, string> = {};
      for (const key of fieldKeys) {
        const hit = parsed.headers.find(
          (h) => h.toUpperCase() === key.toUpperCase() || h.toUpperCase().includes(key.toUpperCase()),
        );
        if (hit) auto[key] = hit;
      }
      setMappings((prev) => ({ ...auto, ...prev }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al leer Excel');
    }
  };

  const onExport = async () => {
    if (exportScope === 'single' && rows.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const indices = selectGenerateRowIndices({
        rows,
        rowIndex,
        exportScope,
        idColumn,
        requiresImages,
        images,
      });
      if (!indices.length) {
        setError(
          requiresImages
            ? 'No hay filas con imágenes coincidentes para exportar'
            : 'No hay filas para exportar',
        );
        setBusy(false);
        return;
      }
      const { contexts, localImagePaths } = await buildContexts(indices, pdfQuality);
      if (!contexts.length) {
        setError('No hay filas para exportar');
        setBusy(false);
        return;
      }
      const filename =
        exportScope === 'all'
          ? `${templateDoc.name || 'canvas'}_consolidado.pdf`
          : `${templateDoc.name || 'canvas'}.pdf`;
      const save = await api.dialogSave({
        title: 'Guardar PDF Canvas',
        defaultPath: filename,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      const outputPath = save.paths?.[0];
      if (!outputPath) {
        setBusy(false);
        return;
      }
      await exportCanvasPdf({
        document: templateDoc,
        contexts,
        filename,
        outputPath,
        localImagePaths,
        colorMode,
        colorProfile,
        bleedMm,
        showCropMarks,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al exportar PDF');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1" style={{ background: 'var(--cv-bg)' }}>
      <GenerateSidebar
        stepStates={stepStates}
        completedCount={completedCount}
        logoLeft={logoLeft}
        logoRight={logoRight}
        onLogoLeft={setLogoLeftSafe}
        onLogoRight={setLogoRightSafe}
        templateValid={templateValid}
        templateOptions={templateOptions}
        selectedTemplateId={selectedTemplateId}
        onSelectTemplate={(id) => void onSelectTemplate(id)}
        templateName={templateDoc.name}
        layerCount={layerCount}
        fieldKeys={fieldKeys}
        requiresImages={requiresImages}
        onRequiresImages={setRequiresImages}
        rows={rows}
        headers={headers}
        idColumn={idColumn}
        onIdColumn={setIdColumn}
        mappings={mappings}
        onMapping={(key, column) => setMappings((m) => ({ ...m, [key]: column }))}
        images={images}
        onImages={setImages}
        onAppendImages={(files) => setImages((prev) => [...prev, ...files])}
        dragData={dragData}
        setDragData={setDragData}
        dragImages={dragImages}
        setDragImages={setDragImages}
        onExcel={(file) => void onExcel(file)}
        searchOrder={searchOrder}
        onSearchOrder={setSearchOrder}
        rowIndex={rowIndex}
        onRowIndex={setRowIndex}
        exportScope={exportScope}
        onExportScope={setExportScope}
        pdfQuality={pdfQuality}
        onPdfQuality={setPdfQuality}
        colorMode={colorMode}
        onColorMode={setColorMode}
        colorProfile={colorProfile}
        onColorProfile={setColorProfile}
        bleedMm={bleedMm}
        onBleedMm={setBleedMm}
        showCropMarks={showCropMarks}
        onShowCropMarks={setShowCropMarks}
        showPlaceholders={showPlaceholders}
        onShowPlaceholders={setShowPlaceholders}
        busy={busy}
        onExport={() => void onExport()}
        onPrint={() => previewRef.current?.print()}
        error={error}
      />

      <PreviewViewport
        ref={previewRef}
        html={previewHtml}
        ready={previewPages.length > 0}
        widthPx={A4_WIDTH_PX}
        heightPx={
          previewPages.length > 0
            ? previewPages.length * A4_HEIGHT_PX + (previewPages.length - 1) * PAGE_STACK_GAP_PX
            : A4_HEIGHT_PX
        }
      >
        {previewPages.length > 0
          ? (scale) => (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: PAGE_STACK_GAP_PX * scale,
                  alignItems: 'center',
                }}
              >
                {previewPages.map((pageDoc, i) => (
                  <PageLayerPreview key={`${pageDoc.id}-p${i}`} document={pageDoc} scale={scale} />
                ))}
              </div>
            )
          : null}
      </PreviewViewport>
    </div>
  );
}
