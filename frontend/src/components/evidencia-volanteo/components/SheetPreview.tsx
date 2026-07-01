import React from 'react';
import { GRID_COLUMNS, GRID_ROWS } from '../constants';
import {
  CUADRANTE_LABEL,
  EMPTY_CUADRANTE_PLACEHOLDER,
  GAP_HEIGHT_CM,
  GAP_UNDER_HEADER_CM,
  HEADER_INFO_HEIGHT_CM,
  HEADER_LOGO_WIDTH_CM,
  HEADER_TITLE_HEIGHT_CM,
  HEADER_TITLE_WIDTH_CM,
  INFO_FONT_PT,
  LOGO_MAX_HEIGHT_CM,
  LOGO_MAX_WIDTH_CM,
  PAGE_MARGIN_MM,
  PHOTO_HEIGHT_CM,
  PHOTO_WIDTH_CM,
  SHEET_BORDER,
  TABLE_HEIGHT_CM,
  TABLE_WIDTH_CM,
  TITLE_FONT_PT,
} from '../layout';
import type { LocalImage } from '../types';

export type SheetPreviewVariant = 'screen' | 'export';

interface Props {
  title: string;
  cuadrante: string;
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

  return (
    <div
      className={`preview-paper-scope bg-white text-black${isExport ? ' ev-sheet-page' : ''}`}
      style={{
        width: isExport ? `${TABLE_WIDTH_CM}cm` : '210mm',
        height: isExport ? `${TABLE_HEIGHT_CM}cm` : '297mm',
        padding: isExport ? 0 : `${PAGE_MARGIN_MM}mm`,
        fontFamily: 'Aptos, Arial, Helvetica, sans-serif',
        boxSizing: 'border-box',
        overflow: 'hidden',
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
              }}
            >
              <span
                style={{
                  fontWeight: 'bold',
                  fontSize: `${INFO_FONT_PT}pt`,
                  textTransform: 'uppercase',
                  display: 'block',
                  marginBottom: '2pt',
                  letterSpacing: '0.2pt',
                }}
              >
                {CUADRANTE_LABEL}
              </span>
              <span
                style={{
                  fontWeight: 'bold',
                  fontSize: `${INFO_FONT_PT}pt`,
                  textTransform: 'uppercase',
                  display: 'block',
                  letterSpacing: '0.2pt',
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

      {/* ── Photos Table ── */}
      <table
        style={{
          width: `${TABLE_WIDTH_CM}cm`,
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
        }}
      >
        <colgroup>
          <col style={{ width: `${PHOTO_WIDTH_CM}cm` }} />
          <col style={{ width: `${PHOTO_WIDTH_CM}cm` }} />
          <col style={{ width: `${PHOTO_WIDTH_CM}cm` }} />
        </colgroup>
        <tbody>
          {Array.from({ length: GRID_ROWS }).map((_, row) => (
            <React.Fragment key={row}>
              {row > 0 && (
                <tr style={{ height: `${GAP_HEIGHT_CM}cm` }}>
                  <td colSpan={3} style={{ ...cellBase }} />
                </tr>
              )}
              <tr style={{ height: `${PHOTO_HEIGHT_CM}cm` }}>
                {Array.from({ length: GRID_COLUMNS }).map((__, col) => {
                  const slot = slots[row * GRID_COLUMNS + col];
                  return (
                    <td
                      key={col}
                      style={{
                        ...cellBase,
                        overflow: 'hidden',
                        verticalAlign: 'top',
                        lineHeight: 0,
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
                  );
                })}
              </tr>
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}