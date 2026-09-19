import type { MutableRefObject, RefObject } from 'react';
import type { CanvasLayer } from '../types';
import { clientToMm } from '../ops/drawHelpers';
import { layersInMarquee, type RectMm } from '../ops/selectionTransform';
import { buildSpatialIndex } from '../ops/spatialIndex';
import { createGestureRaf } from '../ops/gestureRaf';
import type {
  PointerGestureOwner,
  PointerGestureSession,
} from '../ops/pointerGestureSession';
import { createFrameRectCache } from './frameRectCache';

const PAN_INERTIA_FRESH_MS = 80;

export function escapeToAbort(getSession: () => { abort: () => void }): (ev: KeyboardEvent) => void {
  return (ev) => {
    if (ev.key !== 'Escape') return;
    getSession().abort();
  };
}

interface ArtboardViewportGestureDeps {
  frameRef: RefObject<HTMLDivElement | null>;
  zoomRef: MutableRefObject<number>;
  layersRef: MutableRefObject<CanvasLayer[]>;
  navRef: MutableRefObject<{
    zoom: number;
    pan: { x: number; y: number };
    onZoom?: (zoom: number) => void;
    onPan: (pan: { x: number; y: number }) => void;
  }>;
  pinchGestureRef: MutableRefObject<boolean>;
  selectedIdsRef: MutableRefObject<string[]>;
  onExitGroupEditRef: MutableRefObject<(() => void) | undefined>;
  pointerGestures: PointerGestureOwner;
  editingLayerId?: string | null;
  onCommitEdit?: () => void;
  onCancelInertia?: () => void;
  onStartInertia?: (velocity: { vx: number; vy: number }) => void;
  onSelect: (id: string | null, additive?: boolean) => void;
  onSelectIds: (ids: string[]) => void;
  enteredDescendants: () => Set<string> | null;
  setPanning: (value: boolean) => void;
  setMarquee: (marquee: RectMm | null) => void;
}

interface PanPointerEvent {
  preventDefault: () => void;
  stopPropagation: () => void;
  clientX: number;
  clientY: number;
  pointerId: number;
  currentTarget: EventTarget | null;
}

export function createArtboardViewportGestures(deps: ArtboardViewportGestureDeps) {
  const {
    frameRef,
    zoomRef,
    layersRef,
    navRef,
    pinchGestureRef,
    selectedIdsRef,
    onExitGroupEditRef,
    pointerGestures,
    editingLayerId,
    onCommitEdit,
    onCancelInertia,
    onStartInertia,
    onSelect,
    onSelectIds,
    enteredDescendants,
    setPanning,
    setMarquee,
  } = deps;

  const startPanDrag = (e: PanPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onCancelInertia?.();
    setPanning(true);
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { ...navRef.current.pan };
    let lastX = e.clientX;
    let lastY = e.clientY;
    let lastT = performance.now();
    let vx = 0;
    let vy = 0;
    const pointerId = e.pointerId;
    const captureTarget = e.currentTarget as HTMLElement;
    let captured = false;
    if (typeof captureTarget.setPointerCapture === 'function') {
      try {
        captureTarget.setPointerCapture(pointerId);
        captured = true;
      } catch {
        captured = false;
      }
    }
    const releaseCapture = () => {
      if (!captured || typeof captureTarget.releasePointerCapture !== 'function') return;
      captured = false;
      try {
        captureTarget.releasePointerCapture(pointerId);
      } catch {
        // The browser may release capture before pointercancel/blur reaches React.
      }
    };

    const raf = createGestureRaf((ev: PointerEvent) => {
      navRef.current.onPan({
        x: origin.x + (ev.clientX - startX),
        y: origin.y + (ev.clientY - startY),
      });
    });
    pointerGestures.start({
      pointerId,
      onMove: (ev) => {
        if (pinchGestureRef.current) return;
        const now = performance.now();
        const dt = Math.max(1, now - lastT);
        const instantVx = (ev.clientX - lastX) / dt * 16;
        const instantVy = (ev.clientY - lastY) / dt * 16;
        vx = vx * 0.6 + instantVx * 0.4;
        vy = vy * 0.6 + instantVy * 0.4;
        lastX = ev.clientX;
        lastY = ev.clientY;
        lastT = now;
        raf.schedule(ev);
      },
      onEnd: () => {
        releaseCapture();
        raf.flush();
        setPanning(false);
        const velocityIsFresh = performance.now() - lastT <= PAN_INERTIA_FRESH_MS;
        if (
          !pinchGestureRef.current
          && velocityIsFresh
          && onStartInertia
          && (Math.abs(vx) > 1 || Math.abs(vy) > 1)
        ) {
          onStartInertia({ vx, vy });
        }
      },
      onAbort: () => {
        releaseCapture();
        raf.cancel();
        setPanning(false);
      },
    });
  };

  const beginMarquee = (e: {
    stopPropagation: () => void;
    preventDefault: () => void;
    clientX: number;
    clientY: number;
    shiftKey: boolean;
  }) => {
    if (!frameRef.current) return;
    if (editingLayerId) {
      onCommitEdit?.();
    }
    e.stopPropagation();
    e.preventDefault();
    const frameRect = createFrameRectCache(frameRef.current, zoomRef);
    const { xMm, yMm } = clientToMm(e.clientX, e.clientY, frameRect.read(), zoomRef.current);
    const origin = { xMm, yMm };
    setMarquee({ x: xMm, y: yMm, w: 0, h: 0 });
    if (!e.shiftKey) onSelectIds([]);

    const raf = createGestureRaf((ev: PointerEvent) => {
      const cur = clientToMm(ev.clientX, ev.clientY, frameRect.read(), zoomRef.current);
      if (pinchGestureRef.current) return;
      const x = Math.min(origin.xMm, cur.xMm);
      const y = Math.min(origin.yMm, cur.yMm);
      setMarquee({
        x,
        y,
        w: Math.abs(cur.xMm - origin.xMm),
        h: Math.abs(cur.yMm - origin.yMm),
      });
    });
    let session: PointerGestureSession;
    session = pointerGestures.start({
      onMove: (ev) => raf.schedule(ev),
      onEnd: (ev) => {
        raf.cancel();
        if (!ev) {
          setMarquee(null);
          return;
        }
        const cur = clientToMm(ev.clientX, ev.clientY, frameRect.read(), zoomRef.current);
        if (pinchGestureRef.current) {
          setMarquee(null);
          return;
        }
        const box: RectMm = {
          x: Math.min(origin.xMm, cur.xMm),
          y: Math.min(origin.yMm, cur.yMm),
          w: Math.abs(cur.xMm - origin.xMm),
          h: Math.abs(cur.yMm - origin.yMm),
        };
        setMarquee(null);
        const currentLayers = layersRef.current;
        const groupMembers = enteredDescendants();
        if (box.w < 1 && box.h < 1) {
          const hits = buildSpatialIndex(currentLayers).hitTest(cur.xMm, cur.yMm);
          const filtered = groupMembers ? hits.filter((h) => groupMembers.has(h)) : hits;
          const top = filtered[0];
          if (top) {
            if (ev.shiftKey) {
              const merged = Array.from(new Set([...selectedIdsRef.current, top]));
              onSelectIds(merged);
            } else {
              onSelect(top);
            }
          } else if (groupMembers) {
            onExitGroupEditRef.current?.();
            onSelect(null);
          } else if (!ev.shiftKey) {
            onSelect(null);
          }
          return;
        }
        let hit =
          currentLayers.length > 30
            ? buildSpatialIndex(currentLayers).query(box)
            : layersInMarquee(currentLayers, box);
        if (groupMembers) hit = hit.filter((id) => groupMembers.has(id));
        if (ev.shiftKey) {
          const merged = Array.from(new Set([...selectedIdsRef.current, ...hit]));
          onSelectIds(merged);
        } else {
          onSelectIds(hit);
        }
      },
      onKeyDown: escapeToAbort(() => session),
      onAbort: () => {
        raf.cancel();
        setMarquee(null);
      },
    });
  };

  return { startPanDrag, beginMarquee };
}
