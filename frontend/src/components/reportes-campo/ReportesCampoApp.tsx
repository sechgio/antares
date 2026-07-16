import './rcampo-styles.css';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Camera,
    Droplet,
    Download,
    FilePlus2,
    Files,
    Loader2,
    PaintBucket,
} from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import SheetPreview from './components/SheetPreview';
import HeaderForm from './components/HeaderForm';
import PhotoManager from './components/PhotoManager';
import PanelList from './components/PanelList';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import type { ReportType } from './types';
import { chunkArray, CHUNK_SIZE, getReportConfig, REPORT_TYPES } from './constants';
import { useCampoPanels } from './hooks/useCampoPanels';
import { useCampoBranding } from './hooks/useCampoBranding';
import {
    buildIndividualFilename,
    exportConsolidatedReportPdf,
    exportReportPdf,
} from './utils/export';
import { saveFeatureHistory } from '../../utils/history';

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
    const dialog = useDialog();
    const [reportType, setReportType] = useState<ReportType>('panel-fotografico');
    const config = getReportConfig(reportType);

    const {
        panels,
        selectedPanel,
        selectedPanelId,
        panelListItems,
        createPanel,
        selectPanel,
        updateHeader,
        addPhotos,
        clearPhotos,
        deletePanel,
    } = useCampoPanels(config);

    const { logoLeft, logoRight, setLogo, removeLogo } = useCampoBranding(reportType);
    const [currentPage, setCurrentPage] = useState(0);
    const [isExporting, setIsExporting] = useState(false);
    const [isDraggingImages, setIsDraggingImages] = useState(false);

    const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
    const [rightSidebarWidth, setRightSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
    const [isResizing, setIsResizing] = useState(false);
    const startXRef = useRef(0);
    const startWidthRef = useRef(0);
    const resizeSideRef = useRef<'left' | 'right'>('left');

    const photos = selectedPanel?.photos ?? [];
    const header = selectedPanel?.header ?? {};

    const itemsPerPage = config.photosPerPage || CHUNK_SIZE;
    const chunks = chunkArray(photos, itemsPerPage);
    const previewChunks = chunks.length > 0 ? chunks : [[]];
    const totalPages = previewChunks.length;
    const currentChunk = previewChunks[currentPage] ?? [];

    const exportablePanelCount = panels.filter((panel) => panel.photos.length > 0).length;

    // Al cambiar de plantilla solo reiniciamos la página; la carga de las hojas
    // persistentes de cada tipo la hace useCampoPanels internamente.
    useEffect(() => {
        setCurrentPage(0);
    }, [reportType]);

    useEffect(() => {
        if (currentPage >= totalPages) {
            setCurrentPage(Math.max(0, totalPages - 1));
        }
    }, [currentPage, totalPages]);

    const handleSelectPanel = useCallback((id: string) => {
        selectPanel(id);
        setCurrentPage(0);
    }, [selectPanel]);

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

    const handleImagesAdd = useCallback((files: FileList | null) => {
        const { rejected } = addPhotos(files);
        if (rejected > 0) {
            addToast({
                message: `Máximo ${itemsPerPage} imágenes por panel (grid dinámico).`,
                type: 'warning',
            });
        }
    }, [addPhotos, addToast, itemsPerPage]);

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

    const handleExportCurrent = useCallback(async () => {
        if (!selectedPanel || photos.length === 0) {
            addToast({ message: 'Agrega al menos una imagen antes de exportar.', type: 'error' });
            return;
        }
        setIsExporting(true);
        try {
            const defaultFilename = buildIndividualFilename(config, selectedPanel.label);
            const result = await exportReportPdf(
                config,
                header,
                photos,
                logoLeft,
                logoRight,
                { defaultFilename },
            );
            if (result.cancelled) return;
            await saveFeatureHistory(
                'reporte_campo',
                `${config.label} - ${selectedPanel.label}`,
                { reportType: config.id, type: 'individual', photos: photos.length, header },
                photos.length,
            );
            addToast({ message: `PDF guardado: ${result.filename || defaultFilename}`, type: 'success' });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Error al generar el PDF.';
            addToast({ message, type: 'error' });
        } finally {
            setIsExporting(false);
        }
    }, [addToast, config, header, photos, logoLeft, logoRight, selectedPanel]);

    const handleExportConsolidated = useCallback(async () => {
        if (exportablePanelCount === 0) {
            addToast({ message: 'Agrega imágenes a al menos un panel antes de exportar.', type: 'error' });
            return;
        }
        setIsExporting(true);
        try {
            const result = await exportConsolidatedReportPdf(config, panels, logoLeft, logoRight);
            if (result.cancelled) return;
            await saveFeatureHistory(
                'reporte_campo',
                `${config.label} - consolidado`,
                { reportType: config.id, type: 'consolidado', count: exportablePanelCount },
                exportablePanelCount,
            );
            addToast({
                message: `PDF consolidado guardado (${exportablePanelCount} paneles)`,
                type: 'success',
            });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Error al generar el PDF consolidado.';
            addToast({ message, type: 'error' });
        } finally {
            setIsExporting(false);
        }
    }, [addToast, config, exportablePanelCount, panels, logoLeft, logoRight]);

    const handleDeletePanel = useCallback(async (id: string) => {
        const confirmed = await dialog.confirm({
            title: 'Eliminar panel',
            description: 'Se eliminará este panel y sus imágenes.',
            confirmLabel: 'Eliminar',
            cancelLabel: 'Cancelar',
            type: 'destructive',
        });
        if (!confirmed) return;
        deletePanel(id);
        addToast({ message: 'Panel eliminado', type: 'success' });
    }, [addToast, dialog, deletePanel]);

    const handleResizeStart = useCallback((side: 'left' | 'right') => (e: React.MouseEvent) => {
        e.preventDefault();
        resizeSideRef.current = side;
        setIsResizing(true);
        startXRef.current = e.clientX;
        startWidthRef.current = side === 'left' ? sidebarWidth : rightSidebarWidth;
    }, [sidebarWidth, rightSidebarWidth]);

    const handleResizeMove = useCallback((e: MouseEvent) => {
        if (!isResizing) return;
        const delta = e.clientX - startXRef.current;
        const widthDelta = resizeSideRef.current === 'left' ? delta : -delta;
        const newWidth = Math.max(
            MIN_SIDEBAR_WIDTH,
            Math.min(MAX_SIDEBAR_WIDTH, startWidthRef.current + widthDelta),
        );
        if (resizeSideRef.current === 'left') {
            setSidebarWidth(newWidth);
        } else {
            setRightSidebarWidth(newWidth);
        }
    }, [isResizing]);

    const handleResizeEnd = useCallback(() => {
        setIsResizing(false);
    }, []);

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

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                if (photos.length > 0 && !isExporting) {
                    handleExportCurrent();
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [photos.length, isExporting, handleExportCurrent]);

    return (
        <div className="rcampo-app">
            <header className="rcampo-header">
                <div className="rcampo-header-side">
                    <div className="rcampo-brand">
                        <div className="rcampo-brand-icon">
                            <Camera size={16} />
                        </div>
                        <h1>Paneles</h1>
                    </div>
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

                <div className="rcampo-header-side rcampo-header-side-end" aria-hidden="true" />
            </header>

            <div className="rcampo-workspace">
                <aside className="rcampo-sidebar" style={{ width: sidebarWidth }}>
                    <div className="rcampo-sidebar-scroll">
                        <div
                            className={`sash-module_sash__K-9lB sash-vertical sash-module_vertical__pB-rs ${isResizing ? 'sash-active' : ''}`}
                            onMouseDown={handleResizeStart('left')}
                        />
                        {selectedPanel && (
                            <>
                                <HeaderForm
                                    config={config}
                                    fields={config.fields}
                                    header={header}
                                    onFieldChange={updateHeader}
                                    logoLeft={logoLeft}
                                    logoRight={logoRight}
                                    onLogoChange={setLogo}
                                    onLogoRemove={removeLogo}
                                />

                                <PhotoManager
                                    photos={photos}
                                    maxPhotos={itemsPerPage}
                                    onAdd={handleImagesAdd}
                                    onClear={clearPhotos}
                                    totalPages={totalPages}
                                    isDragging={isDraggingImages}
                                    onDragOver={handleDragOver}
                                    onDragEnter={handleDragEnter}
                                    onDragLeave={handleDragLeave}
                                    onDrop={handleDrop}
                                />
                            </>
                        )}
                    </div>
                </aside>

                <section className="rcampo-canvas">
                    <div className="rcampo-canvas-inner">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={`${reportType}-${selectedPanelId}-${currentPage}`}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                transition={{ duration: 0.2 }}
                                className="rcampo-preview-frame"
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
                    </div>
                </section>

                <aside className="rcampo-sidebar rcampo-sidebar-right" style={{ width: rightSidebarWidth }}>
                    <div className="rcampo-sidebar-scroll">
                        <div
                            className={`sash-module_sash__K-9lB sash-vertical sash-module_vertical__pB-rs sash-left ${isResizing ? 'sash-active' : ''}`}
                            onMouseDown={handleResizeStart('right')}
                        />
                        <div className="rcampo-panels-actions">
                            <WithHoverTooltip label="Nuevo panel" placement="bottom">
                                <button
                                    type="button"
                                    className="rcampo-toolbar-btn rcampo-sidebar-action"
                                    onClick={createPanel}
                                    disabled={isExporting}
                                    aria-label="Nuevo panel"
                                >
                                    <FilePlus2 size={14} />
                                    Nuevo
                                </button>
                            </WithHoverTooltip>
                            <WithHoverTooltip label="Exportar panel actual" placement="bottom">
                                <button
                                    type="button"
                                    className="rcampo-toolbar-btn rcampo-toolbar-btn-primary rcampo-sidebar-action"
                                    onClick={() => void handleExportCurrent()}
                                    disabled={!selectedPanel || photos.length === 0 || isExporting}
                                    aria-label="Exportar panel actual"
                                >
                                    {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                    PDF
                                </button>
                            </WithHoverTooltip>
                            <WithHoverTooltip label="Exportar todos los paneles" placement="bottom">
                                <button
                                    type="button"
                                    className="rcampo-toolbar-btn rcampo-sidebar-action"
                                    onClick={() => void handleExportConsolidated()}
                                    disabled={exportablePanelCount === 0 || isExporting}
                                    aria-label="Exportar todos los paneles"
                                >
                                    <Files size={14} />
                                    Consolidado
                                </button>
                            </WithHoverTooltip>
                        </div>
                        <PanelList
                            panels={panelListItems}
                            selectedId={selectedPanelId}
                            onSelect={handleSelectPanel}
                            onDelete={(id) => void handleDeletePanel(id)}
                        />
                    </div>
                </aside>
            </div>
        </div>
    );
}
