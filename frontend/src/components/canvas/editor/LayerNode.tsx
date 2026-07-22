import { memo, useEffect, useMemo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { CanvasLayer } from '../types';
import { parseMm } from '../types';
import { mmToScreenPx, scaleCssLength } from '../ops/drawHelpers';
import {
  canFocusFieldBinding,
  canInlineEditLayer,
  fieldDesignLabel,
  justifyContentForTextAlign,
} from '../ops/inlineEdit';
import { clipPathForLayerType } from '../ops/shapePaths';
import {
  buildLayerTransform,
  parseImageZoom,
  resolveBorderRadius,
  resolveFillBackground,
  resolveFillColor,
  resolveFilter,
  resolveStrokeStyle,
  scaleBorderRadius,
} from '../ops/layerStyle';
import { ensureLinePath } from '../ops/pathGeometry';
import { buildLineSvgContent } from '../ops/lineSvg';

interface LayerNodeProps {
  layer: CanvasLayer;
  selected: boolean;
  interactive: boolean;
  scale: number;
  editing?: boolean;
  /** When true (default), focus selects all text; false keeps caret at end (type-to-edit). */
  editingSelectAll?: boolean;
  pathEditing?: boolean;
  onSelect: (id: string, additive?: boolean) => void;
  onLayerPointerDown: (id: string, additive: boolean, e: ReactPointerEvent<HTMLDivElement>) => void;
  onContextMenu?: (id: string, clientX: number, clientY: number) => void;
  onStartEdit?: (id: string) => void;
  onEditValue?: (id: string, value: string) => void;
  onFitTextHeight?: (id: string, contentHeightPx: number) => void;
  onCommitEdit?: () => void;
  onStartPathEdit?: (id: string) => void;
}

function LayerNode({
  layer,
  selected,
  interactive,
  scale,
  editing = false,
  editingSelectAll = true,
  pathEditing = false,
  onSelect,
  onLayerPointerDown,
  onContextMenu,
  onStartEdit,
  onEditValue,
  onFitTextHeight,
  onCommitEdit,
  onStartPathEdit,
}: LayerNodeProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  // Keep latest callbacks behind refs so memo can ignore handler identity without going stale.
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

  if (layer.type === 'frame' || layer.visible === false) return null;

  const x = parseMm(layer.cssVars['--translate-x']);
  const y = parseMm(layer.cssVars['--translate-y']);
  const w = parseMm(layer.cssVars['--width'], 10);
  const isLine = layer.type === 'line';
  const h = isLine
    ? parseMm(lineLayer.cssVars['--height'], parseMm(layer.cssVars['--height'], 2))
    : parseMm(layer.cssVars['--height'], 10);
  const clipPath = clipPathForLayerType(layer.type);
  const hasExplicitRadius = Boolean(
    layer.cssVars['--border-radius'] ||
      layer.cssVars['--radius-tl'] ||
      layer.cssVars['--radius-tr'] ||
      layer.cssVars['--radius-br'] ||
      layer.cssVars['--radius-bl'],
  );
  const radius = clipPath
    ? '0px'
    : !hasExplicitRadius && layer.type === 'ellipse'
      ? '50%'
      : scaleBorderRadius(resolveBorderRadius(layer.cssVars), scale) || '0px';
  const borderW = scaleCssLength(
    layer.cssVars['--border-width'] || (layer.cssVars['--border'] ? undefined : '0px'),
    scale,
  );
  const fontSize = scaleCssLength(layer.cssVars['--font-size'] || '11px', scale);
  const isGradientFill =
    !isLine &&
    (layer.cssVars['--fill-type'] === 'linear' || layer.cssVars['--fill-type'] === 'radial');
  const fill = isLine
    ? 'transparent'
    : isGradientFill
      ? resolveFillBackground(layer.cssVars)
      : resolveFillColor(layer.cssVars);
  const stroke = isLine ? {} : resolveStrokeStyle(layer.cssVars, borderW);
  const transform = buildLayerTransform(layer.cssVars);
  const layerFilter = resolveFilter(layer.cssVars);
  const textAlign = layer.cssVars['--text-align'];
  const lineHeight = layer.cssVars['--line-height'] || '1.2';
  const canEditText = canInlineEditLayer(layer);
  const canEditField = canFocusFieldBinding(layer);

  const shadowParts: string[] = [];
  if (layer.cssVars['--box-shadow'] && layer.cssVars['--box-shadow'] !== 'none') {
    shadowParts.push(layer.cssVars['--box-shadow']);
  }
  if (stroke.boxShadowExtra) shadowParts.push(stroke.boxShadowExtra);

  const style: CSSProperties = {
    position: 'absolute',
    left: mmToScreenPx(x, scale),
    top: mmToScreenPx(y, scale),
    width: mmToScreenPx(w, scale),
    height: mmToScreenPx(h, scale),
    boxSizing: 'border-box',
    overflow: isLine ? 'visible' : 'hidden',
    cursor: editing
      ? 'text'
      : !interactive || layer.locked
        ? 'default'
        : 'move',
    ...(isGradientFill
      ? { background: fill, backgroundColor: 'transparent' }
      : { backgroundColor: fill }),
    color: layer.cssVars['--color'] || '#1e1e1e',
    fontSize,
    fontFamily: layer.cssVars['--font-family'] || 'Segoe UI, Helvetica Neue, Arial, sans-serif',
    fontWeight: layer.cssVars['--font-weight'] as CSSProperties['fontWeight'],
    textAlign: (textAlign as CSSProperties['textAlign']) || 'left',
    opacity: layer.cssVars['--opacity']
      ? Number(layer.cssVars['--opacity']) / (Number(layer.cssVars['--opacity']) > 1 ? 100 : 1)
      : 1,
    borderRadius: radius,
    border: stroke.border || 'none',
    outline: stroke.outline || (selected || editing || pathEditing ? '1px solid #18a0fb' : undefined),
    outlineOffset: stroke.outlineOffset,
    filter: layerFilter,
    boxShadow: shadowParts.length ? shadowParts.join(',') : undefined,
    clipPath,
    transform,
    display: 'flex',
    alignItems: 'center',
    justifyContent: justifyContentForTextAlign(textAlign),
    padding:
      layer.type === 'text' || layer.type === 'field' ? `${2 * scale}px ${6 * scale}px` : 0,
    userSelect: editing ? 'text' : 'none',
    zIndex: selected || editing || pathEditing ? 20 : 1,
    pointerEvents:
      layer.type === 'group' && !selected
        ? 'none'
        : interactive || editing
          ? 'auto'
          : 'none',
  };

  if ((selected || editing || pathEditing) && stroke.outline) {
    style.boxShadow = [...(shadowParts.length ? shadowParts : []), '0 0 0 1px #18a0fb'].join(',');
  } else if ((selected || editing || pathEditing) && !stroke.outline) {
    style.outline = '1px solid #18a0fb';
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
    layer.type === 'star'
  )
    label = '';
  else if (layer.type === 'grid') label = `Grid ${layer.meta?.cols ?? 2}×${layer.meta?.rows ?? 2}`;
  else if (layer.type === 'group') label = 'Grupo';
  else if (layer.type === 'checkbox') label = layer.meta?.checked ? '☑' : '☐';
  else if (layer.type === 'signature') label = layer.value || 'Firma';
  else if (layer.type === 'table') label = 'Tabla';
  else if (layer.type === 'image') label = layer.value ? '' : 'Imagen';

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (editing) {
      e.stopPropagation();
      return;
    }
    if (!interactive) return;
    // Let middle-click bubble for viewport pan.
    if (e.button === 1) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    onLayerPointerDownRef.current(layer.id, e.shiftKey || e.ctrlKey || e.metaKey, e);
  };

  const isChromePlaceholder =
    layer.type === 'imageSlot' ||
    layer.type === 'logo' ||
    layer.type === 'grid' ||
    layer.type === 'table' ||
    layer.type === 'signature' ||
    layer.type === 'checkbox';

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
      role="button"
      tabIndex={0}
    >
      {editing && layer.type === 'text' ? (
        <textarea
          ref={editorRef}
          data-testid="canvas-inline-editor"
          value={layer.value}
          aria-label="Editar texto"
          onChange={(e) => onEditValueRef.current?.(layer.id, e.target.value)}
          onBlur={() => finishEdit()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            // Let Ctrl/Cmd+D bubble to CanvasView (window) for duplicate.
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
            textAlign: (textAlign as CSSProperties['textAlign']) || 'left',
            lineHeight,
            whiteSpace: 'pre-wrap',
            overflow: 'hidden',
            boxSizing: 'border-box',
            cursor: 'text',
          }}
        />
      ) : layer.type === 'image' && layer.value ? (
        <img
          src={layer.value}
          alt=""
          draggable={false}
          decoding="async"
          style={{
            width: '100%',
            height: '100%',
            objectFit: (layer.cssVars['--object-fit'] as CSSProperties['objectFit']) || 'cover',
            objectPosition: layer.cssVars['--object-position'] || '50% 50%',
            transform: (() => {
              const zoom = parseImageZoom(layer.cssVars);
              return zoom !== 1 ? `scale(${zoom})` : undefined;
            })(),
            transformOrigin: layer.cssVars['--object-position'] || '50% 50%',
            imageRendering: 'auto',
          }}
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
        layer.type === 'star' ? null : layer.type === 'field' ? (
        <span
          style={{
            width: '100%',
            lineHeight,
            whiteSpace: 'pre-wrap',
            fontFamily: layer.cssVars['--font-family'] || 'Segoe UI, Helvetica Neue, Arial, sans-serif',
            fontSize: 'inherit',
            color: 'inherit',
            textAlign: (textAlign as CSSProperties['textAlign']) || 'left',
          }}
        >
          {label}
        </span>
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
      ) : (
        <span style={{ width: '100%', lineHeight, whiteSpace: 'pre-wrap' }}>{label}</span>
      )}
    </div>
  );
}

export default memo(LayerNode, (prev, next) =>
  prev.layer === next.layer &&
  prev.selected === next.selected &&
  prev.interactive === next.interactive &&
  prev.scale === next.scale &&
  prev.editing === next.editing &&
  prev.editingSelectAll === next.editingSelectAll &&
  prev.pathEditing === next.pathEditing,
);
