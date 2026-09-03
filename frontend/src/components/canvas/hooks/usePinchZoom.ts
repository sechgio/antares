import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { createGestureRaf } from '../ops/gestureRaf';
import { pinchViewport } from '../ops/viewportNav';

interface PinchNav {
  zoom: number;
  pan: { x: number; y: number };
  onZoom?: (zoom: number) => void;
  onPan?: (pan: { x: number; y: number }) => void;
}

interface UsePinchZoomOptions {
  onStart?: () => void;
  activeRef?: MutableRefObject<boolean>;
}

export function usePinchZoom(
  viewportRef: RefObject<HTMLElement | null>,
  navRef: MutableRefObject<PinchNav>,
  options?: UsePinchZoomOptions,
) {
  const onStartRef = useRef(options?.onStart);
  onStartRef.current = options?.onStart;
  const activeRef = options?.activeRef;

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let start: {
      zoom: number;
      pan: { x: number; y: number };
      dist: number;
      mid: { x: number; y: number };
    } | null = null;
    let pinched = false;
    let viewportRect: DOMRect | null = null;

    const setActive = (value: boolean) => {
      if (activeRef) activeRef.current = value;
    };

    const centerRelative = (clientX: number, clientY: number) => {
      const rect = viewportRect ?? el.getBoundingClientRect();
      return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
    };

    const fingerPair = () => {
      const pts = [...pointers.values()];
      return pts.length >= 2 ? ([pts[0], pts[1]] as const) : null;
    };

    const midpointOf = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      centerRelative((a.x + b.x) / 2, (a.y + b.y) / 2);

    const beginPinch = () => {
      const pair = fingerPair();
      if (!pair) return;
      const [a, b] = pair;
      const { zoom, pan } = navRef.current;
      viewportRect = el.getBoundingClientRect();
      start = {
        zoom,
        pan: { ...pan },
        dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        mid: midpointOf(a, b),
      };
      pinched = true;
      setActive(true);
      onStartRef.current?.();
    };

    const applyPinch = () => {
      const pair = fingerPair();
      if (!pair || !start) return;
      const [a, b] = pair;
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const next = pinchViewport(
        { zoom: start.zoom, pan: start.pan },
        start.mid,
        midpointOf(a, b),
        dist / start.dist,
      );
      navRef.current.onZoom?.(next.zoom);
      navRef.current.onPan?.(next.pan);
    };

    const raf = createGestureRaf(() => applyPinch());

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        e.stopPropagation();
        if (!start) beginPinch();
      }
    };

    const onMove = (e: PointerEvent) => {
      const pt = pointers.get(e.pointerId);
      if (!pt) return;
      pt.x = e.clientX;
      pt.y = e.clientY;
      if (start) raf.schedule(undefined);
    };

    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      if (start && pointers.size < 2) {
        raf.flush();
        start = null;
        viewportRect = null;
      }
      if (pointers.size === 0) {
        pinched = false;
        setActive(false);
      } else if (pinched) {
        e.stopPropagation();
      }
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      raf.cancel();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      setActive(false);
    };
  }, [viewportRef, navRef, activeRef]);
}
