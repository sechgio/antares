import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import type { CanvasDocument, CanvasLayer, CanvasTool } from '../types';
import { A4_HEIGHT_PX, A4_WIDTH_PX } from '../types';
import {
  clientToMm,
  isClickPlace,
  isPlaceTool,
  mmToScreenPx,
  MM_TO_PX,
  normalizeDrawRect,
  type DrawRect,
} from '../ops/drawHelpers';
import { clipPathForLayerType } from '../ops/shapePaths';
import {
  angleFromCenter,
  isPointerClick,
  layersInMarquee,
  moveSelection,
  resizeSelection,
  rotateSelection,
  selectionBounds,
  snapMoveWithGuides,
  type HandlePos,
  type RectMm,
  type SmartGuide,
} from '../ops/selectionTransform';
import { wheelZoomFactor, zoomAtCursor } from '../ops/viewportNav';
import LayerNode from './LayerNode';

const HANDLE = 8;
const ROTATE_HANDLE_OFFSET = 24;

interface ArtboardProps {
  document: CanvasDocument;
  selectedIds: string[];
  zoom: number;
  tool: CanvasTool;
  pan: { x: number; y: number };
  editingLayerId?: string | null;
  onPan: (pan: { x: number; y: number }) => void;
  onSelect: (id: string | null, additive?: boolean) => void;
  onSelectIds: (ids: string[]) => void;
  onChangeLayers: (layers: CanvasLayer[]) => void;
  /** Live gesture updates (no undo). Pair with onCommitGesture on pointerup. */
  onPreviewLayers?: (layers: CanvasLayer[]) => void;
  onCommitGesture?: () => void;
  onZoom?: (zoom: number) => void;
  onDrawLayer?: (tool: CanvasTool, rect: DrawRect) => void;
  onContextMenu?: (layerId: string | null, clientX: number, clientY: number) => void;
  onStartEdit?: (id: string) => void;
  onEditValue?: (id: string, value: string) => void;
  onFitTextHeight?: (id: string, contentHeightPx: number) => void;
  onCommitEdit?: () => void;
  editingSelectAll?: boolean;
}

function handleStyle(left: number, top: number, cursor: string): CSSProperties {
  return {
    position: 'absolute',
    left,
    top,
    width: HANDLE,
    height: HANDLE,
    marginLeft: -HANDLE / 2,
    marginTop: -HANDLE / 2,
    background: '#fff',
    border: '1.5px solid #18a0fb',
    borderRadius: 1,
    zIndex: 40,
    cursor,
    boxSizing: 'border-box',
  };
}

function cloneLayers(layers: CanvasLayer[]): CanvasLayer[] {
  return layers.map((l) => ({ ...l, cssVars: { ...l.cssVars }, meta: l.meta ? { ...l.meta } : undefined }));
}

export default function Artboard({
  document,
  selectedIds,
  zoom,
  tool,
  pan,
  editingLayerId = null,
  onPan,
  onSelect,
  onSelectIds,
  onChangeLayers,
  onPreviewLayers,
  onCommitGesture,
  onZoom,
  onDrawLayer,
  onContextMenu,
  onStartEdit,
  onEditValue,
  onFitTextHeight,
  onCommitEdit,
  editingSelectAll = true,
}: ArtboardProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const drawStart = useRef<{ xMm: number; yMm: number } | null>(null);
  const [draft, setDraft] = useState<DrawRect | null>(null);
  const [marquee, setMarquee] = useState<RectMm | null>(null);
  const [guides, setGuides] = useState<SmartGuide[]>([]);
  const [panning, setPanning] = useState(false);
  const didFit = useRef(false);
  const gestureDirtyRef = useRef(false);

  const applyGestureLayers = (layers: CanvasLayer[]) => {
    gestureDirtyRef.current = true;
    if (onPreviewLayers) onPreviewLayers(layers);
    else onChangeLayers(layers);
  };

  const endGesture = () => {
    if (gestureDirtyRef.current) {
      onCommitGesture?.();
      gestureDirtyRef.current = false;
    }
  };
  const navRef = useRef({ zoom, pan, onZoom, onPan });
  navRef.current = { zoom, pan, onZoom, onPan };
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const layersRef = useRef(document.layers);
  layersRef.current = document.layers;

  const displayLayers = document.layers;
  const contentLayers = displayLayers.filter((l) => l.type !== 'frame' && l.visible !== false);
  const interactive = tool === 'select';
  const placing = isPlaceTool(tool);
  const canPanTool = tool === 'hand';

  const editableSelected = selectedIds.filter((id) => {
    const layer = displayLayers.find((l) => l.id === id);
    return layer && layer.type !== 'frame' && !layer.locked && layer.visible !== false;
  });
  const bbox = selectionBounds(displayLayers, editableSelected);

  useEffect(() => {
    if (didFit.current || !onZoom || !viewportRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || didFit.current) return;
      const { width, height } = entry.contentRect;
      if (width < 40 || height < 40) return;
      const pad = 48;
      const fit = Math.min((width - pad) / A4_WIDTH_PX, (height - pad) / A4_HEIGHT_PX, 1);
      onZoom(Math.max(0.35, Math.round(fit * 100) / 100));
      onPan({ x: 0, y: 0 });
      didFit.current = true;
    });
    ro.observe(viewportRef.current);
    return () => ro.disconnect();
  }, [onZoom, onPan]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const { zoom: z, pan: p, onZoom: setZ, onPan: setP } = navRef.current;
      const rect = el.getBoundingClientRect();
      const cursor = {
        x: e.clientX - rect.left - rect.width / 2,
        y: e.clientY - rect.top - rect.height / 2,
      };

      if (e.ctrlKey || e.metaKey) {
        const factor = wheelZoomFactor(e.deltaY, true);
        const next = zoomAtCursor(z, p, cursor, z * factor);
        setZ?.(next.zoom);
        setP(next.pan);
        return;
      }

      setP({ x: p.x - e.deltaX, y: p.y - e.deltaY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const startPanDrag = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPanning(true);
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { ...navRef.current.pan };

    const onMovePtr = (ev: PointerEvent) => {
      navRef.current.onPan({
        x: origin.x + (ev.clientX - startX),
        y: origin.y + (ev.clientY - startY),
      });
    };
    const onUp = () => {
      setPanning(false);
      window.removeEventListener('pointermove', onMovePtr);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMovePtr);
    window.addEventListener('pointerup', onUp);
  };

  const pageSize = { widthMm: document.page.widthMm, heightMm: document.page.heightMm };

  const beginSelectionMove = (ids: string[], startClientX: number, startClientY: number) => {
    const snapshot = cloneLayers(layersRef.current);
    gestureDirtyRef.current = false;
    let dragging = false;

    const onMovePtr = (ev: PointerEvent) => {
      const dxPx = ev.clientX - startClientX;
      const dyPx = ev.clientY - startClientY;
      if (!dragging) {
        if (isPointerClick(dxPx, dyPx)) return;
        dragging = true;
      }
      const rawDx = dxPx / (zoom * MM_TO_PX);
      const rawDy = dyPx / (zoom * MM_TO_PX);
      const snapped = snapMoveWithGuides(snapshot, ids, rawDx, rawDy, pageSize);
      setGuides(snapped.guides);
      applyGestureLayers(moveSelection(snapshot, ids, snapped.dx, snapped.dy));
    };
    const onUp = () => {
      setGuides([]);
      endGesture();
      window.removeEventListener('pointermove', onMovePtr);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMovePtr);
    window.addEventListener('pointerup', onUp);
  };

  const onLayerPointerDown = (id: string, additive: boolean, e: ReactPointerEvent) => {
    if (editingLayerId) {
      if (id === editingLayerId) return;
      onCommitEdit?.();
    }
    const current = selectedIdsRef.current;
    let ids: string[];
    if (additive) {
      ids = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      onSelectIds(ids);
      return;
    }
    if (current.includes(id) && current.length > 1) {
      ids = current;
    } else {
      ids = [id];
      onSelect(id, false);
    }

    const layer = layersRef.current.find((l) => l.id === id);
    if (!layer || layer.locked) return;
    const moveIds = ids.filter((sid) => {
      const l = layersRef.current.find((x) => x.id === sid);
      return l && !l.locked && l.type !== 'frame';
    });
    if (!moveIds.length) return;
    beginSelectionMove(moveIds, e.clientX, e.clientY);
  };

  const startResize = (e: ReactPointerEvent<HTMLDivElement>, corner: HandlePos) => {
    e.stopPropagation();
    e.preventDefault();
    if (!editableSelected.length) return;
    const snapshot = cloneLayers(layersRef.current);
    const startX = e.clientX;
    const startY = e.clientY;
    const ids = [...editableSelected];
    gestureDirtyRef.current = false;

    const onMovePtr = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / (zoom * MM_TO_PX);
      const dy = (ev.clientY - startY) / (zoom * MM_TO_PX);
      applyGestureLayers(resizeSelection(snapshot, ids, corner, dx, dy, { aspectLock: ev.shiftKey }));
    };
    const onUp = () => {
      endGesture();
      window.removeEventListener('pointermove', onMovePtr);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMovePtr);
    window.addEventListener('pointerup', onUp);
  };

  const startRotate = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (!bbox || !editableSelected.length || !frameRef.current) return;
    const snapshot = cloneLayers(layersRef.current);
    const ids = [...editableSelected];
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    const rect = frameRef.current.getBoundingClientRect();
    const start = clientToMm(e.clientX, e.clientY, rect, zoom);
    const startAngle = angleFromCenter(cx, cy, start.xMm, start.yMm);
    gestureDirtyRef.current = false;

    const onMovePtr = (ev: PointerEvent) => {
      if (!frameRef.current) return;
      const r = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, r, zoom);
      const angle = angleFromCenter(cx, cy, cur.xMm, cur.yMm);
      const delta = angle - startAngle;
      applyGestureLayers(rotateSelection(snapshot, ids, delta, { snap15: ev.shiftKey }));
    };
    const onUp = () => {
      endGesture();
      window.removeEventListener('pointermove', onMovePtr);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMovePtr);
    window.addEventListener('pointerup', onUp);
  };

  const beginMarquee = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!frameRef.current) return;
    if (editingLayerId) {
      onCommitEdit?.();
    }
    e.stopPropagation();
    e.preventDefault();
    const rect = frameRef.current.getBoundingClientRect();
    const { xMm, yMm } = clientToMm(e.clientX, e.clientY, rect, zoom);
    const origin = { xMm, yMm };
    setMarquee({ x: xMm, y: yMm, w: 0, h: 0 });
    if (!e.shiftKey) onSelectIds([]);

    const onMovePtr = (ev: PointerEvent) => {
      if (!frameRef.current) return;
      const r = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, r, zoom);
      const x = Math.min(origin.xMm, cur.xMm);
      const y = Math.min(origin.yMm, cur.yMm);
      setMarquee({
        x,
        y,
        w: Math.abs(cur.xMm - origin.xMm),
        h: Math.abs(cur.yMm - origin.yMm),
      });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMovePtr);
      window.removeEventListener('pointerup', onUp);
      if (!frameRef.current) {
        setMarquee(null);
        return;
      }
      const r = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, r, zoom);
      const box: RectMm = {
        x: Math.min(origin.xMm, cur.xMm),
        y: Math.min(origin.yMm, cur.yMm),
        w: Math.abs(cur.xMm - origin.xMm),
        h: Math.abs(cur.yMm - origin.yMm),
      };
      setMarquee(null);
      if (box.w < 1 && box.h < 1) {
        if (!ev.shiftKey) onSelect(null);
        return;
      }
      const hit = layersInMarquee(layersRef.current, box);
      if (ev.shiftKey) {
        const merged = Array.from(new Set([...selectedIdsRef.current, ...hit]));
        onSelectIds(merged);
      } else {
        onSelectIds(hit);
      }
    };
    window.addEventListener('pointermove', onMovePtr);
    window.addEventListener('pointerup', onUp);
  };

  const beginDraw = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!placing || !onDrawLayer || !frameRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = frameRef.current.getBoundingClientRect();
    const { xMm, yMm } = clientToMm(e.clientX, e.clientY, rect, zoom);
    drawStart.current = { xMm, yMm };
    setDraft({ x: xMm, y: yMm, w: 0, h: 0 });

    const onMovePtr = (ev: PointerEvent) => {
      if (!drawStart.current || !frameRef.current) return;
      const r = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, r, zoom);
      const constrainSquare =
        ev.shiftKey && (tool === 'rect' || tool === 'ellipse' || tool === 'polygon' || tool === 'star');
      setDraft(
        normalizeDrawRect(drawStart.current.xMm, drawStart.current.yMm, cur.xMm, cur.yMm, {
          constrainSquare,
        }),
      );
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMovePtr);
      window.removeEventListener('pointerup', onUp);
      if (!drawStart.current || !frameRef.current) {
        setDraft(null);
        return;
      }
      const r = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, r, zoom);
      let result = normalizeDrawRect(drawStart.current.xMm, drawStart.current.yMm, cur.xMm, cur.yMm, {
        constrainSquare:
          ev.shiftKey && (tool === 'rect' || tool === 'ellipse' || tool === 'polygon' || tool === 'star'),
      });
      if (isClickPlace(result)) {
        result = { x: drawStart.current.xMm, y: drawStart.current.yMm, w: 0, h: 0 };
      }
      drawStart.current = null;
      setDraft(null);
      onDrawLayer(tool, result);
    };

    window.addEventListener('pointermove', onMovePtr);
    window.addEventListener('pointerup', onUp);
  };

  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button === 1) {
      startPanDrag(e);
      return;
    }
    if (e.button !== 0) return;
    if (canPanTool) {
      startPanDrag(e);
      return;
    }
  };

  // Integer CSS px — fractional frame size + CSS transform pan promotes a soft compositor layer.
  const frameW = Math.round(A4_WIDTH_PX * zoom);
  const frameH = Math.round(A4_HEIGHT_PX * zoom);
  const panX = Math.round(pan.x);
  const panY = Math.round(pan.y);
  const selX = bbox ? mmToScreenPx(bbox.x, zoom) : 0;
  const selY = bbox ? mmToScreenPx(bbox.y, zoom) : 0;
  const selW = bbox ? mmToScreenPx(bbox.w, zoom) : 0;
  const selH = bbox ? mmToScreenPx(bbox.h, zoom) : 0;
  const rotateHandleX = selX + selW / 2;
  const rotateHandleY = selY - ROTATE_HANDLE_OFFSET;

  const cursor = panning ? 'grabbing' : canPanTool ? 'grab' : placing ? 'crosshair' : 'default';

  return (
    <div
      ref={viewportRef}
      className="canvas-dot-bg absolute inset-0 overflow-hidden"
      data-testid="canvas-viewport"
      style={{ cursor, touchAction: 'none' }}
      onPointerDown={onCanvasPointerDown}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(null, e.clientX, e.clientY);
      }}
    >
      <div
        data-testid="canvas-pan-layer"
        style={{
          position: 'absolute',
          left: `calc(50% + ${panX}px)`,
          top: `calc(50% + ${panY}px)`,
          width: frameW,
          height: frameH,
          marginLeft: -frameW / 2,
          marginTop: -frameH / 2,
        }}
      >
        <div
          ref={frameRef}
          data-testid="canvas-artboard"
          style={{
            position: 'relative',
            width: frameW,
            height: frameH,
            background: '#ffffff',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.08), 0 12px 40px rgba(0,0,0,0.14)',
            cursor: canPanTool || panning ? cursor : placing ? 'crosshair' : 'default',
          }}
          onPointerDown={(e) => {
            if (e.button === 1 || canPanTool) {
              startPanDrag(e);
              return;
            }
            if (placing) {
              beginDraw(e);
              return;
            }
            if (tool === 'select' && e.button === 0) {
              beginMarquee(e);
            }
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: -22,
              left: 0,
              fontSize: 11,
              color: '#8c8c8c',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            Página A4 — 210 × 297 mm · {Math.round(zoom * 100)}%
            {placing && (
              <span style={{ marginLeft: 8, color: '#18a0fb' }}>· Arrastra para dibujar</span>
            )}
            {editableSelected.length > 1 && (
              <span style={{ marginLeft: 8, color: '#18a0fb' }}>
                · {editableSelected.length} seleccionados
              </span>
            )}
          </div>

          {contentLayers.map((layer) => (
            <LayerNode
              key={layer.id}
              layer={layer}
              selected={selectedIds.includes(layer.id)}
              interactive={interactive && !panning}
              editing={editingLayerId === layer.id}
              editingSelectAll={editingSelectAll}
              scale={zoom}
              onSelect={(id, additive) => onSelect(id, additive)}
              onLayerPointerDown={(id, additive, ev) => onLayerPointerDown(id, additive, ev)}
              onContextMenu={onContextMenu}
              onStartEdit={onStartEdit}
              onEditValue={onEditValue}
              onFitTextHeight={onFitTextHeight}
              onCommitEdit={onCommitEdit}
            />
          ))}

          {guides.map((g) =>
            g.axis === 'x' ? (
              <div
                key={`gx-${g.pos}`}
                data-testid="canvas-smart-guide"
                style={{
                  position: 'absolute',
                  left: mmToScreenPx(g.pos, zoom),
                  top: 0,
                  width: 1,
                  height: '100%',
                  background: '#f12dd2',
                  pointerEvents: 'none',
                  zIndex: 45,
                }}
              />
            ) : (
              <div
                key={`gy-${g.pos}`}
                data-testid="canvas-smart-guide"
                style={{
                  position: 'absolute',
                  top: mmToScreenPx(g.pos, zoom),
                  left: 0,
                  height: 1,
                  width: '100%',
                  background: '#f12dd2',
                  pointerEvents: 'none',
                  zIndex: 45,
                }}
              />
            ),
          )}

          {marquee && marquee.w + marquee.h > 0 && (
            <div
              data-testid="canvas-marquee"
              style={{
                position: 'absolute',
                left: mmToScreenPx(marquee.x, zoom),
                top: mmToScreenPx(marquee.y, zoom),
                width: Math.max(mmToScreenPx(marquee.w, zoom), 1),
                height: Math.max(mmToScreenPx(marquee.h, zoom), 1),
                border: '1px solid #18a0fb',
                background: 'rgba(24,160,251,0.08)',
                pointerEvents: 'none',
                zIndex: 50,
                boxSizing: 'border-box',
              }}
            />
          )}

          {draft && draft.w + draft.h > 0 && (
            <div
              data-testid="canvas-draw-draft"
              style={{
                position: 'absolute',
                left: mmToScreenPx(draft.x, zoom),
                top: mmToScreenPx(draft.y, zoom),
                width: Math.max(mmToScreenPx(draft.w, zoom), 1),
                height: Math.max(mmToScreenPx(draft.h, zoom), 1),
                border: '1.5px solid #18a0fb',
                background: 'rgba(24,160,251,0.08)',
                borderRadius: tool === 'ellipse' ? '50%' : 0,
                clipPath: clipPathForLayerType(tool),
                pointerEvents: 'none',
                zIndex: 50,
                boxSizing: 'border-box',
              }}
            />
          )}

          {bbox && interactive && !panning && !editingLayerId && (
            <>
              <div
                style={{
                  position: 'absolute',
                  left: selX,
                  top: selY,
                  width: selW,
                  height: selH,
                  outline: '1.5px solid #18a0fb',
                  pointerEvents: 'none',
                  zIndex: 30,
                  boxSizing: 'border-box',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: rotateHandleX,
                  top: selY,
                  width: 1,
                  height: ROTATE_HANDLE_OFFSET,
                  marginLeft: -0.5,
                  background: '#18a0fb',
                  pointerEvents: 'none',
                  zIndex: 39,
                }}
              />
              <WithHoverTooltip
                label="Rotar"
                shortcut="Shift · 15°"
                placement="top"
                variant="dark"
                className="!absolute"
                style={{
                  left: rotateHandleX,
                  top: rotateHandleY,
                  width: HANDLE,
                  height: HANDLE,
                  marginLeft: -HANDLE / 2,
                  marginTop: -HANDLE / 2,
                  zIndex: 40,
                }}
              >
                <div
                  data-testid="canvas-rotate-handle"
                  aria-label="Rotar"
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: '50%',
                    background: '#18a0fb',
                    border: '1.5px solid #fff',
                    cursor: 'grab',
                    boxSizing: 'border-box',
                  }}
                  onPointerDown={startRotate}
                />
              </WithHoverTooltip>
              {(
                [
                  ['nw', selX, selY, 'nwse-resize'],
                  ['n', selX + selW / 2, selY, 'ns-resize'],
                  ['ne', selX + selW, selY, 'nesw-resize'],
                  ['e', selX + selW, selY + selH / 2, 'ew-resize'],
                  ['se', selX + selW, selY + selH, 'nwse-resize'],
                  ['s', selX + selW / 2, selY + selH, 'ns-resize'],
                  ['sw', selX, selY + selH, 'nesw-resize'],
                  ['w', selX, selY + selH / 2, 'ew-resize'],
                ] as const
              ).map(([pos, left, top, cursorName]) => (
                <div
                  key={pos}
                  style={handleStyle(left, top, cursorName)}
                  onPointerDown={(ev) => startResize(ev, pos)}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
