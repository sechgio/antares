import React from 'react';
import { GRID_COLUMNS, GRID_ROWS } from '../constants';
import { DEFAULT_CUADRANTE_LABEL } from '../constants';
import {
  EMPTY_CUADRANTE_PLACEHOLDER,
  GAP_UNDER_HEADER_CM,
  HEADER_INFO_HEIGHT_CM,
  HEADER_LOGO_WIDTH_CM,
  HEADER_TITLE_HEIGHT_CM,
  HEADER_TITLE_WIDTH_CM,
  INFO_FONT_PT,
  LOGO_MAX_HEIGHT_CM,
  LOGO_MAX_WIDTH_CM,
  PAGE_MARGIN_MM,
  PHOTO_GAP_CM,
  PHOTO_HEIGHT_CM,
  PHOTO_TABLE_COLS,
  PHOTO_WIDTH_CM,
  SHEET_BORDER,
  TABLE_WIDTH_CM,
  TITLE_FONT_PT,
} from '../layout';
import type { LocalImage } from '../types';

export type SheetPreviewVariant = 'screen' | 'export';

interface Props {
  title: string;
  cuadrante: string;
  cuadranteLabel?: string;
  showCuadranteLabel?: boolean;
  logoLeft: string | null;
  logoRight: string | null;
  images: LocalImage[];
  pageNum: number;
  totalPages: number;
  variant?: SheetPreviewVariant;
}

const cellBase: React.CSSProperties = {
  border: SHEET_BORDER,
  padding: 0,
  margin: 0,
  verticalAlign: 'middle',
};

export default function SheetPreview({
  title,
  cuadrante,
  cuadranteLabel = DEFAULT_CUADRANTE_LABEL,
  showCuadranteLabel = true,
  logoLeft,
  logoRight,
  images,
  variant = 'screen',
}: Props) {
  const isExport = variant === 'export';
  const slots: (LocalImage | null)[] = Array.from(
    { length: GRID_COLUMNS * GRID_ROWS },
    (_, i) => images[i] ?? null,
  );

  const titleLines = (title || 'Sin título')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const resolvedLabel = (cuadranteLabel || DEFAULT_CUADRANTE_LABEL).trim();
  const shouldShowLabel = showCuadranteLabel && resolvedLabel.length > 0;

  return (
    <div
      className={`preview-paper-scope bg-white text-black${isExport ? ' ev-sheet-page' : ''}`}
      style={{
        width: isExport ? `${TABLE_WIDTH_CM}cm` : '210mm',
        height: isExport ? 'auto' : '297mm',
        padding: isExport ? 0 : `${PAGE_MARGIN_MM}mm`,
        fontFamily: 'Aptos, Arial, Helvetica, sans-serif',
        boxSizing: 'border-box',
        overflow: isExport ? 'visible' : 'hidden',
        pageBreakInside: isExport ? 'avoid' : undefined,
        breakInside: isExport ? 'avoid-page' : undefined,
        boxShadow: isExport ? 'none' : '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
      }}
    >
      {/* ── Header Table ── */}
      <table
        style={{
          width: `${TABLE_WIDTH_CM}cm`,
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
        }}
      >
        <colgroup>
          <col style={{ width: `${HEADER_LOGO_WIDTH_CM}cm` }} />
          <col style={{ width: `${HEADER_TITLE_WIDTH_CM}cm` }} />
          <col style={{ width: `${HEADER_LOGO_WIDTH_CM}cm` }} />
        </colgroup>
        <tbody>
          {/* Header Row 1: Logo Left (rowspan 2) | Title | Logo Right (rowspan 2) */}
          <tr style={{ height: `${HEADER_TITLE_HEIGHT_CM}cm` }}>
            <td
              rowSpan={2}
              style={{
                ...cellBase,
                textAlign: 'center',
                padding: '2pt 4pt',
              }}
            >
              {logoLeft ? (
                <img
                  src={logoLeft}
                  alt=""
                  style={{
                    maxWidth: `${LOGO_MAX_WIDTH_CM}cm`,
                    maxHeight: `${LOGO_MAX_HEIGHT_CM}cm`,
                    objectFit: 'contain',
                    display: 'block',
                    margin: '0 auto',
                  }}
                />
              ) : null}
            </td>
            <td style={{ ...cellBase, textAlign: 'center', padding: '2pt 4pt' }}>
              <div
                style={{
                  fontSize: `${TITLE_FONT_PT}pt`,
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  lineHeight: 1.25,
                  textAlign: 'center',
                  letterSpacing: '0.3pt',
                }}
              >
                {titleLines.map((line, idx) => (
                  <span
                    key={idx}
                    style={{
                      display: 'block',
                      textDecoration: 'underline',
                    }}
                  >
                    {line}
                  </span>
                ))}
              </div>
            </td>
            <td
              rowSpan={2}
              style={{
                ...cellBase,
                textAlign: 'center',
                padding: '2pt 4pt',
              }}
            >
              {logoRight ? (
                <img
                  src={logoRight}
                  alt=""
                  style={{
                    maxWidth: `${LOGO_MAX_WIDTH_CM}cm`,
                    maxHeight: `${LOGO_MAX_HEIGHT_CM}cm`,
                    objectFit: 'contain',
                    display: 'block',
                    margin: '0 auto',
                  }}
                />
              ) : null}
            </td>
          </tr>
          {/* Header Row 2: Cuadrante Info (center cell only) */}
          <tr style={{ height: `${HEADER_INFO_HEIGHT_CM}cm` }}>
            <td
              style={{
                ...cellBase,
                textAlign: 'center',
                padding: '3pt 5pt',
                verticalAlign: 'middle',
                overflow: 'hidden',
                maxWidth: `${HEADER_TITLE_WIDTH_CM}cm`,
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }}
            >
              {shouldShowLabel && (
                <span
                  style={{
                    fontWeight: 'bold',
                    fontSize: `${INFO_FONT_PT}pt`,
                    textTransform: 'uppercase',
                    display: 'block',
                    marginBottom: '2pt',
                    letterSpacing: '0.2pt',
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                  }}
                >
                  {resolvedLabel}
                </span>
              )}
              <span
                style={{
                  fontWeight: 'bold',
                  fontSize: `${INFO_FONT_PT}pt`,
                  textTransform: 'uppercase',
                  display: 'block',
                  letterSpacing: '0.2pt',
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word',
                  maxWidth: '100%',
                }}
              >
                {cuadrante.trim() || EMPTY_CUADRANTE_PLACEHOLDER}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Spacer between header and photos */}
      <div style={{ height: `${GAP_UNDER_HEADER_CM}cm`, width: '100%' }} />

      {/* ── Photos: un marco exterior + gutters blancos uniformes ── */}
      <table
        style={{
          width: `${TABLE_WIDTH_CM}cm`,
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
          border: SHEET_BORDER,
        }}
      >
        <colgroup>
          <col style={{ width: `${PHOTO_GAP_CM}cm` }} />
          {Array.from({ length: GRID_COLUMNS }).map((_, col) => (
            <React.Fragment key={col}>
              <col style={{ width: `${PHOTO_WIDTH_CM}cm` }} />
              <col style={{ width: `${PHOTO_GAP_CM}cm` }} />
            </React.Fragment>
          ))}
        </colgroup>
        <tbody>
          <tr>
            <td
              colSpan={PHOTO_TABLE_COLS}
              style={{
                padding: 0,
                border: 'none',
                height: `${PHOTO_GAP_CM}cm`,
                lineHeight: 0,
                fontSize: 0,
              }}
            >
              &nbsp;
            </td>
          </tr>
          {Array.from({ length: GRID_ROWS }).map((_, row) => (
            <React.Fragment key={row}>
              <tr style={{ height: `${PHOTO_HEIGHT_CM}cm` }}>
                <td
                  style={{
                    padding: 0,
                    border: 'none',
                    width: `${PHOTO_GAP_CM}cm`,
                    height: `${PHOTO_HEIGHT_CM}cm`,
                    lineHeight: 0,
                    fontSize: 0,
                  }}
                >
                  &nbsp;
                </td>
                {Array.from({ length: GRID_COLUMNS }).map((__, col) => {
                  const slot = slots[row * GRID_COLUMNS + col];
                  return (
                    <React.Fragment key={col}>
                      <td
                        style={{
                          padding: 0,
                          border: 'none',
                          overflow: 'hidden',
                          verticalAlign: 'top',
                          lineHeight: 0,
                          width: `${PHOTO_WIDTH_CM}cm`,
                          height: `${PHOTO_HEIGHT_CM}cm`,
                        }}
                      >
                        {slot ? (
                          <img
                            src={slot.objectUrl}
                            alt=""
                            style={{
                              width: '100%',
                              height: `${PHOTO_HEIGHT_CM}cm`,
                              objectFit: 'fill',
                              objectPosition: 'center',
                              display: 'block',
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '100%',
                              height: `${PHOTO_HEIGHT_CM}cm`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#bbb',
                              fontSize: '8pt',
                              fontStyle: 'italic',
                              lineHeight: 'normal',
                            }}
                          >
                            Sin imagen
                          </div>
                        )}
                      </td>
                      <td
                        style={{
                          padding: 0,
                          border: 'none',
                          width: `${PHOTO_GAP_CM}cm`,
                          height: `${PHOTO_HEIGHT_CM}cm`,
                          lineHeight: 0,
                          fontSize: 0,
                        }}
                      >
                        &nbsp;
                      </td>
                    </React.Fragment>
                  );
                })}
              </tr>
              <tr>
                <td
                  colSpan={PHOTO_TABLE_COLS}
                  style={{
                    padding: 0,
                    border: 'none',
                    height: `${PHOTO_GAP_CM}cm`,
                    lineHeight: 0,
                    fontSize: 0,
                  }}
                >
                  &nbsp;
                </td>
              </tr>
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}