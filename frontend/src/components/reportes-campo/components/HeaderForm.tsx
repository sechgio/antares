import React, { useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { ChevronDown, Upload, X, FileText, MapPin, Briefcase, Image as ImageIcon, Minus, Plus, RotateCcw } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import type { FieldDef, LogoData, ReportTypeConfig } from '../types';
import {
    DEFAULT_TITULO_COLOR,
    DEFAULT_TITULO_SIZE_PX,
    TITULO_COLOR_KEY,
    TITULO_SIZE_KEY,
    TITULO_SIZE_OPTIONS,
    resolveTituloStyle,
    stepTituloSize,
} from '../utils/tituloStyle';

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

const sectionIcons: Record<string, React.ReactNode> = {
    generales: <FileText size={11} />,
    localizacion: <MapPin size={11} />,
    trabajo: <Briefcase size={11} />,
};

const collapseVariants: Variants = {
    open: { height: 'auto', opacity: 1, transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] } },
    collapsed: { height: 0, opacity: 0, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } },
};

const instantCollapseVariants: Variants = {
    open: { height: 'auto', opacity: 1, transition: { duration: 0 } },
    collapsed: { height: 0, opacity: 0, transition: { duration: 0 } },
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
    const reducedMotion = useReducedMotion();
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

    const renderField = (field: FieldDef) => {
        const hasValue = !!(header[field.key] ?? '').trim();
        return (
            <div className={`rcampo-field ${hasValue ? 'has-value' : ''}`} key={field.key}>
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
    };

    /* Count filled fields per section for progress indicator */
    const filledCount = (sectionFields: FieldDef[]) =>
        sectionFields.filter((f) => !!(header[f.key] ?? '').trim()).length;

    const generalesTotal = (tituloField ? 1 : 0) + otherGenerales.length;
    const generalesFilled = filledCount(generalesFields?.fields ?? []);
    const tituloStyle = resolveTituloStyle(header);
    const tituloStyleIsCustom =
        tituloStyle.fontSizePx !== DEFAULT_TITULO_SIZE_PX || tituloStyle.color !== DEFAULT_TITULO_COLOR;
    const sizePresets = TITULO_SIZE_OPTIONS as readonly number[];
    const canDecreaseSize = tituloStyle.fontSizePx > sizePresets[0];
    const canIncreaseSize = tituloStyle.fontSizePx < sizePresets[sizePresets.length - 1];

    return (
        <>
            {/* ── DATOS GENERALES ── */}
            <div className={`rcampo-section ${openSections.generales ? 'is-open' : ''}`}>
                <button type="button" className="rcampo-section-header" onClick={() => toggle('generales')} aria-expanded={openSections.generales}>
                    <span className="rcampo-section-title">
                        <span className="rcampo-section-icon">{sectionIcons.generales}</span>
                        {sectionLabels.generales}
                    </span>
                    <span className="rcampo-section-meta">
                        <span className="rcampo-section-badge">{generalesFilled}/{generalesTotal}</span>
                        <span className={`rcampo-section-toggle ${openSections.generales ? 'open' : ''}`}>
                            <ChevronDown size={11} />
                        </span>
                    </span>
                </button>
                <AnimatePresence initial={false}>
                    {openSections.generales && (
                        <motion.div
                            initial={reducedMotion ? false : 'collapsed'}
                            animate="open"
                            exit={reducedMotion ? undefined : 'collapsed'}
                            variants={reducedMotion ? instantCollapseVariants : collapseVariants}
                            style={{ overflow: 'hidden' }}
                        >
                            <div className="rcampo-section-body">
                                {tituloField && (
                                    <div className={`rcampo-field ${(header[tituloField.key] ?? '').trim() ? 'has-value' : ''}`}>
                                        <label className="rcampo-field-label">{tituloField.label}</label>
                                        <input
                                            type="text"
                                            className="rcampo-input"
                                            value={header[tituloField.key] ?? ''}
                                            onChange={(e) => onFieldChange(tituloField.key, e.target.value)}
                                            placeholder={config.defaultTitulo}
                                        />
                                        <div className="rcampo-titulo-toolbar" data-testid="titulo-style-controls">
                                            <div className="rcampo-titulo-stepper" title="Tamaño del título">
                                                <button
                                                    type="button"
                                                    className="rcampo-titulo-step"
                                                    disabled={!canDecreaseSize}
                                                    aria-label="Reducir tamaño del título"
                                                    onClick={() =>
                                                        onFieldChange(
                                                            TITULO_SIZE_KEY,
                                                            String(stepTituloSize(tituloStyle.fontSizePx, -1)),
                                                        )
                                                    }
                                                >
                                                    <Minus size={11} strokeWidth={2.5} />
                                                </button>
                                                <span className="rcampo-titulo-size-value" aria-live="polite">
                                                    {tituloStyle.fontSizePx}
                                                </span>
                                                <button
                                                    type="button"
                                                    className="rcampo-titulo-step"
                                                    disabled={!canIncreaseSize}
                                                    aria-label="Aumentar tamaño del título"
                                                    onClick={() =>
                                                        onFieldChange(
                                                            TITULO_SIZE_KEY,
                                                            String(stepTituloSize(tituloStyle.fontSizePx, 1)),
                                                        )
                                                    }
                                                >
                                                    <Plus size={11} strokeWidth={2.5} />
                                                </button>
                                            </div>

                                            <span className="rcampo-titulo-sep" aria-hidden="true" />

                                            <label className="rcampo-titulo-chip rcampo-titulo-chip-color" title="Color del título">
                                                <span
                                                    className="rcampo-titulo-swatch"
                                                    style={{ backgroundColor: tituloStyle.color }}
                                                />
                                                <input
                                                    type="color"
                                                    className="rcampo-titulo-color-native"
                                                    value={tituloStyle.color}
                                                    onChange={(e) => onFieldChange(TITULO_COLOR_KEY, e.target.value.toUpperCase())}
                                                    aria-label="Color del título"
                                                />
                                            </label>

                                            {tituloStyleIsCustom && (
                                                <>
                                                    <span className="rcampo-titulo-sep" aria-hidden="true" />
                                                    <WithHoverTooltip label="Restablecer estilo" placement="bottom">
                                                        <button
                                                            type="button"
                                                            className="rcampo-titulo-reset"
                                                            aria-label="Restablecer estilo del título"
                                                            onClick={() => {
                                                                onFieldChange(TITULO_SIZE_KEY, String(DEFAULT_TITULO_SIZE_PX));
                                                                onFieldChange(TITULO_COLOR_KEY, DEFAULT_TITULO_COLOR);
                                                            }}
                                                        >
                                                            <RotateCcw size={11} strokeWidth={2.25} />
                                                        </button>
                                                    </WithHoverTooltip>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="rcampo-logos">
                                    <div className="rcampo-logo-slot">
                                        <span className="rcampo-logo-label">
                                            <ImageIcon size={9} />
                                            Logo Izquierdo
                                        </span>
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            aria-label="Subir o cambiar logo izquierdo"
                                            className={`rcampo-logo-btn ${logoLeft ? 'has-logo' : ''}`}
                                            onClick={() => logoLeftRef.current?.click()}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    logoLeftRef.current?.click();
                                                }
                                            }}
                                        >
                                            {logoLeft ? (
                                                <img src={logoLeft.url} alt="Logo izquierdo" />
                                            ) : (
                                                <span className="rcampo-logo-placeholder">
                                                    <Upload size={14} />
                                                    <span>Subir</span>
                                                </span>
                                            )}
                                            {logoLeft && (
                                                <button
                                                    type="button"
                                                    className="rcampo-logo-remove"
                                                    aria-label="Quitar logo izquierdo"
                                                    onClick={(e) => { e.stopPropagation(); onLogoRemove('left'); }}
                                                >
                                                    <X size={7} />
                                                </button>
                                            )}
                                        </div>
                                        <input ref={logoLeftRef} type="file" accept="image/*" className="hidden" onChange={(e) => onLogoChange('left', e.target.files)} />
                                    </div>
                                    <div className="rcampo-logo-slot">
                                        <span className="rcampo-logo-label">
                                            <ImageIcon size={9} />
                                            Logo Derecho
                                        </span>
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            aria-label="Subir o cambiar logo derecho"
                                            className={`rcampo-logo-btn ${logoRight ? 'has-logo' : ''}`}
                                            onClick={() => logoRightRef.current?.click()}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    logoRightRef.current?.click();
                                                }
                                            }}
                                        >
                                            {logoRight ? (
                                                <img src={logoRight.url} alt="Logo derecho" />
                                            ) : (
                                                <span className="rcampo-logo-placeholder">
                                                    <Upload size={14} />
                                                    <span>Subir</span>
                                                </span>
                                            )}
                                            {logoRight && (
                                                <button
                                                    type="button"
                                                    className="rcampo-logo-remove"
                                                    aria-label="Quitar logo derecho"
                                                    onClick={(e) => { e.stopPropagation(); onLogoRemove('right'); }}
                                                >
                                                    <X size={7} />
                                                </button>
                                            )}
                                        </div>
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
                    const sectionFilled = filledCount(sectionFields);
                    return (
                        <React.Fragment key={section}>
                            <div className={`rcampo-section ${isOpen ? 'is-open' : ''}`}>
                                <button type="button" className="rcampo-section-header" onClick={() => toggle(section)} aria-expanded={isOpen}>
                                    <span className="rcampo-section-title">
                                        <span className="rcampo-section-icon">{sectionIcons[section]}</span>
                                        {sectionLabels[section]}
                                    </span>
                                    <span className="rcampo-section-meta">
                                        <span className="rcampo-section-badge">{sectionFilled}/{sectionFields.length}</span>
                                        <span className={`rcampo-section-toggle ${isOpen ? 'open' : ''}`}>
                                            <ChevronDown size={11} />
                                        </span>
                                    </span>
                                </button>
                                <AnimatePresence initial={false}>
                                    {isOpen && (
                                        <motion.div
                                            initial={reducedMotion ? false : 'collapsed'}
                                            animate="open"
                                            exit={reducedMotion ? undefined : 'collapsed'}
                                            variants={reducedMotion ? instantCollapseVariants : collapseVariants}
                                            style={{ overflow: 'hidden' }}
                                        >
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
