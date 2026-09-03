import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CanvasDocument, CanvasLayer } from '../types';
import { A4_HEIGHT_PX, A4_WIDTH_PX } from '../types';
import { stripPlaceholderChrome, type FillContext } from '../runtime/renderHtml';
import { getActivePageLayers } from '../ops/pages';
import { parseTableData } from '../ops/tableData';
import LayerNode from './LayerNode';

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
        return {
          ...layer,
          type: 'image' as const,
          value: src,
          cssVars: stripPlaceholderChrome(layer.cssVars),
        };
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
  pageIndex?: number;
  scale?: number;
}

export default function PageLayerPreview({
  document,
  pageIndex = 0,
  scale = 1,
}: PageLayerPreviewProps) {
  const layers = getActivePageLayers(document, pageIndex).filter(
    (l): l is CanvasLayer => l.type !== 'frame' && l.visible !== false,
  );
  const masterById = new Map<string, CanvasLayer>();
  for (const l of layers) {
    if (l.meta?.componentId) masterById.set(l.meta.componentId, l);
    else if (l.type === 'component' && !l.meta?.instanceOf) masterById.set(l.id, l);
  }

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
        fontFamily: 'var(--cv-font, "Segoe UI", "Helvetica Neue", Arial, sans-serif)',
        letterSpacing: 'normal',
      }}
    >
      {layers.map((layer) => (
        <LayerNode
          key={layer.id}
          layer={layer}
          masterLayer={
            layer.meta?.instanceOf ? masterById.get(layer.meta.instanceOf) ?? null : null
          }
          documentLayers={layers}
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
