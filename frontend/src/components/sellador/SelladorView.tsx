import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileDown,
  FolderOpen,
  Loader2,
  RefreshCw,
  Shuffle,
  Stamp,
  Upload,
  X,
} from "lucide-react";
import { api } from "../../api";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useToast } from "../../hooks/useToast";
import {
  acquireStagedFile,
  type StagedFileHandle,
} from "../../utils/stageFile";
import { fileToBase64 } from "../../utils/pdfAssets";
import { formatBytes } from "../../utils/format";
import { reportFrontendError } from "../../utils/observability";
import { applySellado } from "./applySellado";
import {
  activeIndexAfterRemove,
  nextPositionPreset,
  positionsAfterRemove,
  resolveAssignmentSlots,
} from "./positionOps";
import PositionPanel from "./PositionPanel";
import StampPlacementEditor from "./StampPlacementEditor";
import PdfPagePreview from "./PdfPagePreview";
import { getPdfPageSize, loadPdfDocument } from "./pdfjs";
import { renderOtherPagesPreview } from "./previewRender";
import {
  buildResolvedPlacements,
  buildStampPlacement,
  countAssignments,
  createStampPosition,
  defaultStampRect,
  effectiveStampCount,
  ensureSlotIndices,
  groupPlacementsByPage,
  presetStampRect,
  randomSeed,
  type PdfPageSize,
  type PositionAssignmentMode,
  type StampPosition,
  type StampRect,
} from "./utils";
import Button from "@/components/ui/Button";
import { FileImportInput } from "@/components/ui/FileImportInput";
import { errorMessage } from "@/utils/errors";

const MAX_IN_MEMORY_BYTES = 8 * 1024 * 1024;
const MAX_STAMP_BYTES = 10 * 1024 * 1024;
const READ_FILE_TOKEN_PREFIX = "antares-read_";

function loadImageAspect(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth / img.naturalHeight);
    img.onerror = () => reject(new Error("No se pudo leer el sello"));
    img.src = url;
  });
}

export default function SelladorView() {
  const { addToast } = useToast();
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const stampInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pdfSourceRevision, setPdfSourceRevision] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [pageSize, setPageSize] = useState<PdfPageSize | null>(null);
  const [stampFile, setStampFile] = useState<File | null>(null);
  const [stampPreviewUrl, setStampPreviewUrl] = useState<string | null>(null);
  const [stampCount, setStampCount] = useState(5);
  const [positions, setPositions] = useState<StampPosition[]>([]);
  const [activePositionIndex, setActivePositionIndex] = useState(0);
  const [assignmentMode, setAssignmentMode] =
    useState<PositionAssignmentMode>("cycle");
  const [slotIndices, setSlotIndices] = useState<number[]>([]);
  const [stampAspect, setStampAspect] = useState(1);
  const [seed, setSeed] = useState(() => randomSeed());
  const [pagePreviews, setPagePreviews] = useState<
    Array<{ pageNum: number; url: string; stampCount: number }>
  >([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(900);
  const debouncedPreviewWidth = useDebouncedValue(previewWidth, 300);

  const hasPdfSource = !!pdfPath || !!pdfBase64 || !!pdfFile;
  const hasStampSource = !!stampFile;

  useEffect(() => {
    const node = previewRef.current;
    if (!node) return undefined;

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const applyWidth = (width: number) => {
      setPreviewWidth(width);
    };
    const measure = (immediate = false) => {
      const next = Math.max(node.clientWidth - 32, 320);
      if (immediate) {
        if (debounceTimer) clearTimeout(debounceTimer);
        applyWidth(next);
        return;
      }
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => applyWidth(next), 200);
    };

    measure(true);
    const observer = new ResizeObserver(() => measure(false));
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [hasPdfSource]);

  const effectiveCount = useMemo(
    () => effectiveStampCount(pageCount, stampCount),
    [pageCount, stampCount],
  );

  const placement = useMemo(
    () =>
      pageCount > 0 ? buildStampPlacement(pageCount, stampCount, seed) : null,
    [pageCount, stampCount, seed],
  );

  useEffect(() => {
    if (pageCount > 0 && stampCount > pageCount) {
      setStampCount(pageCount);
    }
  }, [pageCount, stampCount]);

  const assignmentCounts = useMemo(
    () => countAssignments(placement?.pageAssignments ?? []),
    [placement],
  );

  const primaryRect = positions[0]?.rect ?? null;
  const canApply =
    hasPdfSource &&
    hasStampSource &&
    !!primaryRect &&
    pageCount > 0 &&
    stampCount > 0;

  const resolvedPlacements = useMemo(() => {
    if (!placement || positions.length === 0 || effectiveCount === 0) return [];
    const slots = resolveAssignmentSlots(
      assignmentMode,
      effectiveCount,
      slotIndices,
      positions.length,
    );
    return buildResolvedPlacements(
      placement.pageAssignments.slice(0, effectiveCount),
      positions,
      slots,
    );
  }, [assignmentMode, effectiveCount, placement, positions, slotIndices]);

  const placementsByPage = useMemo(
    () => groupPlacementsByPage(resolvedPlacements),
    [resolvedPlacements],
  );

  const initializePositions = useCallback(
    async (size: PdfPageSize, previewUrl: string) => {
      const aspect = await loadImageAspect(previewUrl);
      setStampAspect(aspect);
      setPositions([createStampPosition(1, defaultStampRect(size, aspect))]);
      setActivePositionIndex(0);
    },
    [],
  );

  useEffect(() => {
    if (positions.length === 0) return;
    if (assignmentMode === "cycle") {
      setSlotIndices(
        Array.from({ length: effectiveCount }, (_, i) => i % positions.length),
      );
      return;
    }
    setSlotIndices((prev) =>
      ensureSlotIndices(effectiveCount, prev, positions.length),
    );
  }, [assignmentMode, effectiveCount, positions.length]);

  const applyPdfMetadata = useCallback(
    async (
      file: File,
      nextPageCount: number,
      size: PdfPageSize,
      path: string | null,
      base64: string | null,
    ) => {
      setPdfFile(file);
      setPdfPath(path);
      setPdfBase64(base64);
      setPdfSourceRevision((revision) => revision + 1);
      setPageCount(nextPageCount);
      setPageSize(size);
      setSeed(randomSeed());
      if (stampPreviewUrl) {
        await initializePositions(size, stampPreviewUrl);
      } else {
        setPositions([]);
      }
      const modeLabel = path ? "desde disco" : "en memoria";
      addToast({
        message: `PDF cargado (${nextPageCount} páginas, ${formatBytes(file.size)}, ${modeLabel}).`,
        type: "success",
      });
    },
    [addToast, initializePositions, stampPreviewUrl],
  );

  const loadPdfFromPath = useCallback(
    async (path: string, displayName?: string, fileToken?: string) => {
      if (!fileToken?.startsWith(READ_FILE_TOKEN_PREFIX)) {
        throw new Error(
          "El diálogo no entregó un permiso de lectura para el PDF. Vuelve a seleccionarlo.",
        );
      }
      const source = fileToken;
      const info = await api.selladorInspectPdf({ pdf_path: source });
      const name =
        displayName ||
        info.filename ||
        path.split(/[/\\]/).pop() ||
        "documento.pdf";
      const pseudoFile = new File([], name, { type: "application/pdf" });
      await applyPdfMetadata(
        pseudoFile,
        info.page_count,
        { width: info.page_width, height: info.page_height },
        source,
        null,
      );
    },
    [applyPdfMetadata],
  );

  const loadPdfFile = useCallback(
    async (file: File) => {
      if (
        file.type !== "application/pdf" &&
        !file.name.toLowerCase().endsWith(".pdf")
      ) {
        addToast({
          message: "Selecciona un archivo PDF válido.",
          type: "error",
        });
        return;
      }

      try {
        let inspectHandle: StagedFileHandle | null = null;
        try {
          inspectHandle = await acquireStagedFile(file);
        } catch (err) {
          console.warn(
            "No se pudo preparar el PDF para IPC; se usa la ruta en memoria",
            err,
          );
          reportFrontendError({
            kind: "app_error",
            view: "sellador",
            name: err instanceof Error ? err.name : "StagingError",
            message: errorMessage(err, String(err)),
          });
        }

        try {
          if (inspectHandle?.token) {
            const info = await api.selladorInspectPdf({
              pdf_path: inspectHandle.token,
            });
            await applyPdfMetadata(
              file,
              info.page_count,
              { width: info.page_width, height: info.page_height },
              null,
              null,
            );
            return;
          }

          if (file.size > MAX_IN_MEMORY_BYTES) {
            addToast({
              message:
                "PDF demasiado grande. Ábrelo con «Explorar» en la app de escritorio o arrástralo desde el disco.",
              type: "error",
            });
            return;
          }

          const b64 = await fileToBase64(file);
          const pdf = await loadPdfDocument(b64);
          const size = await getPdfPageSize(b64);
          await applyPdfMetadata(file, pdf.numPages, size, null, b64);
        } finally {
          inspectHandle?.release();
        }
      } catch (error) {
        addToast({
          message: errorMessage(error, "No se pudo leer el PDF."),
          type: "error",
        });
      }
    },
    [addToast, applyPdfMetadata],
  );

  const pickPdfFromDialog = useCallback(async () => {
    try {
      const result = await api.dialogFiles();
      const path = result.paths[0];
      if (!path) return;
      const name = path.split(/[/\\]/).pop();
      await loadPdfFromPath(path, name, result.file_tokens?.[0]);
    } catch (error) {
      addToast({
        message: errorMessage(error, "No se pudo abrir el PDF."),
        type: "error",
      });
    }
  }, [addToast, loadPdfFromPath]);

  const loadStampFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        addToast({
          message: "Selecciona una imagen PNG o JPG para el sello.",
          type: "error",
        });
        return;
      }
      if (file.size > MAX_STAMP_BYTES) {
        addToast({
          message: "El sello es demasiado grande (máx. 10 MB).",
          type: "error",
        });
        return;
      }
      try {
        if (stampPreviewUrl) URL.revokeObjectURL(stampPreviewUrl);
        const previewUrl = URL.createObjectURL(file);
        setStampFile(file);
        setStampPreviewUrl(previewUrl);
        if (pageSize) {
          await initializePositions(pageSize, previewUrl);
        }
        addToast({
          message: "Sello cargado. Arrástralo sobre la página para ubicarlo.",
          type: "success",
        });
      } catch (error) {
        addToast({
          message: errorMessage(error, "No se pudo leer el sello."),
          type: "error",
        });
      }
    },
    [addToast, initializePositions, pageSize, stampPreviewUrl],
  );

  useEffect(
    () => () => {
      if (stampPreviewUrl) URL.revokeObjectURL(stampPreviewUrl);
    },
    [stampPreviewUrl],
  );

  useEffect(() => {
    if (!hasPdfSource || !primaryRect || pageCount <= 0 || !pageSize) {
      setPagePreviews([]);
      return;
    }

    let cancelled = false;
    const isInitialOtherPages = pagePreviews.length === 0;
    if (isInitialOtherPages) setPreviewLoading(true);

    renderOtherPagesPreview({
      pdfPath,
      pdfBase64,
      pdfFile,
      sourceRevision: pdfSourceRevision,
      pageCount,
      containerW: debouncedPreviewWidth,
      stampUrl: stampPreviewUrl,
      placementsByPage,
      pageSize,
      assignmentCounts,
      onProgress: (previews) => {
        if (!cancelled) setPagePreviews(previews);
      },
      isCancelled: () => cancelled,
    })
      .then(() => {
        if (!cancelled) setPreviewLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewLoading(false);
          addToast({
            message: "No se pudo generar la vista previa.",
            type: "error",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    addToast,
    assignmentCounts,
    hasPdfSource,
    pageCount,
    pageSize,
    pdfBase64,
    pdfFile,
    pdfPath,
    pdfSourceRevision,
    debouncedPreviewWidth,
    stampPreviewUrl,
    placementsByPage,
    primaryRect,
  ]);

  const updatePositionRect = useCallback((index: number, rect: StampRect) => {
    setPositions((current) =>
      current.map((pos, i) => (i === index ? { ...pos, rect } : pos)),
    );
  }, []);

  const handleAddPosition = useCallback(() => {
    if (!pageSize || !primaryRect) return;
    const rect = presetStampRect(
      pageSize,
      stampAspect,
      nextPositionPreset(positions.length),
      primaryRect,
    );
    setPositions((current) => [
      ...current,
      createStampPosition(current.length + 1, rect),
    ]);
    setActivePositionIndex(positions.length);
  }, [pageSize, positions.length, primaryRect, stampAspect]);

  const handleRemovePosition = useCallback(
    (index: number) => {
      if (positions.length <= 1) return;
      setPositions((current) => positionsAfterRemove(current, index));
      setActivePositionIndex((current) =>
        activeIndexAfterRemove(current, index),
      );
    },
    [positions.length],
  );

  const handleApply = async () => {
    if (!canApply || !primaryRect || !pdfFile || !stampFile) return;
    setApplying(true);
    try {
      await applySellado({
        pdfFile,
        pdfPath,
        pdfBase64,
        stampFile,
        primaryRect,
        resolvedPlacements,
        positions,
        seed,
        onToast: (message, type) => addToast({ message, type }),
      });
    } finally {
      setApplying(false);
    }
  };

  const clearPdf = () => {
    setPdfFile(null);
    setPdfPath(null);
    setPdfBase64(null);
    setPageCount(0);
    setPageSize(null);
    setPositions([]);
    setPagePreviews([]);
  };

  const clearStamp = () => {
    if (stampPreviewUrl) URL.revokeObjectURL(stampPreviewUrl);
    setStampFile(null);
    setStampPreviewUrl(null);
    setPositions([]);
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden bg-[var(--bg-base)] px-2 py-2 text-[var(--text-primary)]">
      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-[14px] border border-[var(--border-medium)] bg-[var(--bg-surface)] p-4">
          <div className="space-y-2">
            <label className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
              PDF
            </label>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
              {pdfFile ? (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{pdfFile.name}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {pageCount} páginas
                      {pdfFile.size > 0
                        ? ` · ${formatBytes(pdfFile.size)}`
                        : null}
                      {pdfPath ? " · lectura directa" : null}
                    </p>
                  </div>
                  <Button
                    variant="none"
                    size="none"
                    onClick={clearPdf}
                    className="text-[var(--text-muted)] hover:text-[var(--accent-red)]"
                  >
                    <X size={14} />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Button
                    variant="none"
                    size="none"
                    onClick={() => pdfInputRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-[var(--border-medium)] px-3 py-3 text-[11px] text-[var(--text-muted)] hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)]"
                  >
                    <Upload size={14} />
                    Cargar PDF
                  </Button>
                  <Button
                    variant="none"
                    size="none"
                    onClick={() => void pickPdfFromDialog()}
                    className="flex w-full items-center justify-center gap-2 rounded-md border border-[var(--border-medium)] px-3 py-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
                  >
                    <FolderOpen size={14} />
                    Explorar (archivos grandes)
                  </Button>
                </div>
              )}
              <FileImportInput
                ref={pdfInputRef}
                accept="application/pdf,.pdf"
                className="hidden"
                onFiles={(files) => {
                  const file = files?.[0];
                  if (file) void loadPdfFile(file);
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
              Imagen del sello
            </label>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
              {stampFile ? (
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm">{stampFile.name}</p>
                    <Button
                      variant="none"
                      size="none"
                      onClick={clearStamp}
                      className="text-[var(--text-muted)] hover:text-[var(--accent-red)]"
                    >
                      <X size={14} />
                    </Button>
                  </div>
                  {stampPreviewUrl ? (
                    <img
                      src={stampPreviewUrl}
                      alt="Vista previa del sello"
                      className="mx-auto max-h-24 cursor-grab object-contain active:cursor-grabbing"
                      draggable
                      onDragStart={(event) =>
                        event.dataTransfer.setData(
                          "text/sellador-stamp",
                          "move",
                        )
                      }
                    />
                  ) : null}
                </div>
              ) : (
                <Button
                  variant="none"
                  size="none"
                  onClick={() => stampInputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-[var(--border-medium)] px-3 py-4 text-[11px] text-[var(--text-muted)] hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)]"
                >
                  <Upload size={14} />
                  Cargar sello
                </Button>
              )}
              <FileImportInput
                ref={stampInputRef}
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onFiles={(files) => {
                  const file = files?.[0];
                  if (file) void loadStampFile(file);
                }}
              />
            </div>
          </div>

          <label className="space-y-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
              Cantidad de sellos
            </span>
            <input
              type="number"
              min={1}
              max={pageCount > 0 ? pageCount : undefined}
              value={stampCount}
              onChange={(e) => {
                const raw = Math.max(1, Number(e.target.value) || 1);
                setStampCount(pageCount > 0 ? Math.min(raw, pageCount) : raw);
              }}
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-sm"
            />
            {pageCount > 0 ? (
              <p className="text-[10px] text-[var(--text-muted)]">
                Máximo {pageCount} (un sello por página).
              </p>
            ) : null}
          </label>

          {pageSize && positions.length > 0 && stampPreviewUrl ? (
            <PositionPanel
              positions={positions}
              activeIndex={activePositionIndex}
              stampCount={effectiveCount}
              slotIndices={slotIndices}
              assignmentMode={assignmentMode}
              onSelectPosition={setActivePositionIndex}
              onAddPosition={handleAddPosition}
              onRemovePosition={handleRemovePosition}
              onAssignmentModeChange={setAssignmentMode}
              onSlotChange={(stampIndex, positionIndex) => {
                setAssignmentMode("manual");
                setSlotIndices((prev) => {
                  const next = ensureSlotIndices(
                    stampCount,
                    prev,
                    positions.length,
                  );
                  next[stampIndex] = positionIndex;
                  return [...next];
                });
              }}
            />
          ) : null}

          <div className="flex flex-col gap-2">
            <Button
              variant="none"
              size="none"
              onClick={() => setSeed(randomSeed())}
              disabled={!canApply}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--border-medium)] px-4 py-2.5 text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] disabled:opacity-30"
            >
              <Shuffle size={13} />
              Reordenar
            </Button>
            <Button
              variant="none"
              size="none"
              onClick={handleApply}
              disabled={!canApply || applying}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--border-medium)] bg-[var(--text-primary)] px-4 py-2.5 text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--bg-base)] transition-all hover:opacity-90 disabled:opacity-30"
            >
              {applying ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <FileDown size={13} />
              )}
              Aplicar y guardar
            </Button>
          </div>

          {placement ? (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-[11px] text-[var(--text-secondary)]">
              <p>
                {effectiveCount} sello(s) en {placement.stampedPages.length}{" "}
                página(s) distintas
              </p>
              <p className="mt-1 text-[var(--text-muted)]">
                Páginas: {placement.stampedPages.join(", ") || "—"}
              </p>
            </div>
          ) : null}
        </aside>

        <section
          ref={previewRef}
          className="min-h-0 overflow-y-auto rounded-[14px] border border-[var(--border-medium)] bg-[var(--bg-surface)] p-4"
        >
          {!hasPdfSource ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
              <Stamp size={36} className="opacity-40" />
              <p className="text-sm">
                Carga un PDF para ubicar el sello con arrastre.
              </p>
              <p className="max-w-md text-center text-[11px]">
                PDFs de 50 MB o más: usa «Explorar» o arrastra desde el disco
                (sin cargar todo en memoria).
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {stampPreviewUrl &&
              primaryRect &&
              pageSize &&
              positions.length > 0 ? (
                <StampPlacementEditor
                  pdfBase64={pdfBase64}
                  pdfPath={pdfPath}
                  pdfFile={pdfFile}
                  sourceRevision={pdfSourceRevision}
                  stampUrl={stampPreviewUrl}
                  positions={positions}
                  activeIndex={activePositionIndex}
                  pageSize={pageSize}
                  previewWidth={debouncedPreviewWidth}
                  onChangePosition={updatePositionRect}
                />
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Vista previa del PDF. Carga el sello para ubicarlo sobre la
                    página.
                  </p>
                  <PdfPagePreview
                    pdfBase64={pdfBase64}
                    pdfPath={pdfPath}
                    pdfFile={pdfFile}
                    sourceRevision={pdfSourceRevision}
                    width={debouncedPreviewWidth}
                    onPageSize={(size) =>
                      setPageSize((current) => current ?? size)
                    }
                  />
                </div>
              )}

              {pageCount > 1 && primaryRect && pageSize ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                    <span className="font-mono uppercase tracking-widest">
                      Otras páginas
                    </span>
                    {previewLoading ? (
                      <RefreshCw size={12} className="animate-spin" />
                    ) : null}
                  </div>
                  {pagePreviews.map((page) => (
                    <div
                      key={page.pageNum}
                      className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-white"
                    >
                      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px]">
                        <span>Página {page.pageNum}</span>
                        {page.stampCount > 0 ? (
                          <span className="rounded-full bg-[var(--accent-primary)]/10 px-2 py-0.5 text-[var(--accent-primary)]">
                            {page.stampCount} sello
                            {page.stampCount > 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)]">
                            Sin sello
                          </span>
                        )}
                      </div>
                      {page.url ? (
                        <img
                          src={page.url}
                          alt={`Página ${page.pageNum}`}
                          loading="lazy"
                          decoding="async"
                          className="block w-full"
                        />
                      ) : previewLoading ? (
                        <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
                          <Loader2 size={16} className="animate-spin" />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
