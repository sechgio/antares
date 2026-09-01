import React, { useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { ChevronDown, ImagePlus, Trash2 } from 'lucide-react';
import type { PhotoFile } from '../types';

interface PhotoManagerProps {
    photos: PhotoFile[];
    maxPhotos: number;
    onAdd: (files: FileList | null) => void;
    onClear: () => void;
    totalPages: number;
    isDragging: boolean;
    onDragOver: (e: React.DragEvent) => void;
    onDragEnter: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
}

const collapseVariants: Variants = {
    open: { height: 'auto', opacity: 1, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } },
    collapsed: { height: 0, opacity: 0, transition: { duration: 0.15, ease: [0.4, 0, 0.2, 1] } },
};

const instantCollapseVariants: Variants = {
    open: { height: 'auto', opacity: 1, transition: { duration: 0 } },
    collapsed: { height: 0, opacity: 0, transition: { duration: 0 } },
};

export default function PhotoManager({
    photos,
    maxPhotos,
    onAdd,
    onClear,
    totalPages,
    isDragging,
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
}: PhotoManagerProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [isOpen, setIsOpen] = useState(true);
    const reducedMotion = useReducedMotion();
    const isFull = photos.length >= maxPhotos;

    return (
        <div className="rcampo-section">
            <button type="button" className="rcampo-section-header" onClick={() => setIsOpen((v) => !v)} aria-expanded={isOpen}>
                <span className="rcampo-section-title">
                    Imágenes
                    {photos.length > 0 && (
                        <span style={{ color: 'var(--rcampo-muted)', fontWeight: 500, marginLeft: 4 }}>
                            ({photos.length}/{maxPhotos})
                        </span>
                    )}
                </span>
                <span className={`rcampo-section-toggle ${isOpen ? 'open' : ''}`}>
                    <ChevronDown size={11} />
                </span>
            </button>

            <AnimatePresence initial={false}>
                {isOpen && (
                        <motion.div
                            initial={reducedMotion ? false : 'collapsed'}
                            animate="open"
                            exit={reducedMotion ? undefined : 'collapsed'}
                            variants={reducedMotion ? instantCollapseVariants : collapseVariants}
                        >
                        <div className="rcampo-section-body">
                            <div
                                role="button"
                                tabIndex={isFull ? -1 : 0}
                                aria-disabled={isFull}
                                aria-label={isFull ? `Límite alcanzado (${maxPhotos} imágenes)` : 'Agregar imágenes'}
                                className={`rcampo-dropzone ${isDragging ? 'dragging' : ''} ${isFull ? 'full' : ''}`}
                                onDragOver={isFull ? undefined : onDragOver}
                                onDragEnter={isFull ? undefined : onDragEnter}
                                onDragLeave={isFull ? undefined : onDragLeave}
                                onDrop={isFull ? undefined : onDrop}
                                onClick={() => !isFull && inputRef.current?.click()}
                                onKeyDown={(e) => {
                                    if (!isFull && (e.key === 'Enter' || e.key === ' ')) {
                                        e.preventDefault();
                                        inputRef.current?.click();
                                    }
                                }}
                            >
                                <div className="rcampo-dropzone-icon"><ImagePlus size={16} /></div>
                                <div className="rcampo-dropzone-text">
                                    {isFull
                                        ? `Límite alcanzado (${maxPhotos} imágenes)`
                                        : isDragging
                                          ? 'Soltar aquí'
                                          : `Agregar imágenes (máx. ${maxPhotos}, grid dinámico)`}
                                </div>
                                <input
                                    ref={inputRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    className="hidden"
                                    disabled={isFull}
                                    onChange={(e) => { onAdd(e.target.files); e.target.value = ''; }}
                                />
                            </div>

                            {photos.length > 0 && (
                                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span className="rcampo-photos-count">
                                        {photos.length} foto{photos.length !== 1 ? 's' : ''} &middot; {totalPages} hoja{totalPages !== 1 ? 's' : ''}
                                    </span>
                                    <button type="button" className="rcampo-photos-clear" onClick={onClear}>
                                        <Trash2 size={9} /> Limpiar
                                    </button>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
