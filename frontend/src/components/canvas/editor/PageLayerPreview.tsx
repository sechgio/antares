import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CanvasDocument, CanvasLayer } from '../types';
import { A4_HEIGHT_PX, A4_WIDTH_PX } from '../types';
import type { FillContext } from '../runtime/renderHtml';
import { getActivePageLayers } from '../ops/pages';
import { parseTableData } from '../ops/tableData';
import LayerNode from './LayerNode';

/**
 * Apply runtime fill so LayerNode shows the same content as HTML export.
 * Photo captions (imageMeta) stay PDF-only via renderHtml — not ported to screen.
 */
export function documentWithFill(doc: CanvasDocument, ctx: FillContext): CanvasDocument {
  return {
    ...doc,
    layers: doc.layers.map((layer) => {
      if (layer.type === 'field') {
        const key = layer.meta?.key || '';
        const hasData = key && ctx.data[key] != null && ctx.data[key] !== '';
        if (!hasData) return layer;
        return {
          ...layer,
          meta: { ...layer.meta, fallback: String(ctx.data[key]) },
        };
      }
      if (layer.type === 'logo') {
        const src = layer.meta?.side === 'right' ? ctx.logoRight : ctx.logoLeft;
        if (!src) return layer;
        return { ...layer, type: 'image' as const, value: src };
      }
      if (layer.type === 'imageSlot') {
        const src = ctx.images[layer.meta?.index ?? 0];
        if (!src) return layer;
        return { ...layer, type: 'image' as const, value: src };
      }
      if (layer.type === 'checkbox') {
        const key = layer.meta?.key;
        if (!key || ctx.data[key] == null) return layer;
        const raw = String(ctx.data[key]).toLowerCase();
        const checked =
          raw === '1' || raw === 'true' || raw === 'si' || raw === 'sí' || raw === 'x' || raw === 'yes';
        return { ...layer, meta: { ...layer.meta, checked } };
      }
      if (layer.type === 'signature') {
        const key = layer.meta?.key;
        if (!key || !ctx.data[key]) return layer;
        return { ...layer, value: ctx.data[key] };
      }
      if (layer.type === 'table') {
        const { cells, fieldKeys } = parseTableData(layer.meta?.rowsData);
        if (!fieldKeys?.length) return layer;
        const nextCells = cells.map((row, ri) =>
          row.map((cell, ci) => {
            const fieldKey = fieldKeys[ri]?.[ci];
            if (fieldKey && ctx.data[fieldKey] != null && ctx.data[fieldKey] !== '') {
              return String(ctx.data[fieldKey]);
            }
            return cell;
          }),
        );
        return {
          ...layer,
          meta: {
            ...layer.meta,
            rowsData: JSON.stringify({ cells: nextCells, fieldKeys }),
          },
        };
      }
      return layer;
    }),
  };
}

function noopSelect(_id: string, _additive?: boolean) {}
function noopPointerDown(_id: string, _additive: boolean, _e: ReactPointerEvent<HTMLDivElement>) {}

interface PageLayerPreviewProps {
  document: CanvasDocument;
  /** Which design page to show (matches Diseño). Defaults to 0. */
  pageIndex?: number;
  /** Layer paint/layout scale — 1 matches Design artboard at 100%. */
  scale?: number;
}

/**
 * Read-only A4 page using the same LayerNode renderer as Design mode.
 * Guarantees screen preview matches the artboard (fonts, spacing, chrome).
 */
export default function PageLayerPreview({
  document,
  pageIndex = 0,
  scale = 1,
}: PageLayerPreviewProps) {
  const layers = getActivePageLayers(document, pageIndex).filter(
    (l): l is CanvasLayer => l.type !== 'frame' && l.visible !== false,
  );

  return (
    <div
      data-testid="page-layer-preview"
      style={{
        position: 'relative',
        width: A4_WIDTH_PX * scale,
        height: A4_HEIGHT_PX * scale,
        background: '#ffffff',
        overflow: 'hidden',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.08), 0 12px 40px rgba(0,0,0,0.14)',
        // Match Design artboard: no UI chrome letter-spacing bleed.
        fontFamily: 'var(--cv-font, "Segoe UI", "Helvetica Neue", Arial, sans-serif)',
        letterSpacing: 'normal',
      }}
    >
      {layers.map((layer) => (
        <LayerNode
          key={layer.id}
          layer={layer}
          selected={false}
          interactive={false}
          scale={scale}
          onSelect={noopSelect}
          onLayerPointerDown={noopPointerDown}
        />
      ))}
    </div>
  );
}
