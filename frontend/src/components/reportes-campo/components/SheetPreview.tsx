import React from 'react';
import type { PhotoFile, ReportTypeConfig } from '../types';
import {
    getPhotoGridLayout,
    photoGridCellWidth,
    type PhotoImageSizing,
} from '../utils/photoGridLayout';
import { resolveTituloStyle } from '../utils/tituloStyle';

interface SheetPreviewProps {
    config: ReportTypeConfig;
    header: Record<string, string>;
    logoLeft: string | null;
    logoRight: string | null;
    images: PhotoFile[];
    pageNum: number;
    totalPages: number;
}

const sectionTitleStyle: React.CSSProperties = {
    fontSize: '9pt',
    fontWeight: 'bold',
    color: '#0066cc',
    textTransform: 'uppercase',
    marginBottom: '2mm',
    paddingBottom: '2px',
    borderBottom: '1px solid #0066cc',
};

const cellLabelStyle: React.CSSProperties = {
    fontWeight: 'bold',
    textTransform: 'uppercase',
    color: '#000',
    paddingRight: '6px',
    whiteSpace: 'nowrap',
};

const GRID_GAP = '2mm';

const photoCellStyle: React.CSSProperties = {
    background: '#ffffff',
    border: '1px solid #ddd',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    minWidth: 0,
    minHeight: 0,
    boxSizing: 'border-box',
};

const PhotoGridCell = React.memo(function PhotoGridCell({
    photo,
    labelIndex,
    width,
    imageSizing,
}: {
    photo: PhotoFile | null;
    labelIndex: number;
    width?: string;
    imageSizing: PhotoImageSizing;
}) {
    const preserveAspect = imageSizing === 'aspectPreserve';
    const cellStyle: React.CSSProperties = {
        ...photoCellStyle,
        width: width ?? '100%',
        flexShrink: width ? 0 : undefined,
    };

    return (
        <div style={cellStyle}>
            {photo ? (
                <img
                    src={photo.previewUrl}
                    alt={`Foto ${labelIndex + 1}`}
                    style={{
                        width: '100%',
                        height: '100%',
                        objectFit: preserveAspect ? 'contain' : 'fill',
                        objectPosition: 'center',
                        display: 'block',
                    }}
                />
            ) : (
                <span
                    style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#bbb',
                        fontSize: '10px',
                        fontStyle: 'italic',
                    }}
                >
                    Sin imagen
                </span>
            )}
        </div>
    );
});

const SheetPhotoGrid = React.memo(function SheetPhotoGrid({ images }: { images: PhotoFile[] }) {
    const gridLayout = getPhotoGridLayout(images.length);
    const cellWidth = photoGridCellWidth(gridLayout.columns);

    return (
        <div
            style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: GRID_GAP,
                width: '100%',
                height: '100%',
                border: '1px solid #0066cc',
                padding: '2mm',
                minHeight: 0,
                overflow: 'hidden',
                boxSizing: 'border-box',
            }}
        >
            {gridLayout.rows.map((row, rowIdx) => {
                const isFullRow = row.length >= gridLayout.columns;
                const rowStyle: React.CSSProperties = isFullRow
                    ? {
                        flex: 1,
                        display: 'grid',
                        gridTemplateColumns: `repeat(${gridLayout.columns}, minmax(0, 1fr))`,
                        gap: GRID_GAP,
                        minHeight: 0,
                    }
                    : {
                        flex: 1,
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'stretch',
                        gap: GRID_GAP,
                        minHeight: 0,
                    };

                return (
                    <div key={rowIdx} style={rowStyle}>
                        {row.map((cell, cellIdx) => (
                            <PhotoGridCell
                                key={`${rowIdx}-${cellIdx}`}
                                photo={cell === null ? null : images[cell] ?? null}
                                labelIndex={cell ?? cellIdx}
                                width={isFullRow ? undefined : cellWidth}
                                imageSizing={gridLayout.imageSizing}
                            />
                        ))}
                    </div>
                );
            })}
        </div>
    );
});

export default function SheetPreview({
    config,
    header,
    logoLeft,
    logoRight,
    images,
    pageNum,
    totalPages,
}: SheetPreviewProps) {
    const tituloStyle = resolveTituloStyle(header);
    const pageLabelWord = config.pageLabelFormat === 'pagina' ? 'Página' : 'Hoja';

    return (
        <div
            className="preview-paper-scope bg-white text-black"
            style={{
                width: '210mm',
                height: '297mm',
                padding: '8mm',
                fontFamily: 'Arial, Helvetica, sans-serif',
                fontSize: '10px',
                display: 'flex',
                flexDirection: 'column',
                boxSizing: 'border-box',
                overflow: 'hidden',
                boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
            }}
        >
            {/* Header band */}
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    height: '20mm',
                    paddingBottom: '4mm',
                    borderBottom: '2px solid #333',
                    marginBottom: '3mm',
                    flexShrink: 0,
                }}
            >
                <div style={{ width: '55mm', height: '18mm', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {logoLeft ? (
                        <img src={logoLeft} alt="Logo Izquierdo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    ) : (
                        <div style={{ width: '55mm', height: '18mm' }} />
                    )}
                </div>
                <div style={{ flex: 1, textAlign: 'center' }}>
                    <div
                        style={{
                            fontSize: `${tituloStyle.fontSizePx}px`,
                            fontWeight: 'bold',
                            textTransform: 'uppercase',
                            letterSpacing: '1px',
                            color: tituloStyle.color,
                        }}
                    >
                        {header.titulo || config.defaultTitulo}
                    </div>
                    {totalPages > 1 && (
                        <div style={{ fontSize: '9px', color: '#777', marginTop: '2px' }}>
                            {pageLabelWord} {pageNum}/{totalPages}
                        </div>
                    )}
                </div>
                <div style={{ width: '55mm', height: '18mm', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {logoRight ? (
                        <img src={logoRight} alt="Logo Derecho" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    ) : (
                        <div style={{ width: '55mm', height: '18mm' }} />
                    )}
                </div>
            </div>

            {/* Info bar */}
            <div
                style={{
                    display: 'flex',
                    border: '1px solid #ccc',
                    marginBottom: '2mm',
                    flexShrink: 0,
                    background: '#f5f5f5',
                }}
            >
                {config.infoBarItems.map((item, idx, arr) => {
                    const rawValue = header[item.valueKey] || '';
                    const value = item.format ? item.format(rawValue) : rawValue;
                    return (
                        <div
                            key={item.label}
                            style={{
                                flex: 1,
                                padding: '1.5mm 2mm',
                                borderRight: idx < arr.length - 1 ? '1px solid #ccc' : 'none',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '1mm',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            <span style={{ fontSize: '9pt', fontWeight: 'bold', textTransform: 'uppercase', color: '#000' }}>
                                {item.label}:
                            </span>
                            <span style={{ fontSize: '9pt', color: '#000' }}>
                                {value || '-'}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* 1.0 Localización */}
            <div style={{ marginBottom: '2mm', flexShrink: 0 }}>
                <div style={sectionTitleStyle}>1.0 Localización</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt' }}>
                    <tbody>
                        {config.localizacionRows.map((row, rowIdx) => (
                            <tr key={rowIdx}>
                                {row.map((cell, cellIdx) => (
                                    <td
                                        key={cellIdx}
                                        colSpan={cell.colSpan}
                                        style={
                                            row.length === 2 && cellIdx === 0
                                                ? { width: '50%' }
                                                : row.length === 2
                                                  ? { width: '50%' }
                                                  : undefined
                                        }
                                    >
                                        {row.length > 1 ? (
                                            <>
                                                <span style={cellLabelStyle}>{cell.label}</span>
                                                <span style={{ color: '#000' }}>
                                                    {header[cell.valueKey] || '-'}
                                                </span>
                                            </>
                                        ) : (
                                            <>
                                                <span style={cellLabelStyle}>{cell.label}</span>
                                                {header[cell.valueKey] || '-'}
                                            </>
                                        )}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* 2.0 Detalles de Orden de Trabajo (optional) */}
            {config.trabajoSection && (
                <div style={{ marginBottom: '2mm', flexShrink: 0 }}>
                    <div style={sectionTitleStyle}>{config.trabajoSection.title}</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt' }}>
                        <tbody>
                            {config.trabajoSection.rows.map((row, rowIdx) => (
                                <tr key={rowIdx}>
                                    {row.map((cell, cellIdx) => (
                                        <td key={cellIdx} colSpan={cell.colSpan}>
                                            {row.length > 1 && cellIdx > 0 ? (
                                                <>
                                                    <span style={{ ...cellLabelStyle, paddingLeft: '8px' }}>{cell.label}</span>
                                                    {header[cell.valueKey] || '-'}
                                                </>
                                            ) : (
                                                <>
                                                    <span style={{ ...cellLabelStyle, width: row.length > 1 ? '20%' : undefined }}>{cell.label}</span>
                                                    {row.length > 1 ? (
                                                        <span style={{ width: '30%' }}>{header[cell.valueKey] || '-'}</span>
                                                    ) : (
                                                        header[cell.valueKey] || '-'
                                                    )}
                                                </>
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* 3.0 Panel Fotográfico */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
                <div style={sectionTitleStyle}>3.0 Panel Fotográfico</div>
                <SheetPhotoGrid images={images} />
            </div>
        </div>
    );
}
