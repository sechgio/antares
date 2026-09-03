import { memo, useEffect, useMemo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { CanvasLayer } from '../types';
import { mmToScreenPx } from '../ops/drawHelpers';
import { applyInstanceOverrides } from '../ops/components';
import { resolveBooleanRender } from '../ops/booleanOps';
import {
  canFocusFieldBinding,
  canInlineEditLayer,
  fieldDesignLabel,
  justifyContentForTextAlign,
} from '../ops/inlineEdit';
import { clipPathForLayer } from '../ops/shapePaths';
import {
  buildLayerPaintStyle,
  DEFAULT_LAYER_FONT,
  DEFAULT_LINE_HEIGHT,
  keepSpreadOnlyShadows,
} from '../ops/layerPaint';
import { imageContentInlineStyle } from '../ops/layerStyle';
import { layerGeometry } from '../ops/layerGeometry';
import { ensureLinePath } from '../ops/pathGeometry';
import { buildLineSvgContent } from '../ops/lineSvg';
import { parseTableData } from '../ops/tableData';
import { getBlobUrl } from '../utils/imageBlobStore';

interface LayerNodeProps {
  layer: CanvasLayer;
  masterLayer?: CanvasLayer | null;
  documentLayers?: CanvasLayer[];
  selected: boolean;
  interactive: boolean;
  scale: number;
  editing?: boolean;
  editingSelectAll?: boolean;
  pathEditing?: boolean;
  moving?: boolean;
  offscreen?: boolean;
  panning?: boolean;
  onSelect: (id: string, additive?: boolean) => void;
  onLayerPointerDown: (id: string, additive: boolean, e: ReactPointerEvent<HTMLDivElement>) => void;
  onContextMenu?: (id: string, clientX: number, clientY: number) => void;
  onStartEdit?: (id: string) => void;
  onEditValue?: (id: string, value: string, contentHeightPx?: number) => void;
  onFitTextHeight?: (id: string, contentHeightPx: number) => void;
  onCommitEdit?: () => void;
  onStartPathEdit?: (id: string) => void;
}

const imgStyleCache = new WeakMap<CanvasLayer['cssVars'], CSSProperties>();

function imgStyleFromCssVars(cssVars: CanvasLayer['cssVars']): CSSProperties {
  const cached = imgStyleCache.get(cssVars);
  if (cached) return cached;
  const style: CSSProperties = {};
  for (const part of imageContentInlineStyle(cssVars).split(';')) {
    if (!part) continue;
    const i = part.indexOf(':');
    if (i < 0) continue;
    const prop = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    const camel = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) as keyof CSSProperties;
    (style as Record<string, string>)[camel as string] = value;
  }
  style.imageRendering = 'auto';
  imgStyleCache.set(cssVars, style);
  return style;
}

const paintKeyCache = new WeakMap<CanvasLayer['cssVars'], Map<string, string>>();
function paintVarsKey(vars: CanvasLayer['cssVars'], scale: number, lineOverride: boolean): string {
  let byScale = paintKeyCache.get(vars);
  if (!byScale) {
    byScale = new Map<string, string>();
    paintKeyCache.set(vars, byScale);
  }
  const cacheKey = `${scale}|${lineOverride ? 1 : 0}`;
  const hit = byScale.get(cacheKey);
  if (hit !== undefined) return hit;
  let key = cacheKey;
  for (const k of Object.keys(vars)) {
    if (k === '--translate-x' || k === '--translate-y') continue;
    key += `|${k}=${vars[k as keyof typeof vars] ?? ''}`;
  }
  byScale.set(cacheKey, key);
  return key;
}

function LayerNode({
  layer: layerProp,
  masterLayer = null,
  documentLayers = [],
  selected,
  interactive,
  scale,
  editing = false,
  editingSelectAll = true,
  pathEditing = false,
  moving = false,
  offscreen = false,
  panning = false,
  onSelect,
  onLayerPointerDown,
  onContextMenu,
  onStartEdit,
  onEditValue,
  onFitTextHeight,
  onCommitEdit,
  onStartPathEdit,
}: LayerNodeProps) {
  const layer = useMemo(() => {
    if (!layerProp.meta?.instanceOf) return layerProp;
    return {
      ...layerProp,
      cssVars: applyInstanceOverrides(layerProp, masterLayer ?? undefined),
    };
  }, [layerProp, masterLayer]);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const paintCacheRef = useRef<{ key: string; paint: Record<string, string> } | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onLayerPointerDownRef = useRef(onLayerPointerDown);
  onLayerPointerDownRef.current = onLayerPointerDown;
  const onContextMenuRef = useRef(onContextMenu);
  onContextMenuRef.current = onContextMenu;
  const onStartEditRef = useRef(onStartEdit);
  onStartEditRef.current = onStartEdit;
  const onEditValueRef = useRef(onEditValue);
  onEditValueRef.current = onEditValue;
  const onFitTextHeightRef = useRef(onFitTextHeight);
  onFitTextHeightRef.current = onFitTextHeight;
  const onCommitEditRef = useRef(onCommitEdit);
  onCommitEditRef.current = onCommitEdit;
  const onStartPathEditRef = useRef(onStartPathEdit);
  onStartPathEditRef.current = onStartPathEdit;

  useEffect(() => {
    if (!editing || !editorRef.current) return;
    const el = editorRef.current;
    el.focus();
    if (editingSelectAll) el.select();
    else {
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [editing, editingSelectAll]);

  const finishEdit = () => {
    const el = editorRef.current;
    if (el && onFitTextHeightRef.current) {
      onFitTextHeightRef.current(layer.id, el.scrollHeight);
    }
    onCommitEditRef.current?.();
  };

  const lineLayer = useMemo(
    () => (layer.type === 'line' ? ensureLinePath(layer) : layer),
    [layer],
  );
  const lineSvg = useMemo(
    () => (layer.type === 'line' ? buildLineSvgContent(lineLayer) : ''),
    [layer.type, lineLayer],
  );
  const clipPath = useMemo(() => {
    const maskId = layer.meta?.maskLayerId;
    if (maskId && documentLayers.length) {
      const maskLayer = documentLayers.find((l) => l.id === maskId);
      if (maskLayer) {
        const maskClip = clipPathForLayer(maskLayer, documentLayers);
        if (maskClip) return maskClip;
      }
    }
    return clipPathForLayer(layer, documentLayers);
  }, [layer, documentLayers]);

  const booleanRender = useMemo(() => {
    if (layer.type !== 'boolean') return null;
    return resolveBooleanRender(layer, documentLayers);
  }, [layer, documentLayers]);

  const geometry = useMemo(() => layerGeometry(lineLayer, scale), [lineLayer, scale]);

  if (layer.type === 'frame' || layer.visible === false) return null;

  const isLine = layer.type === 'line';

  if (offscreen && !selected && !editing && !pathEditing) {
    return (
      <div
        data-layer-id={layer.id}
        data-culled="true"
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transform: geometry.transform,
          width: geometry.widthPx,
          height: geometry.heightPx,
          display: 'none',
          pointerEvents: 'none',
        }}
      />
    );
  }

  const hasExplicitRadius = Boolean(
    layer.cssVars['--border-radius'] ||
      layer.cssVars['--radius-tl'] ||
      layer.cssVars['--radius-tr'] ||
      layer.cssVars['--radius-br'] ||
      layer.cssVars['--radius-bl'],
  );
  const textAlign = layer.cssVars['--text-align'];
  const lineHeight = layer.cssVars['--line-height'] || DEFAULT_LINE_HEIGHT;
  const canEditText = canInlineEditLayer(layer);
  const canEditField = canFocusFieldBinding(layer);
  const highlighted = selected || editing || pathEditing;

  const paintSource = isLine ? lineLayer.cssVars : layer.cssVars;
  const paintDefer = moving ? 2 : panning ? 1 : 0;
  const paintCacheKey = `${paintVarsKey(paintSource, scale, isLine)}|${clipPath ?? ''}|${hasExplicitRadius ? 1 : 0}|${layer.type}|${paintDefer}`;
  let paint: Record<string, string>;
  if (paintCacheRef.current?.key === paintCacheKey) {
    paint = paintCacheRef.current.paint;
  } else {
    const paintVars = isLine
      ? {
          ...paintSource,
          '--background-color': 'transparent',
          '--fill-visible': '0',
          '--border-width': '0px',
          '--stroke-visible': '0',
          '--border': '',
        }
      : paintSource;
    paint = buildLayerPaintStyle(paintVars, { scale });
    if (clipPath) {
      paint.borderRadius = '0px';
    } else if (!hasExplicitRadius && layer.type === 'ellipse') {
      paint.borderRadius = '50%';
    }
    if (moving || panning) {
      const { filter: _filter, ...rest } = paint;
      if (moving) {
        const { boxShadow: _shadow, ...rest2 } = rest;
        paint = rest2;
      } else {
        const { boxShadow, ...rest2 } = rest;
        const kept = boxShadow ? keepSpreadOnlyShadows(boxShadow) : '';
        paint = kept ? { ...rest2, boxShadow: kept } : rest2;
      }
    }
    paintCacheRef.current = { key: paintCacheKey, paint };
  }

  const { transform: _paintTransform, ...paintRest } = paint;

  const style: CSSProperties = {
    ...paintRest,
    contain: 'layout paint',
    letterSpacing: paintRest.letterSpacing || 'normal',
    position: 'absolute',
    left: 0,
    top: 0,
    transform: geometry.transform,
    transformOrigin: geometry.transformOrigin,
    willChange: moving ? 'transform' : undefined,
    width: geometry.widthPx,
    height: geometry.heightPx,
    boxSizing: 'border-box',
    overflow: isLine ? 'visible' : 'hidden',
    cursor: editing
      ? 'text'
      : !interactive || layer.locked
        ? 'default'
        : 'move',
    clipPath,
    display: 'flex',
    alignItems:
      layer.type === 'text' || layer.type === 'field'
        ? (layer.cssVars['--text-valign'] as CSSProperties['alignItems']) || 'center'
        : 'center',
    justifyContent: justifyContentForTextAlign(textAlign),
    padding:
      layer.type === 'text' || layer.type === 'field' ? `${2 * scale}px ${6 * scale}px` : 0,
    userSelect: editing ? 'text' : 'none',
    zIndex: highlighted ? 20 : 1,
    pointerEvents:
      (layer.type === 'group' || layer.type === 'grid' || layer.type === 'component') && !selected
        ? 'none'
        : interactive || editing
          ? 'auto'
          : 'none',
    mixBlendMode: (layer.cssVars['--blend-mode'] as CSSProperties['mixBlendMode']) || undefined,
  };

  if (selected || editing || pathEditing) {
    if (paint.outline) {
      style.boxShadow = [paint.boxShadow, '0 0 0 1px var(--cv-accent)'].filter(Boolean).join(',');
    } else {
      style.outline = '1px solid var(--cv-accent)';
    }
  }

  let label = layer.value || layer.name;
  if (layer.type === 'field') label = fieldDesignLabel(layer);
  else if (layer.type === 'logo') label = `Logo ${layer.meta?.side === 'right' ? 'R' : 'L'}`;
  else if (layer.type === 'imageSlot') label = `Foto ${(layer.meta?.index ?? 0) + 1}`;
  else if (
    layer.type === 'rect' ||
    layer.type === 'line' ||
    layer.type === 'ellipse' ||
    layer.type === 'arrow' ||
    layer.type === 'polygon' ||
    layer.type === 'diamond' ||
    layer.type === 'hexagon' ||
    layer.type === 'pentagon' ||

    layer.type === 'star' ||
    layer.type === 'checkbox' ||
    layer.type === 'signature' ||
    layer.type === 'table'
  )
    label = '';
  else if (layer.type === 'grid') label = `Grid ${layer.meta?.cols ?? 2}×${layer.meta?.rows ?? 2}`;
  else if (layer.type === 'group') label = 'Grupo';
  else if (layer.type === 'component') label = layer.meta?.instanceOf ? 'Instancia' : 'Componente';
  else if (layer.type === 'boolean') label = '';
  else if (layer.type === 'image') label = layer.value ? '' : 'Imagen';

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (editing) {
      e.stopPropagation();
      return;
    }
    if (!interactive) return;
    if (e.button === 1) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    onLayerPointerDownRef.current(layer.id, e.shiftKey || e.ctrlKey || e.metaKey, e);
  };

  const isChromePlaceholder =
    layer.type === 'imageSlot' || layer.type === 'logo' || layer.type === 'grid';

  const textInnerStyle: CSSProperties = {
    width: '100%',
    lineHeight,
    whiteSpace: 'pre-wrap',
    fontFamily: layer.cssVars['--font-family'] || DEFAULT_LAYER_FONT,
    fontSize: 'inherit',
    color: 'inherit',
    textAlign: (textAlign as CSSProperties['textAlign']) || 'left',
    fontStyle: (layer.cssVars['--font-style'] as CSSProperties['fontStyle']) || undefined,
    textDecoration: (layer.cssVars['--text-decoration'] as CSSProperties['textDecoration']) || undefined,
    letterSpacing: layer.cssVars['--letter-spacing'] || 'normal',
    textTransform: (layer.cssVars['--text-transform'] as CSSProperties['textTransform']) || undefined,
  };

  const tablePreview = layer.type === 'table' ? parseTableData(layer.meta?.rowsData) : null;
  const signatureName = layer.type === 'signature' ? layer.value || 'Firma' : '';
  const checkboxMark = layer.type === 'checkbox' && layer.meta?.checked ? '✓' : '';

  return (
    <div
      data-layer-id={layer.id}
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        if (!interactive || editing) return;
        if (layer.type === 'group' || layer.type === 'grid') {
          e.stopPropagation();
          e.preventDefault();
          onStartEditRef.current?.(layer.id);
          return;
        }
        if (layer.type === 'line') {
          e.stopPropagation();
          e.preventDefault();
          onStartPathEditRef.current?.(layer.id);
          return;
        }
        if (!canEditText && !canEditField) return;
        e.stopPropagation();
        e.preventDefault();
        onStartEditRef.current?.(layer.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelectRef.current(layer.id, false);
        onContextMenuRef.current?.(layer.id, e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        if (!interactive || editing) return;
        if (e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          onSelectRef.current(layer.id, e.shiftKey || e.ctrlKey || e.metaKey);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          onSelectRef.current(layer.id, false);
          if (layer.type === 'group' || layer.type === 'grid') {
            onStartEditRef.current?.(layer.id);
            return;
          }
          if (layer.type === 'line') {
            onStartPathEditRef.current?.(layer.id);
            return;
          }
          if (canEditText || canEditField) onStartEditRef.current?.(layer.id);
        }
      }}
      role="button"
      tabIndex={0}
    >
      {editing && layer.type === 'text' ? (
        <textarea
          ref={editorRef}
          data-testid="canvas-inline-editor"
          value={layer.value}
          aria-label="Editar texto"
          spellCheck={false}
          onChange={(e) => onEditValueRef.current?.(layer.id, e.target.value, e.target.scrollHeight)}
          onBlur={() => finishEdit()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') {
              e.preventDefault();
              finishEdit();
              return;
            }
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              finishEdit();
            }
          }}
          style={{
            width: '100%',
            height: '100%',
            margin: 0,
            padding: 0,
            border: 'none',
            outline: 'none',
            resize: 'none',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            fontSize: 'inherit',
            fontFamily: 'inherit',
            fontWeight: 'inherit',
            fontStyle: 'inherit',
            textDecoration: 'inherit',
            letterSpacing: 'inherit',
            textTransform: 'inherit',
            textAlign: (textAlign as CSSProperties['textAlign']) || 'left',
            lineHeight,
            whiteSpace: 'pre-wrap',
            overflow: 'hidden',
            boxSizing: 'border-box',
            cursor: 'text',
          }}
        />
      ) : layer.type === 'boolean' && booleanRender ? (
        <div
          data-testid="canvas-boolean-stack"
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            isolation: 'isolate',
            pointerEvents: 'none',
          }}
        >
          {booleanRender.order.map((item) => (
            <div
              key={item.layerId}
              data-boolean-operand={item.layerId}
              style={{
                position: 'absolute',
                left: mmToScreenPx(item.offsetXMm, scale),
                top: mmToScreenPx(item.offsetYMm, scale),
                width: mmToScreenPx(item.widthMm, scale),
                height: mmToScreenPx(item.heightMm, scale),
                backgroundColor: item.inverted
                  ? '#000000'
                  : item.backgroundColor || layer.cssVars['--background-color'] || '#ffffff',
                clipPath: item.clipPath,
                mixBlendMode: (item.blendMode as CSSProperties['mixBlendMode']) || undefined,
                opacity: item.inverted ? 1 : undefined,
              }}
            />
          ))}
        </div>
      ) : layer.type === 'image' && layer.value ? (
        <img
          src={getBlobUrl(layer.value)}
          alt=""
          draggable={false}
          decoding="async"
          loading="lazy"
          style={imgStyleFromCssVars(layer.cssVars)}
        />
      ) : layer.type === 'line' ? (
        <div
          data-testid="canvas-line-svg"
          style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
          dangerouslySetInnerHTML={{ __html: lineSvg }}
        />
      ) : layer.type === 'rect' ||
        layer.type === 'ellipse' ||
        layer.type === 'arrow' ||
        layer.type === 'polygon' ||
        layer.type === 'star' ||
        layer.type === 'diamond' ||
        layer.type === 'hexagon' ||
        layer.type === 'pentagon' ? null : layer.type === 'checkbox' ? (
        <div
          data-testid="canvas-checkbox-mark"
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 'inherit',
            color: 'inherit',
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        >
          {checkboxMark}
        </div>
      ) : layer.type === 'signature' ? (
        <div
          data-testid="canvas-signature-preview"
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            padding: `${Math.max(1, scale)}px`,
            boxSizing: 'border-box',
            color: 'inherit',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              borderTop: '1px solid currentColor',
              paddingTop: `${Math.max(1, scale)}px`,
              fontSize: 'inherit',
              textAlign: 'center',
            }}
          >
            {signatureName}
          </div>
        </div>
      ) : layer.type === 'table' && tablePreview ? (
        <table
          data-testid="canvas-table-preview"
          style={{
            width: '100%',
            height: '100%',
            borderCollapse: 'collapse',
            tableLayout: 'fixed',
            fontSize: 'inherit',
            color: 'inherit',
            pointerEvents: 'none',
          }}
        >
          <tbody>
            {tablePreview.cells.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      border: `1px solid ${layer.cssVars['--border-color'] || '#cbd5e1'}`,
                      padding: `${Math.max(1, scale)}px ${Math.max(2, 2 * scale)}px`,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : layer.type === 'field' ? (
        <span style={textInnerStyle}>{label}</span>
      ) : isChromePlaceholder ? (
        <span
          style={{
            width: '100%',
            textAlign: 'center',
            fontSize: 10 * scale,
            color: '#94a3b8',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          {label}
        </span>
      ) : layer.type === 'text' ? (
        <span style={textInnerStyle}>{label}</span>
      ) : (
        <span style={{ width: '100%', lineHeight, whiteSpace: 'pre-wrap' }}>{label}</span>
      )}
    </div>
  );
}

export function layerNeedsDocumentLayers(layer: CanvasLayer): boolean {
  return layer.type === 'boolean' || Boolean(layer.meta?.maskLayerId);
}

function documentLayerDependencyIds(layer: CanvasLayer): string[] {
  const ids: string[] = [];
  const maskId = layer.meta?.maskLayerId;
  if (maskId) ids.push(maskId);
  if (layer.type === 'boolean' && layer.meta?.ops?.length) {
    for (const op of layer.meta.ops) {
      if (op.layerId) ids.push(op.layerId);
    }
  }
  return ids;
}

export function documentLayersRelevantEqual(
  layer: CanvasLayer,
  prevLayers: CanvasLayer[] | undefined,
  nextLayers: CanvasLayer[] | undefined,
): boolean {
  if (prevLayers === nextLayers) return true;
  if (!layerNeedsDocumentLayers(layer)) return true;
  const prev = prevLayers ?? [];
  const next = nextLayers ?? [];
  const ids = documentLayerDependencyIds(layer);
  if (ids.length === 0) return true;
  for (const id of ids) {
    if (prev.find((l) => l.id === id) !== next.find((l) => l.id === id)) return false;
  }
  return true;
}

export default memo(LayerNode, (prev, next) =>
  prev.layer === next.layer &&
  prev.masterLayer === next.masterLayer &&
  documentLayersRelevantEqual(next.layer, prev.documentLayers, next.documentLayers) &&
  prev.selected === next.selected &&
  prev.interactive === next.interactive &&
  prev.scale === next.scale &&
  prev.editing === next.editing &&
  prev.editingSelectAll === next.editingSelectAll &&
  prev.pathEditing === next.pathEditing &&
  prev.moving === next.moving &&
  prev.offscreen === next.offscreen &&
  prev.panning === next.panning,
);
