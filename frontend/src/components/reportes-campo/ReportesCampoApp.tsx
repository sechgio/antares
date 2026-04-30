import './rcampo-styles.css';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Camera,
    ChevronLeft,
    ChevronRight,
    Droplet,
    PaintBucket,
} from 'lucide-react';
import SheetPreview from './components/SheetPreview';
import HeaderForm from './components/HeaderForm';
import PhotoManager from './components/PhotoManager';
import { useToast } from '../../hooks/useToast';
import type { HeaderMap, LogoData, PhotoFile, ReportType } from './types';
import { chunkArray, CHUNK_SIZE, getReportConfig, getDefaultHeader, REPORT_TYPES } from './constants';
import { exportReportPdf } from './utils/export';

const TYPE_ICONS: Record<string, React.ReactNode> = {
    camera: <Camera size={14} />,
    droplet: <Droplet size={14} />,
    bucket: <PaintBucket size={14} />,
};

const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 400;
const DEFAULT_SIDEBAR_WIDTH = 264;

export default function ReportesCampoApp() {
    const { addToast } = useToast();
    const [reportType, setReportType] = useState<ReportType>('panel-fotografico');
    const config = getReportConfig(reportType);

    const [header, setHeader] = useState<HeaderMap>(() => getDefaultHeader(config));
    const [photos, setPhotos] = useState<PhotoFile[]>([]);
    const [logoLeft, setLogoLeft] = useState<LogoData | null>(null);
    const [logoRight, setLogoRight] = useState<LogoData | null>(null);
    const [currentPage, setCurrentPage] = useState(0);
    const [isExporting, setIsExporting] = useState(false);
    const [isDraggingImages, setIsDraggingImages] = useState(false);

    // Sidebar resize state
    const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
    const [isResizing, setIsResizing] = useState(false);
    const startXRef = useRef(0);
    const startWidthRef = useRef(0);

    const chunks = chunkArray(photos, CHUNK_SIZE);
    const previewChunks = chunks.length > 0 ? chunks : [[]];
    const totalPages = previewChunks.length;
    const currentChunk = previewChunks[currentPage] ?? [];

    // Reset header when report type changes
    useEffect(() => {
        const newConfig = getReportConfig(reportType);
        setHeader(getDefaultHeader(newConfig));
        setCurrentPage(0);
    }, [reportType]);

    const handleFieldChange = useCallback((key: string, value: string) => {
        setHeader((prev) => ({ ...prev, [key]: value }));
    }, []);

    const handleLogoChange = useCallback((side: 'left' | 'right', files: FileList | null) => {
        if (!files?.[0]) return;
        const file = files[0];
        const url = URL.createObjectURL(file);
        if (side === 'left') setLogoLeft({ file, url });
        else setLogoRight({ file, url });
    }, []);

    const handleLogoRemove = useCallback((side: 'left' | 'right') => {
        if (side === 'left') {
            if (logoLeft) URL.revokeObjectURL(logoLeft.url);
            setLogoLeft(null);
        } else {
            if (logoRight) URL.revokeObjectURL(logoRight.url);
            setLogoRight(null);
        }
    }, [logoLeft, logoRight]);

    const handleImagesAdd = useCallback((files: FileList | null) => {
        if (!files) return;
        const newPhotos: PhotoFile[] = Array.from(files).map((file) => ({
            id: `${Date.now()}-${Math.random()}`,
            file,
            previewUrl: URL.createObjectURL(file),
        }));
        setPhotos((prev) => [...prev, ...newPhotos]);
    }, []);

    const handleClearPhotos = useCallback(() => {
        photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
        setPhotos([]);
        setCurrentPage(0);
    }, [photos]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDraggingImages(true);
    }, []);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDraggingImages(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDraggingImages(false);
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setIsDraggingImages(false);
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleImagesAdd(e.dataTransfer.files);
            }
        },
        [handleImagesAdd],
    );

    const handleExport = useCallback(async () => {
        if (photos.length === 0) {
            addToast({ message: 'Agrega al menos una imagen antes de exportar.', type: 'error' });
            return;
        }
        setIsExporting(true);
        try {
            await exportReportPdf(config, header, photos, logoLeft, logoRight);
            addToast({ message: 'PDF exportado exitosamente.', type: 'success' });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Error al generar el PDF.';
            addToast({ message, type: 'error' });
        } finally {
            setIsExporting(false);
        }
    }, [addToast, config, header, photos, logoLeft, logoRight]);

    // Sidebar resize handlers
    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
        startXRef.current = e.clientX;
        startWidthRef.current = sidebarWidth;
    }, [sidebarWidth]);

    const handleResizeMove = useCallback((e: MouseEvent) => {
        if (!isResizing) return;
        const delta = e.clientX - startXRef.current;
        const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, startWidthRef.current + delta));
        setSidebarWidth(newWidth);
    }, [isResizing]);

    const handleResizeEnd = useCallback(() => {
        setIsResizing(false);
    }, []);

    // Global mouse events for resize
    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', handleResizeMove);
            window.addEventListener('mouseup', handleResizeEnd);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        } else {
            window.removeEventListener('mousemove', handleResizeMove);
            window.removeEventListener('mouseup', handleResizeEnd);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
        return () => {
            window.removeEventListener('mousemove', handleResizeMove);
            window.removeEventListener('mouseup', handleResizeEnd);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [isResizing, handleResizeMove, handleResizeEnd]);

    // Ctrl+Enter to export
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                if (photos.length > 0 && !isExporting) {
                    handleExport();
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [photos.length, isExporting, handleExport]);

    return (
        <div className="rcampo-app">
            {/* ── HEADER / TOOLBAR ── */}
            <header className="rcampo-header">
                <div className="rcampo-brand">
                    <div className="rcampo-brand-icon">
                        <Camera size={16} />
                    </div>
                    <h1>Paneles</h1>
                </div>

                <div className="rcampo-type-pills">
                    {REPORT_TYPES.map((rt) => (
                        <button
                            key={rt.id}
                            className={`rcampo-type-pill ${reportType === rt.id ? 'active' : ''}`}
                            onClick={() => setReportType(rt.id)}
                        >
                            {TYPE_ICONS[rt.icon]}
                            {rt.shortLabel}
                        </button>
                    ))}
                </div>

                <div className="rcampo-header-actions">
                    <span className="rcampo-page-badge">
                        {totalPages > 0
                            ? `Hoja ${currentPage + 1} / ${totalPages}`
                            : 'Sin hojas'}
                    </span>
                    {totalPages > 1 && (
                        <>
                            <button
                                className="rcampo-nav-btn"
                                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                                disabled={currentPage === 0}
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <button
                                className="rcampo-nav-btn"
                                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                                disabled={currentPage === totalPages - 1}
                            >
                                <ChevronRight size={16} />
                            </button>
                        </>
                    )}
                </div>
            </header>

            {/* ── WORKSPACE ── */}
            <div className="rcampo-workspace">
                {/* ── SIDEBAR ── */}
                <aside className="rcampo-sidebar" style={{ width: sidebarWidth }}>
                    <div className="rcampo-sidebar-scroll">
                        <div
                            className={`sash-module_sash__K-9lB sash-vertical sash-module_vertical__pB-rs ${isResizing ? 'sash-active' : ''}`}
                            onMouseDown={handleResizeStart}
                        />
                        <HeaderForm
                            config={config}
                            fields={config.fields}
                            header={header}
                            onFieldChange={handleFieldChange}
                            logoLeft={logoLeft}
                            logoRight={logoRight}
                            onLogoChange={handleLogoChange}
                            onLogoRemove={handleLogoRemove}
                        />

                        <PhotoManager
                            photos={photos}
                            onAdd={handleImagesAdd}
                            onClear={handleClearPhotos}
                            totalPages={totalPages}
                            isDragging={isDraggingImages}
                            isExporting={isExporting}
                            onExport={handleExport}
                            onDragOver={handleDragOver}
                            onDragEnter={handleDragEnter}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                        />
                    </div>
                </aside>

                {/* ── CANVAS ── */}
                <section className="rcampo-canvas">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={`${reportType}-${currentPage}`}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.2 }}
                            style={{ transformOrigin: 'top center' }}
                        >
                            <SheetPreview
                                config={config}
                                header={header}
                                logoLeft={logoLeft?.url ?? null}
                                logoRight={logoRight?.url ?? null}
                                images={currentChunk}
                                pageNum={currentPage + 1}
                                totalPages={totalPages}
                            />
                        </motion.div>
                    </AnimatePresence>
                </section>
            </div>
        </div>
    );
}
