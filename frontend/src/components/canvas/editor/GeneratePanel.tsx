import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../api';
import type { PdfQuality } from '../../../utils/pdfAssets';
import { imageToPdfSource } from '../../../utils/pdfAssets';
import type { CanvasDocument, CanvasDocumentSummary } from '../types';
import { A4_HEIGHT_PX, A4_WIDTH_PX, normalizeDocument } from '../types';
import { buildRowData, matchesRecordId, naturalSortByName, parseSpreadsheetFile } from '../runtime/excel';
import { renderCanvasHtml, type FillContext } from '../runtime/renderHtml';
import { renderMultiPageHtml, templateImagesPerPage } from '../ops/pages';
import { exportCanvasPdf } from '../export/exportPdf';
import { selectGenerateRowIndices, type GenerateExportScope } from '../ops/generateExport';
import GenerateSidebar from './GenerateSidebar';
import PreviewViewport, { type PreviewViewportHandle } from './PreviewViewport';

interface GeneratePanelProps {
  document: CanvasDocument;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function GeneratePanel({ document: designDocument }: GeneratePanelProps) {
  const previewRef = useRef<PreviewViewportHandle>(null);

  const [docs, setDocs] = useState<CanvasDocumentSummary[]>([]);
  const [generateDoc, setGenerateDoc] = useState<CanvasDocument>(designDocument);
  const [selectedTemplateId, setSelectedTemplateId] = useState(designDocument.id);

  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [idColumn, setIdColumn] = useState('');
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [images, setImages] = useState<File[]>([]);
  const [logoLeft, setLogoLeft] = useState<string | null>(null);
  const [logoRight, setLogoRight] = useState<string | null>(null);
  const [rowIndex, setRowIndex] = useState(0);
  const [searchOrder, setSearchOrder] = useState('');
  const [exportScope, setExportScope] = useState<GenerateExportScope>('single');
  const [pdfQuality, setPdfQuality] = useState<PdfQuality>('high');
  const [requiresImages, setRequiresImages] = useState(true);
  const [showPlaceholders, setShowPlaceholders] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [dragData, setDragData] = useState(false);
  const [dragImages, setDragImages] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
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

  const fieldKeys = useMemo(() => {
    const fromLayers = generateDoc.layers
      .filter((l) => l.type === 'field' && l.meta?.key)
      .map((l) => l.meta!.key!);
    return [...new Set(fromLayers)];
  }, [generateDoc.layers]);

  const layerCount = generateDoc.layers.filter((l) => l.type !== 'frame').length;
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
        setGenerateDoc(designDocument);
        setSelectedTemplateId(id);
        return;
      }
      const res = await api.canvasGet(id);
      setGenerateDoc(normalizeDocument(res.document as CanvasDocument));
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
        if (quality === 'preview') {
          urls = await Promise.all(matched.map((f) => readFileAsDataUrl(f)));
        } else {
          const sources = await Promise.all(
            matched.map((f, idx) => imageToPdfSource(f, quality, `row-${i}-img-${idx}`)),
          );
          urls = sources.map((s) => s.src);
          for (const s of sources) {
            if (s.token && s.localPath) localImagePaths[s.token] = s.localPath;
          }
        }
        contexts.push({ data, images: urls, logoLeft, logoRight });
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
        const demo: Record<string, string> = {};
        for (const key of fieldKeys) demo[key] = `{{${key}}}`;
        ctx = { data: demo, images: [], logoLeft, logoRight };
      }
      const perPage = templateImagesPerPage(generateDoc);
      const html =
        ctx.images.length > perPage
          ? renderMultiPageHtml(generateDoc, ctx)
          : renderCanvasHtml(generateDoc, ctx, { forScreen: true });
      setPreviewHtml(html);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al renderizar preview');
    }
  }, [generateDoc, rows, rowIndex, buildContexts, logoLeft, logoRight, showPlaceholders, fieldKeys]);

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
          ? `${generateDoc.name || 'canvas'}_consolidado.pdf`
          : `${generateDoc.name || 'canvas'}.pdf`;
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
        document: generateDoc,
        contexts,
        filename,
        outputPath,
        localImagePaths,
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
        onLogoLeft={setLogoLeft}
        onLogoRight={setLogoRight}
        templateValid={templateValid}
        templateOptions={templateOptions}
        selectedTemplateId={selectedTemplateId}
        onSelectTemplate={(id) => void onSelectTemplate(id)}
        templateName={generateDoc.name}
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
        widthPx={A4_WIDTH_PX}
        heightPx={A4_HEIGHT_PX}
      />
    </div>
  );
}
