import { useState, useEffect, useRef, useCallback } from 'react';
import {
    FileDown, Loader2, ScanLine, ChevronRight, AlertCircle, RefreshCw, Layers,
    Upload, Trash2, Settings2, Check, X, Plus, FileText, Move, Eye,
} from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../hooks/useToast';
import { useDialog } from '../../hooks/useDialog';

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
import type { FormatInfo, VisualMapping } from '../../types';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorker;

const MAX_PREVIEW_PAGES = 30;
const PREVIEW_DEBOUNCE_MS = 400;
const SIMPLE_OVERLAY_DEFAULT_MAPPING: VisualMapping = {
    page: 0,
    x: 500,
    y: 30,
    width: 140,
    height: 20,
    font_size: 12,
    font_name: 'Helvetica-Bold',
    color_r: 0,
    color_g: 0,
    color_b: 0,
    padding: 7,
    blank_x: null,
    blank_y: null,
    blank_width: null,
    blank_height: null,
    redraw_top_border: false,
    redraw_ot_badge: false,
    blank_mcids: null,
};

function pad(n: number, len = 7) {
    return String(n).padStart(len, '0');
}

/* ─── Types ──────────────────────────────────────────────────── */
interface PageImg { url: string; pageNum: number; }

/* ─── Optimized single page renderer (async + JPEG) ──────────── */
async function renderPageToUrl(
    pdf: PDFDocumentProxy,
    pageNum: number,
    containerW: number,
    dpr: number,
): Promise<string> {
    const page = await pdf.getPage(pageNum);
    const unscaled = page.getViewport({ scale: 1 });
    // Cap scale so hi-res PDFs don't create massive canvases
    const scale = Math.min((containerW / unscaled.width) * dpr, 2.5);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    const renderTask = page.render({ canvasContext: ctx, viewport } as any);
    await renderTask.promise;
    // JPEG is ~5x faster than PNG toDataURL and smaller
    return canvas.toDataURL('image/jpeg', 0.88);
}

/* ─── Multi-page PDF Viewer ──────────────────────────────────── */
function PdfMultiViewer({ blob, desde, total, padLen }: { blob: Blob | null; desde: number; total: number; padLen: number }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [pageImgs, setPageImgs] = useState<PageImg[]>([]);
    const [renderingPage, setRenderingPage] = useState(0);
    const [zoom, setZoom] = useState(100);
    const zoomStep = 25;
    const rafId = useRef(0);

    useEffect(() => {
        if (!blob) { setPageImgs([]); setRenderingPage(0); return; }
        let cancelled = false;
        setPageImgs([]);

        async function renderAll() {
            const ab = await blob!.arrayBuffer();
            if (cancelled) return;

            const pdf = await getDocument({ data: ab }).promise;
            if (cancelled) return;
            const numPages = pdf.numPages;
            const containerW = (containerRef.current?.clientWidth ?? 1100) - 32;
            const dpr = Math.min(window.devicePixelRatio || 1, 1.5); // Cap DPR for speed

            for (let i = 1; i <= numPages; i++) {
                if (cancelled) break;
                setRenderingPage(i);

                // Yield to event loop between pages to keep UI responsive
                await new Promise<void>(r => { rafId.current = requestAnimationFrame(() => r()); });

                const url = await renderPageToUrl(pdf, i, containerW, dpr);
                if (cancelled) break;
                setPageImgs(prev => [...prev, { url, pageNum: i }]);
            }

            if (!cancelled) setRenderingPage(0);
        }

        renderAll().catch(e => {
            if (e?.name !== 'RenderingCancelledException') console.warn('render error', e);
            if (!cancelled) setRenderingPage(0);
        });

        return () => {
            cancelled = true;
            cancelAnimationFrame(rafId.current);
            // Data URLs don't need revocation; just drop refs
            setPageImgs([]);
        };
    }, [blob]);

    const isCapped = total > MAX_PREVIEW_PAGES;
    const previewCount = Math.min(total, MAX_PREVIEW_PAGES);

    return (
        <div ref={containerRef} className="w-full h-full overflow-y-auto flex flex-col" style={{ scrollbarWidth: 'thin', scrollbarColor: '#2a2a2a transparent' }}>
            <div className="flex items-center justify-center gap-3 py-2 px-4 bg-[#0A0A0A]/50 border-b border-[#1A1A1A] flex-shrink-0">
                <button onClick={() => setZoom(z => Math.max(50, z - zoomStep))} className="w-7 h-7 rounded bg-[#1A1A1A] hover:bg-[#222222] text-[#5E6AD2] text-sm font-bold flex items-center justify-center transition-colors">−</button>
                <span className="text-[11px] text-[#5E6AD2] font-medium min-w-[40px] text-center" style={{ fontFamily: "'Roboto Mono', monospace" }}>{zoom}%</span>
                <button onClick={() => setZoom(z => Math.min(200, z + zoomStep))} className="w-7 h-7 rounded bg-[#1A1A1A] hover:bg-[#222222] text-[#5E6AD2] text-sm font-bold flex items-center justify-center transition-colors">+</button>
                <button onClick={() => setZoom(100)} className="ml-1 text-[10px] text-[#666666] hover:text-white transition-colors">reset</button>
            </div>
            <div className="px-4 py-6 space-y-6 flex flex-col items-center flex-1">
                {pageImgs.map((p) => (
                    <div key={p.pageNum} className="relative mx-auto bg-[#111111] rounded-xl shadow-2xl shadow-black/50" style={{ width: `${(zoom / 100) * 100}%`, maxWidth: '100%' }}>
                        <img src={p.url} alt={`Página ${p.pageNum}`} className="w-full object-contain rounded-lg block" draggable={false} style={{ imageRendering: 'auto' }} loading="lazy" />
                        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-black/80 border border-[#5E6AD2]/25 rounded px-2 py-1" style={{ fontFamily: "'Roboto Mono', monospace" }}>
                            <span className="text-[8px] text-[#666666]">N°</span>
                            <span className="text-[10px] font-medium text-[#5E6AD2] tracking-widest">{pad(desde + p.pageNum - 1, padLen)}</span>
                        </div>
                    </div>
                ))}
                {renderingPage > 0 && (
                    <div className="flex items-center gap-2.5 py-4 text-[#666666]">
                        <RefreshCw size={11} className="animate-spin text-[#5E6AD2]/40 flex-shrink-0" />
                        <span className="text-[10px] tracking-widest" style={{ fontFamily: "'Roboto Mono', monospace" }}>renderizando {renderingPage} / {previewCount}…</span>
                    </div>
                )}
                {isCapped && renderingPage === 0 && pageImgs.length > 0 && (
                    <div className="w-full border border-[#5E6AD2]/10 bg-[#5E6AD2]/[0.03] rounded-md px-4 py-3 text-center">
                        <p className="text-[10px] text-[#5E6AD2]/50 tracking-wider" style={{ fontFamily: "'Roboto Mono', monospace" }}>vista previa: {MAX_PREVIEW_PAGES} de {total} páginas</p>
                    </div>
                )}
                <div className="h-2" />
            </div>
        </div>
    );
}

/* ─── Empty / Loading State ──────────────────────────────────── */
function EmptyPreview({ loading }: { loading: boolean }) {
    return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-[#666666]">
            {loading ? (
                <>
                    <Loader2 size={22} className="animate-spin text-[#5E6AD2]/40" />
                    <span className="text-[11px] tracking-widest" style={{ fontFamily: "'Roboto Mono', monospace" }}>cargando formatos…</span>
                </>
            ) : (
                <>
                    <div className="w-20 h-20 border border-[#1A1A1A] rounded-lg flex items-center justify-center">
                        <ScanLine size={28} className="text-[#444444]" />
                    </div>
                    <span className="text-[11px] tracking-widest text-[#666666]" style={{ fontFamily: "'Roboto Mono', monospace" }}>sin vista previa</span>
                </>
            )}
        </div>
    );
}

/* ─── Mapping Editor Panel ───────────────────────────────────── */
function MappingEditor({ mapping, onChange, onSave, onCancel }: {
    mapping: VisualMapping;
    onChange: (m: VisualMapping) => void;
    onSave: () => void;
    onCancel: () => void;
}) {
    const set = (key: keyof VisualMapping, value: number | string) => {
        onChange({ ...mapping, [key]: value });
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] tracking-[0.25em] uppercase text-[#5E6AD2]" style={{ fontFamily: "'Roboto Mono', monospace" }}>
                    <Move size={10} className="inline mr-1.5" />Mapping Visual
                </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
                {[
                    { label: 'X (pts)', key: 'x' as const, step: 1 },
                    { label: 'Y (pts)', key: 'y' as const, step: 1 },
                    { label: 'Ancho', key: 'width' as const, step: 5 },
                    { label: 'Alto', key: 'height' as const, step: 5 },
                    { label: 'Font Size', key: 'font_size' as const, step: 0.5 },
                    { label: 'Padding', key: 'padding' as const, step: 1 },
                    { label: 'Página', key: 'page' as const, step: 1 },
                ].map(({ label, key, step }) => (
                    <div key={key}>
                        <div className="text-[8px] text-[#666666] tracking-widest mb-1" style={{ fontFamily: "'Roboto Mono', monospace" }}>{label}</div>
                        <input
                            type="number"
                            step={step}
                            value={mapping[key] as number}
                            onChange={e => set(key, parseFloat(e.target.value) || 0)}
                            className="w-full bg-[#0A0A0A] border border-[#222222] hover:border-[#333333] focus:border-[#5E6AD2]/40 rounded px-2 py-1.5 text-white text-[11px] focus:outline-none transition-colors"
                            style={{ fontFamily: "'Roboto Mono', monospace" }}
                        />
                    </div>
                ))}
                <div>
                    <div className="text-[8px] text-[#666666] tracking-widest mb-1" style={{ fontFamily: "'Roboto Mono', monospace" }}>Fuente</div>
                    <select
                        value={mapping.font_name}
                        onChange={e => set('font_name', e.target.value)}
                        className="w-full bg-[#0A0A0A] border border-[#222222] hover:border-[#333333] focus:border-[#5E6AD2]/40 rounded px-2 py-1.5 text-white text-[11px] focus:outline-none transition-colors"
                        style={{ fontFamily: "'Roboto Mono', monospace" }}
                    >
                        <option value="Courier-Bold">Courier-Bold</option>
                        <option value="Courier">Courier</option>
                        <option value="Helvetica-Bold">Helvetica-Bold</option>
                        <option value="Helvetica">Helvetica</option>
                    </select>
                </div>
            </div>

            {/* Color */}
            <div>
                <div className="text-[8px] text-[#666666] tracking-widest mb-1" style={{ fontFamily: "'Roboto Mono', monospace" }}>Color (R, G, B: 0-1)</div>
                <div className="grid grid-cols-3 gap-2">
                    {(['color_r', 'color_g', 'color_b'] as const).map(k => (
                        <input
                            key={k}
                            type="number" min={0} max={1} step={0.1}
                            value={mapping[k]}
                            onChange={e => set(k, parseFloat(e.target.value) || 0)}
                            className="w-full bg-[#0A0A0A] border border-[#222222] hover:border-[#333333] focus:border-[#5E6AD2]/40 rounded px-2 py-1.5 text-white text-[11px] focus:outline-none transition-colors"
                            style={{ fontFamily: "'Roboto Mono', monospace" }}
                        />
                    ))}
                </div>
            </div>

            {/* Preview of number */}
            <div className="border border-[#1A1A1A] bg-[#141414] rounded-md p-3 text-center">
                <span className="text-[9px] text-[#666666] block mb-1" style={{ fontFamily: "'Roboto Mono', monospace" }}>Ejemplo</span>
                <span
                    className="tracking-widest font-bold"
                    style={{
                        fontFamily: "'Roboto Mono', monospace",
                        fontSize: `${Math.min(mapping.font_size * 1.2, 24)}px`,
                        color: `rgb(${mapping.color_r * 255}, ${mapping.color_g * 255}, ${mapping.color_b * 255})`,
                    }}
                >
                    {pad(1234, mapping.padding)}
                </span>
            </div>

            <div className="flex gap-2">
                <button
                    onClick={onSave}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-[#5E6AD2]/10 hover:bg-[#5E6AD2]/20 border border-[#5E6AD2]/30 text-[#5E6AD2] rounded-md py-2 text-[10px] tracking-wider transition-colors"
                    style={{ fontFamily: "'Roboto Mono', monospace" }}
                >
                    <Check size={11} />Guardar
                </button>
                <button
                    onClick={onCancel}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-[#141414] hover:bg-[#1A1A1A] border border-[#1A1A1A] text-[#A0A0A0] hover:text-white rounded-md py-2 text-[10px] tracking-wider transition-colors"
                    style={{ fontFamily: "'Roboto Mono', monospace" }}
                >
                    <X size={11} />Cancelar
                </button>
            </div>
        </div>
    );
}

/* ─── Upload Modal ───────────────────────────────────────────── */
function UploadModal({ onClose, onUploaded }: { onClose: () => void; onUploaded: (f: FormatInfo) => void }) {
    const [file, setFile] = useState<File | null>(null);
    const [nombre, setNombre] = useState('');
    const [persisted, setPersisted] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleUpload = async () => {
        if (!file || !nombre.trim()) return;
        setUploading(true);
        setError(null);
        try {
            const arrayBuffer = await file.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            // Chunked base64 encode to avoid stack overflow on large PDFs
            let binary = '';
            for (let i = 0; i < bytes.length; i += 65536) {
                binary += String.fromCharCode(...bytes.subarray(i, i + 65536));
            }
            const content_b64 = btoa(binary);
            const res = await api.formatosUpload({
                nombre: nombre.trim(),
                filename: file.name,
                content_b64,
                persisted,
            });
            onUploaded(res.format);
            onClose();
        } catch (e: any) {
            setError(e?.message ?? 'Error al subir');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-[#111111] border border-[#1A1A1A] rounded-xl w-[380px] p-6 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Subir Formato PDF</h3>
                    <button onClick={onClose} className="text-[#666666] hover:text-white transition-colors"><X size={16} /></button>
                </div>

                <div>
                    <label className="text-[9px] text-[#666666] tracking-widest uppercase block mb-1.5" style={{ fontFamily: "'Roboto Mono', monospace" }}>Nombre</label>
                    <input
                        type="text"
                        value={nombre}
                        onChange={e => setNombre(e.target.value)}
                        placeholder="Ej: Formato Inspección"
                        className="w-full bg-[#0A0A0A] border border-[#222222] hover:border-[#333333] focus:border-[#5E6AD2]/40 rounded-md px-3 py-2.5 text-white text-sm focus:outline-none transition-colors"
                    />
                </div>

                <div>
                    <label className="text-[9px] text-[#666666] tracking-widest uppercase block mb-1.5" style={{ fontFamily: "'Roboto Mono', monospace" }}>Archivo PDF</label>
                    <label className="flex items-center gap-2.5 cursor-pointer bg-[#141414] border border-dashed border-[#333333] hover:border-[#5E6AD2]/30 rounded-md px-3 py-3 transition-colors">
                        <Upload size={14} className="text-[#666666]" />
                        <span className="text-[11px] text-[#A0A0A0] truncate" style={{ fontFamily: "'Roboto Mono', monospace" }}>
                            {file ? file.name : 'Seleccionar archivo…'}
                        </span>
                        <input type="file" accept=".pdf" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
                    </label>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setPersisted(!persisted)}
                        className={`relative w-9 h-5 rounded-full transition-colors ${persisted ? 'bg-[#5E6AD2]' : 'bg-[#333333]'}`}
                    >
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${persisted ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                    <span className="text-[11px] text-[#A0A0A0]" style={{ fontFamily: "'Roboto Mono', monospace" }}>
                        {persisted ? 'Persistente' : 'Temporal (se pierde al cerrar)'}
                    </span>
                </div>

                {error && (
                    <div className="flex items-start gap-2 bg-red-950/30 border border-red-900/40 rounded-md p-2.5">
                        <AlertCircle size={11} className="text-red-400 mt-0.5 flex-shrink-0" />
                        <p className="text-[11px] text-red-400" style={{ fontFamily: "'Roboto Mono', monospace" }}>{error}</p>
                    </div>
                )}

                <button
                    onClick={handleUpload}
                    disabled={!file || !nombre.trim() || uploading}
                    className="w-full flex items-center justify-center gap-2 bg-[#5E6AD2]/10 hover:bg-[#5E6AD2]/20 border border-[#5E6AD2]/30 text-[#5E6AD2] disabled:opacity-30 disabled:pointer-events-none rounded-lg py-2.5 text-[11px] tracking-wider transition-colors"
                    style={{ fontFamily: "'Roboto Mono', monospace" }}
                >
                    {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                    {uploading ? 'Subiendo…' : 'Subir Formato'}
                </button>
            </div>
        </div>
    );
}

/* ─── Row utility ────────────────────────────────────────────── */
function Row({ label, value, valueClass = 'text-white' }: { label: string; value: string; valueClass?: string }) {
    return (
        <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[10px] text-[#666666]" style={{ fontFamily: "'Roboto Mono', monospace" }}>{label}</span>
            <span className={`text-[10px] font-medium ${valueClass}`} style={{ fontFamily: "'Roboto Mono', monospace" }}>{value}</span>
        </div>
    );
}

/* ─── Main App ───────────────────────────────────────────────── */
export default function FormatosView() {
    const { addToast } = useToast();
    const { confirm } = useDialog();
    const [formats, setFormats] = useState<FormatInfo[]>([]);
    const [loadingFormats, setLoadingFormats] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [desde, setDesde] = useState<number>(1);
    const [hasta, setHasta] = useState<number>(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewDesde, setPreviewDesde] = useState<number>(1);
    const [previewTotal, setPreviewTotal] = useState<number>(0);
    const previewAbort = useRef(false);

    const [showUpload, setShowUpload] = useState(false);
    const [mappingMode, setMappingMode] = useState(false);
    const [editMapping, setEditMapping] = useState<VisualMapping | null>(null);

    const selected = formats.find(f => f.id === selectedId) ?? null;
    const padLen = selected?.mapping?.padding ?? 7;
    const maxPages = selected?.max_pages ?? 500;
    const numMin = selected?.number_min ?? 1;
    const numMax = selected?.number_max ?? 9999999;
    const total = Math.max(0, hasta - desde + 1);
    const isValid = selected !== null && desde >= numMin && hasta >= desde && total <= maxPages && hasta <= numMax;
    const canGenerate = isValid && (selected?.strategy === 'legacy_xobject' || selected?.strategy === 'simple_overlay' || selected?.has_mapping);

    /* ── Load formats ── */
    const fetchFormats = useCallback(async () => {
        setLoadingFormats(true);
        try {
            const res = await api.formatosList();
            setFormats(res.formats);
            if (res.formats.length > 0 && !selectedId) {
                setSelectedId(res.formats[0].id);
            }
        } catch (err: any) {
            addToast({ message: 'Error cargando formatos: ' + (err?.message || String(err)), type: 'error' });
        } finally {
            setLoadingFormats(false);
        }
    }, [addToast, selectedId]);

    useEffect(() => { fetchFormats(); }, [fetchFormats]);

    /* ── Auto-preview on desde/hasta/format change ── */
    useEffect(() => {
        if (!selected || !canGenerate) { setPreviewBlob(null); setPreviewLoading(false); return; }
        const capturedDesde = desde;
        const capturedHasta = hasta;
        const capturedTotal = capturedHasta - capturedDesde + 1;
        const previewHasta = Math.min(capturedHasta, capturedDesde + MAX_PREVIEW_PAGES - 1);
        previewAbort.current = false;

        const t = setTimeout(async () => {
            if (previewAbort.current) return;
            if (capturedDesde < numMin || capturedHasta < capturedDesde) return;
            setPreviewLoading(true);
            setError(null);
            try {
                const res = await api.formatosGenerate({
                    format_id: selected.id,
                    desde: capturedDesde,
                    hasta: previewHasta,
                });
                if (previewAbort.current) return;
                const binary = Uint8Array.from(atob(res.pdf_base64), c => c.charCodeAt(0));
                const blob = new Blob([binary], { type: 'application/pdf' });
                setPreviewBlob(blob);
                setPreviewDesde(capturedDesde);
                setPreviewTotal(capturedTotal);
            } catch (err: any) {
                const msg = err?.message || String(err);
                console.warn('Preview error:', msg);
                if (!previewAbort.current) {
                    setError('Error en vista previa: ' + msg);
                }
            } finally {
                if (!previewAbort.current) setPreviewLoading(false);
            }
        }, PREVIEW_DEBOUNCE_MS);
        return () => {
            clearTimeout(t);
            previewAbort.current = true;
        };
    }, [desde, hasta, selectedId, selected?.has_mapping, selected?.strategy]);

    /* ── Download handler ── */
    const handleGenerate = async () => {
        if (!canGenerate || !selected) return;
        setLoading(true);
        setError(null);
        try {
            const res = await api.formatosGenerate({
                format_id: selected.id,
                desde,
                hasta,
            });
            const blob = new Blob([Uint8Array.from(atob(res.pdf_base64), c => c.charCodeAt(0))], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const p = selected.mapping?.padding ?? 7;
            const desdeS = pad(desde, p);
            const hastaS = pad(hasta, p);
            a.download = desde === hasta
                ? `${selected.id}_${desdeS}.pdf`
                : `${selected.id}_${desdeS}-${hastaS}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
            addToast({ message: 'PDF generado correctamente', type: 'success' });
            await saveToHistory('formato', selected.nombre, { format_id: selected.id, desde, hasta }, hasta - desde + 1);
        } catch (e: any) {
            const msg = e?.message || String(e);
            setError(msg);
            addToast({ message: 'Error generando PDF: ' + msg, type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    /* ── Delete handler ── */
    const handleDelete = async (fid: string) => {
        const ok = await confirm({
            title: '¿Eliminar este formato?',
            description: 'Esta acción quitará el formato de la lista disponible.',
            type: 'destructive',
            confirmLabel: 'Eliminar',
        });
        if (!ok) return;

        try {
            await api.formatosDelete(fid);
            setFormats(prev => prev.filter(f => f.id !== fid));
            if (selectedId === fid) {
                setSelectedId(formats.find(f => f.id !== fid)?.id ?? null);
            }
            addToast({ message: 'Formato eliminado', type: 'success' });
        } catch (e: any) {
            addToast({ message: 'Error eliminando: ' + (e?.message || String(e)), type: 'error' });
        }
    };

    /* ── Save mapping ── */
    const handleSaveMapping = async () => {
        if (!selected || !editMapping) return;
        try {
            const res = await api.formatosUpdateMapping(selected.id, editMapping);
            setFormats(prev => prev.map(f => f.id === selected.id ? res.format : f));
            setMappingMode(false);
            setEditMapping(null);
            addToast({ message: 'Mapping guardado', type: 'success' });
        } catch (e: any) {
            addToast({ message: 'Error guardando mapping: ' + (e?.message || String(e)), type: 'error' });
        }
    };

    /* ── Upload callback ── */
    const handleUploaded = (f: FormatInfo) => {
        setFormats(prev => [...prev, f]);
        setSelectedId(f.id);
    };

    const previewPagesShown = Math.min(previewTotal, MAX_PREVIEW_PAGES);
    const isCapped = previewTotal > MAX_PREVIEW_PAGES;

    return (
        <div className="flex overflow-hidden bg-[#0A0A0A] text-white" style={{ height: 'calc(100vh - 0px)', fontFamily: "'Outfit', sans-serif" }}>
            {/* ── LEFT: PREVIEW ─────────────────────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0 relative">
                <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)', backgroundSize: '28px 28px' }} />

                {/* topbar */}
                <div className="relative z-10 flex items-center justify-between px-6 py-3 border-b border-[#1A1A1A]">
                    <div className="flex items-center gap-2.5">
                        <ScanLine size={13} className="text-[#5E6AD2]" />
                        <span className="text-[10px] tracking-[0.22em] uppercase text-[#666666]" style={{ fontFamily: "'Roboto Mono', monospace" }}>Vista Previa</span>
                    </div>
                    <div className="flex items-center gap-3">
                        {previewBlob && previewPagesShown > 0 && (
                            <div className="flex items-center gap-1.5 border border-[#1A1A1A] rounded px-2.5 py-1 bg-[#141414]" style={{ fontFamily: "'Roboto Mono', monospace" }}>
                                <span className="text-[9px] tracking-wider text-[#666666]">N°</span>
                                <span className="text-[10px] font-medium text-white tracking-wider">
                                    {pad(previewDesde, padLen)}
                                    {previewTotal > 1 ? ` → ${pad(previewDesde + previewTotal - 1, padLen)}` : ''}
                                </span>
                            </div>
                        )}
                        {previewLoading && (
                            <div className="flex items-center gap-1.5">
                                <RefreshCw size={9} className="animate-spin text-[#5E6AD2]/40" />
                                <span className="text-[9px] tracking-wider text-[#666666]" style={{ fontFamily: "'Roboto Mono', monospace" }}>actualizando…</span>
                            </div>
                        )}
                        {previewBlob && previewPagesShown > 0 && (
                            <div className="flex items-center gap-1.5 border border-[#5E6AD2]/25 rounded px-2.5 py-1 bg-[#5E6AD2]/[0.04]" style={{ fontFamily: "'Roboto Mono', monospace" }}>
                                <Layers size={9} className="text-[#5E6AD2]/60" />
                                <span className="text-[10px] font-medium text-[#5E6AD2] tracking-wider">
                                    {isCapped ? `${MAX_PREVIEW_PAGES} / ${previewTotal}` : previewPagesShown} {previewPagesShown === 1 ? 'pág.' : 'págs.'}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* viewer area */}
                <div className="relative flex-1 overflow-hidden">
                    {previewBlob ? (
                        <PdfMultiViewer blob={previewBlob} desde={previewDesde} total={previewTotal} padLen={padLen} />
                    ) : (
                        <EmptyPreview loading={previewLoading || loadingFormats} />
                    )}
                </div>
            </div>

            {/* ── RIGHT: SIDEBAR ────────────────────────────────────── */}
            <div className="w-[320px] flex-shrink-0 flex flex-col border-l border-[#1A1A1A] bg-[#0A0A0A]">
                {/* brand header */}
                <div className="px-6 pt-7 pb-5 border-b border-[#1A1A1A]">
                    <h1 className="text-[22px] font-semibold tracking-tight text-white leading-none">Formatos</h1>
                    <p className="text-[11px] text-[#666666] mt-1.5">Generador de PDFs con correlativo</p>
                </div>

                {/* scrollable config */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

                    {/* ─ Format Selector ─ */}
                    <section>
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-[9px] tracking-[0.25em] uppercase text-[#666666]" style={{ fontFamily: "'Roboto Mono', monospace" }}>Formato</p>
                            <button
                                onClick={() => setShowUpload(true)}
                                className="flex items-center gap-1 text-[9px] text-[#5E6AD2]/60 hover:text-[#5E6AD2] transition-colors"
                                style={{ fontFamily: "'Roboto Mono', monospace" }}
                            >
                                <Plus size={10} />subir
                            </button>
                        </div>
                        <div className="space-y-1.5">
                            {formats.map(f => (
                                <button
                                    key={f.id}
                                    onClick={() => { setSelectedId(f.id); setMappingMode(false); setEditMapping(null); }}
                                    className={`w-full flex items-center gap-2.5 rounded-md px-3 py-2.5 transition-colors group text-left ${f.id === selectedId
                                            ? 'bg-[#5E6AD2]/[0.08] border border-[#5E6AD2]/25'
                                            : 'bg-[#141414] border border-[#1A1A1A] hover:border-[#333333]'
                                        }`}
                                >
                                    <FileText size={13} className={f.id === selectedId ? 'text-[#5E6AD2]' : 'text-[#666666]'} />
                                    <div className="flex-1 min-w-0">
                                        <div className={`text-[11px] font-medium truncate ${f.id === selectedId ? 'text-[#5E6AD2]' : 'text-white'}`}>{f.nombre}</div>
                                        <div className="text-[8px] text-[#666666] tracking-widest uppercase" style={{ fontFamily: "'Roboto Mono', monospace" }}>
                                            {f.origen}{!f.has_mapping && f.strategy === 'visual_overlay' ? ' · sin mapping' : ''}
                                        </div>
                                    </div>
                                    {f.origen === 'uploaded' && (
                                        <button
                                            onClick={e => { e.stopPropagation(); handleDelete(f.id); }}
                                            className="opacity-0 group-hover:opacity-100 text-[#666666] hover:text-red-400 transition-all"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    )}
                                </button>
                            ))}
                            {formats.length === 0 && !loadingFormats && (
                                <div className="text-center text-[10px] text-[#666666] py-4" style={{ fontFamily: "'Roboto Mono', monospace" }}>Sin formatos</div>
                            )}
                        </div>
                    </section>

                    <div className="border-t border-[#1A1A1A]" />

                    {/* ─ Mapping Mode Toggle ─ */}
                    {selected && (selected.strategy === 'visual_overlay' || selected.strategy === 'simple_overlay') && (
                        <>
                            <section>
                                <button
                                    onClick={() => {
                                        if (mappingMode) {
                                            setMappingMode(false);
                                            setEditMapping(null);
                                        } else {
                                            setMappingMode(true);
                                            setEditMapping(selected.mapping ? { ...selected.mapping } : { ...SIMPLE_OVERLAY_DEFAULT_MAPPING });
                                        }
                                    }}
                                    className="w-full flex items-center justify-between gap-2 bg-[#141414] hover:bg-[#1A1A1A] border border-[#1A1A1A] rounded-md px-3 py-2.5 transition-colors"
                                >
                                    <div className="flex items-center gap-2">
                                        {mappingMode ? <Eye size={13} className="text-[#5E6AD2]" /> : <Settings2 size={13} className="text-[#666666]" />}
                                        <span className="text-[10px] tracking-wider text-[#A0A0A0]" style={{ fontFamily: "'Roboto Mono', monospace" }}>
                                            {mappingMode ? 'Editando mapping' : selected.strategy === 'simple_overlay' ? 'Personalizar posición' : 'Configurar mapping'}
                                        </span>
                                    </div>
                                    {!selected.has_mapping && selected.strategy === 'visual_overlay' && (
                                        <span className="text-[8px] text-red-400 tracking-wider" style={{ fontFamily: "'Roboto Mono', monospace" }}>requerido</span>
                                    )}
                                    {selected.strategy === 'simple_overlay' && (
                                        <span className="text-[8px] text-[#5E6AD2]/50 tracking-wider" style={{ fontFamily: "'Roboto Mono', monospace" }}>opcional</span>
                                    )}
                                </button>
                            </section>

                            {mappingMode && editMapping && (
                                <MappingEditor
                                    mapping={editMapping}
                                    onChange={setEditMapping}
                                    onSave={handleSaveMapping}
                                    onCancel={() => { setMappingMode(false); setEditMapping(null); }}
                                />
                            )}

                            <div className="border-t border-[#1A1A1A]" />
                        </>
                    )}

                    {/* ─ Rango ─ */}
                    {selected && !mappingMode && (
                        <section>
                            <p className="text-[9px] tracking-[0.25em] uppercase text-[#666666] mb-3" style={{ fontFamily: "'Roboto Mono', monospace" }}>Rango de números</p>
                            <div className="space-y-2.5">
                                <div>
                                    <div className="text-[9px] text-[#666666] tracking-widest mb-1.5" style={{ fontFamily: "'Roboto Mono', monospace" }}>DESDE</div>
                                    <div className="relative">
                                        <input
                                            type="number" min={numMin} max={numMax}
                                            value={desde}
                                            onChange={e => setDesde(Math.max(numMin, parseInt(e.target.value) || numMin))}
                                            className="w-full bg-[#0A0A0A] border border-[#222222] hover:border-[#333333] focus:border-[#5E6AD2]/40 rounded-md px-3 py-2.5 text-white text-sm focus:outline-none transition-colors pr-24"
                                            style={{ fontFamily: "'Roboto Mono', monospace" }}
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#5E6AD2]/50 tracking-wider pointer-events-none" style={{ fontFamily: "'Roboto Mono', monospace" }}>{pad(desde, padLen)}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 px-1">
                                    <div className="flex-1 h-px bg-[#1A1A1A]" />
                                    <ChevronRight size={10} className="text-[#666666]" />
                                    <div className="flex-1 h-px bg-[#1A1A1A]" />
                                </div>
                                <div>
                                    <div className="text-[9px] text-[#666666] tracking-widest mb-1.5" style={{ fontFamily: "'Roboto Mono', monospace" }}>HASTA</div>
                                    <div className="relative">
                                        <input
                                            type="number" min={desde} max={numMax}
                                            value={hasta}
                                            onChange={e => setHasta(Math.max(desde, parseInt(e.target.value) || desde))}
                                            className="w-full bg-[#0A0A0A] border border-[#222222] hover:border-[#333333] focus:border-[#5E6AD2]/40 rounded-md px-3 py-2.5 text-white text-sm focus:outline-none transition-colors pr-24"
                                            style={{ fontFamily: "'Roboto Mono', monospace" }}
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#5E6AD2]/50 tracking-wider pointer-events-none" style={{ fontFamily: "'Roboto Mono', monospace" }}>{pad(hasta, padLen)}</span>
                                    </div>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* ─ Resumen ─ */}
                    {selected && !mappingMode && (
                        <>
                            <div className="border-t border-[#1A1A1A]" />
                            <section>
                                <p className="text-[9px] tracking-[0.25em] uppercase text-[#666666] mb-3" style={{ fontFamily: "'Roboto Mono', monospace" }}>Resumen</p>
                                <div className="rounded-md border border-[#1A1A1A] bg-[#141414] divide-y divide-[#1A1A1A]">
                                    <Row label="Formato" value={selected.nombre} />
                                    <Row label="Tipo" value={total === 1 ? 'Individual' : 'Consolidado'} />
                                    <Row label="Páginas" value={total > maxPages ? `${total} ✗` : String(total)} valueClass={total > maxPages ? 'text-red-400' : 'text-[#5E6AD2]'} />
                                    <Row label="Correlativo" value={total > 1 ? `${pad(desde, padLen)} → ${pad(hasta, padLen)}` : pad(desde, padLen)} />
                                    {total > maxPages && <Row label="Límite" value={`máx. ${maxPages}`} valueClass="text-red-400/70" />}
                                    {!canGenerate && selected.strategy === 'visual_overlay' && (
                                        <Row label="Estado" value="Mapping requerido" valueClass="text-red-400" />
                                    )}
                                </div>
                            </section>
                        </>
                    )}

                    {/* ─ Error ─ */}
                    {error && (
                        <div className="flex items-start gap-2 bg-red-950/30 border border-red-900/40 rounded-md p-3">
                            <AlertCircle size={11} className="text-red-400 mt-0.5 flex-shrink-0" />
                            <p className="text-[11px] text-red-400 leading-relaxed" style={{ fontFamily: "'Roboto Mono', monospace" }}>{error}</p>
                        </div>
                    )}
                </div>

                {/* ─ Footer / Generate ─ */}
                {!mappingMode && (
                    <div className="px-6 pb-6 pt-4 border-t border-[#1A1A1A] space-y-3">
                        <button
                            onClick={handleGenerate}
                            disabled={loading || !canGenerate}
                            className="w-full flex items-center justify-between gap-2 bg-[#5E6AD2] hover:opacity-90 border border-[#5E6AD2] text-white disabled:opacity-30 disabled:pointer-events-none font-medium rounded-lg py-3 px-4 transition-colors text-sm group"
                            style={{ fontFamily: "'Roboto Mono', monospace" }}
                        >
                            <div className="flex items-center gap-2">
                                {loading ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
                                <span className="text-[11px] tracking-wider">
                                    {loading ? 'Generando…' : total <= 1 ? 'Generar PDF' : `Generar ${total} páginas`}
                                </span>
                            </div>
                            {!loading && <ChevronRight size={12} className="opacity-40 group-hover:opacity-80 transition-opacity" />}
                        </button>
                        <p className="text-center text-[9px] tracking-[0.2em] text-[#666666] uppercase" style={{ fontFamily: "'Roboto Mono', monospace" }}>
                            máx. {maxPages} páginas / descarga
                        </p>
                    </div>
                )}
            </div>

            {/* Upload Modal */}
            {showUpload && <UploadModal onClose={() => setShowUpload(false)} onUploaded={handleUploaded} />}
        </div>
    );
}
