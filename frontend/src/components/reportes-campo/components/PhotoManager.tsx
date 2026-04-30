import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { ChevronDown, Download, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import type { PhotoFile } from '../types';

interface PhotoManagerProps {
    photos: PhotoFile[];
    onAdd: (files: FileList | null) => void;
    onClear: () => void;
    totalPages: number;
    isDragging: boolean;
    isExporting: boolean;
    onExport: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragEnter: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
}

const collapseVariants: Variants = {
    open: { height: 'auto', opacity: 1, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } },
    collapsed: { height: 0, opacity: 0, transition: { duration: 0.15, ease: [0.4, 0, 0.2, 1] } },
};

export default function PhotoManager({
    photos,
    onAdd,
    onClear,
    totalPages,
    isDragging,
    isExporting,
    onExport,
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
}: PhotoManagerProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [isOpen, setIsOpen] = useState(true);

    return (
        <div className="rcampo-section">
            <button className="rcampo-section-header" onClick={() => setIsOpen((v) => !v)}>
                <span className="rcampo-section-title">
                    Imágenes
                    {photos.length > 0 && (
                        <span style={{ color: '#525252', fontWeight: 500, marginLeft: 4 }}>
                            ({photos.length})
                        </span>
                    )}
                </span>
                <span className={`rcampo-section-toggle ${isOpen ? 'open' : ''}`}>
                    <ChevronDown size={11} />
                </span>
            </button>

            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div initial="collapsed" animate="open" exit="collapsed" variants={collapseVariants}>
                        <div className="rcampo-section-body">
                            <div
                                className={`rcampo-dropzone ${isDragging ? 'dragging' : ''}`}
                                onDragOver={onDragOver}
                                onDragEnter={onDragEnter}
                                onDragLeave={onDragLeave}
                                onDrop={onDrop}
                                onClick={() => inputRef.current?.click()}
                            >
                                <div className="rcampo-dropzone-icon"><ImagePlus size={16} /></div>
                                <div className="rcampo-dropzone-text">
                                    {isDragging ? 'Soltar aquí' : 'Agregar imágenes'}
                                </div>
                                <input
                                    ref={inputRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    className="hidden"
                                    onChange={(e) => { onAdd(e.target.files); e.target.value = ''; }}
                                />
                            </div>

                            {photos.length > 0 && (
                                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span className="rcampo-photos-count">
                                        {photos.length} foto{photos.length !== 1 ? 's' : ''} &middot; {totalPages} hoja{totalPages !== 1 ? 's' : ''}
                                    </span>
                                    <button className="rcampo-photos-clear" onClick={onClear}>
                                        <Trash2 size={9} /> Limpiar
                                    </button>
                                </div>
                            )}

                            {/* Export Button - integrated inside section */}
                            <button
                                className="rcampo-export-btn"
                                onClick={onExport}
                                disabled={isExporting || photos.length === 0}
                                style={{ marginTop: 10 }}
                            >
                                {isExporting ? (
                                    <><Loader2 size={14} className="animate-spin" /> Generando…</>
                                ) : (
                                    <><Download size={14} /> Exportar PDF</>
                                )}
                            </button>

                            {photos.length > 0 && (
                                <p className="rcampo-export-meta" style={{ marginTop: 4 }}>
                                    {totalPages} {totalPages === 1 ? 'hoja' : 'hojas'} &middot; {photos.length} {photos.length === 1 ? 'foto' : 'fotos'}
                                </p>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
