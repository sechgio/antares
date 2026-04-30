import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { ChevronDown, Upload, X } from 'lucide-react';
import type { FieldDef, LogoData, ReportTypeConfig } from '../types';

interface HeaderFormProps {
    config: ReportTypeConfig;
    fields: FieldDef[];
    header: Record<string, string>;
    onFieldChange: (key: string, value: string) => void;
    logoLeft: LogoData | null;
    logoRight: LogoData | null;
    onLogoChange: (side: 'left' | 'right', files: FileList | null) => void;
    onLogoRemove: (side: 'left' | 'right') => void;
}

const sectionOrder = ['generales', 'localizacion', 'trabajo'] as const;

const sectionLabels: Record<string, string> = {
    generales: 'Datos Generales',
    localizacion: 'Localización',
    trabajo: 'Orden de Trabajo',
};

const collapseVariants: Variants = {
    open: { height: 'auto', opacity: 1, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } },
    collapsed: { height: 0, opacity: 0, transition: { duration: 0.15, ease: [0.4, 0, 0.2, 1] } },
};

export default function HeaderForm({
    config,
    fields,
    header,
    onFieldChange,
    logoLeft,
    logoRight,
    onLogoChange,
    onLogoRemove,
}: HeaderFormProps) {
    const logoLeftRef = useRef<HTMLInputElement>(null);
    const logoRightRef = useRef<HTMLInputElement>(null);

    const [openSections, setOpenSections] = useState<Record<string, boolean>>({
        generales: true,
        localizacion: true,
        trabajo: true,
    });

    const toggle = (key: string) => setOpenSections((p) => ({ ...p, [key]: !p[key] }));

    const grouped = sectionOrder
        .map((section) => ({
            section,
            fields: fields.filter((f) => (f.section ?? 'generales') === section),
        }))
        .filter((g) => g.fields.length > 0);

    const generalesFields = grouped.find((g) => g.section === 'generales');
    const tituloField = generalesFields?.fields.find((f) => f.key === 'titulo');
    const otherGenerales = generalesFields?.fields.filter((f) => f.key !== 'titulo') ?? [];

    const renderField = (field: FieldDef) => (
        <div className="rcampo-field" key={field.key}>
            <label className="rcampo-field-label">
                {field.label}
                {field.required && <span className="required">*</span>}
            </label>
            {field.multiline && field.rows ? (
                <textarea
                    className="rcampo-textarea"
                    rows={field.rows}
                    value={header[field.key] ?? ''}
                    onChange={(e) => onFieldChange(field.key, e.target.value)}
                    placeholder={field.label}
                />
            ) : (
                <input
                    type={field.type ?? 'text'}
                    className="rcampo-input"
                    value={header[field.key] ?? ''}
                    onChange={(e) => onFieldChange(field.key, e.target.value)}
                    placeholder={field.label}
                />
            )}
        </div>
    );

    return (
        <>
            {/* ── DATOS GENERALES ── */}
            <div className="rcampo-section">
                <button className="rcampo-section-header" onClick={() => toggle('generales')}>
                    <span className="rcampo-section-title">{sectionLabels.generales}</span>
                    <span className={`rcampo-section-toggle ${openSections.generales ? 'open' : ''}`}>
                        <ChevronDown size={11} />
                    </span>
                </button>
                <AnimatePresence initial={false}>
                    {openSections.generales && (
                        <motion.div initial="collapsed" animate="open" exit="collapsed" variants={collapseVariants}>
                            <div className="rcampo-section-body">
                                {tituloField && (
                                    <div className="rcampo-field">
                                        <label className="rcampo-field-label">{tituloField.label}</label>
                                        <input
                                            type="text"
                                            className="rcampo-input"
                                            value={header[tituloField.key] ?? ''}
                                            onChange={(e) => onFieldChange(tituloField.key, e.target.value)}
                                            placeholder={config.defaultTitulo}
                                        />
                                    </div>
                                )}

                                <div className="rcampo-logos">
                                    <div className="rcampo-logo-slot">
                                        <span className="rcampo-logo-label">Izq</span>
                                        <button
                                            className={`rcampo-logo-btn ${logoLeft ? 'has-logo' : ''}`}
                                            onClick={() => logoLeftRef.current?.click()}
                                        >
                                            {logoLeft ? <img src={logoLeft.url} alt="L" /> : <Upload size={14} />}
                                            {logoLeft && (
                                                <span role="button" tabIndex={0} className="rcampo-logo-remove" onClick={(e) => { e.stopPropagation(); onLogoRemove('left'); }}>
                                                    <X size={7} />
                                                </span>
                                            )}
                                        </button>
                                        <input ref={logoLeftRef} type="file" accept="image/*" className="hidden" onChange={(e) => onLogoChange('left', e.target.files)} />
                                    </div>
                                    <div className="rcampo-logo-slot">
                                        <span className="rcampo-logo-label">Der</span>
                                        <button
                                            className={`rcampo-logo-btn ${logoRight ? 'has-logo' : ''}`}
                                            onClick={() => logoRightRef.current?.click()}
                                        >
                                            {logoRight ? <img src={logoRight.url} alt="R" /> : <Upload size={14} />}
                                            {logoRight && (
                                                <span role="button" tabIndex={0} className="rcampo-logo-remove" onClick={(e) => { e.stopPropagation(); onLogoRemove('right'); }}>
                                                    <X size={7} />
                                                </span>
                                            )}
                                        </button>
                                        <input ref={logoRightRef} type="file" accept="image/*" className="hidden" onChange={(e) => onLogoChange('right', e.target.files)} />
                                    </div>
                                </div>

                                {otherGenerales.map(renderField)}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <div className="rcampo-divider" />

            {/* ── LOCALIZACION + TRABAJO ── */}
            {grouped
                .filter((g) => g.section !== 'generales')
                .map(({ section, fields: sectionFields }) => {
                    const isOpen = openSections[section] ?? true;
                    return (
                        <React.Fragment key={section}>
                            <div className="rcampo-section">
                                <button className="rcampo-section-header" onClick={() => toggle(section)}>
                                    <span className="rcampo-section-title">{sectionLabels[section]}</span>
                                    <span className={`rcampo-section-toggle ${isOpen ? 'open' : ''}`}>
                                        <ChevronDown size={11} />
                                    </span>
                                </button>
                                <AnimatePresence initial={false}>
                                    {isOpen && (
                                        <motion.div initial="collapsed" animate="open" exit="collapsed" variants={collapseVariants}>
                                            <div className="rcampo-section-body">
                                                {sectionFields.map(renderField)}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                            <div className="rcampo-divider" />
                        </React.Fragment>
                    );
                })}
        </>
    );
}
