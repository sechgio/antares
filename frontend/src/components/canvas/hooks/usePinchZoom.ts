import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { pinchViewport } from '../ops/viewportNav';

interface PinchNav {
  zoom: number;
  pan: { x: number; y: number };
  onZoom?: (zoom: number) => void;
  onPan?: (pan: { x: number; y: number }) => void;
}

interface UsePinchZoomOptions {
  /** Called once when the second finger lands (cancel drafts/marquee visuals). */
  onStart?: () => void;
  /**
   * Set true while a pinch is (or was, until all fingers lift) in progress so
   * single-pointer gesture handlers can no-op their move/up actions.
   */
  activeRef?: MutableRefObject<boolean>;
}

/**
 * Native two-finger pinch-to-zoom for touch devices (Figma/Canva-like).
 * Tracks touch pointer events on the viewport; the second finger starts the
 * gesture, and the content point under the fingers' midpoint follows them.
 * Extra-finger pointerdowns are stopped so single-pointer gestures do not
 * restart mid-pinch.
 */
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

    const setActive = (value: boolean) => {
      if (activeRef) activeRef.current = value;
    };

    const centerRelative = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
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

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        // Extra fingers must not restart single-pointer gestures.
        e.stopPropagation();
        if (!start) beginPinch();
      }
    };

    const onMove = (e: PointerEvent) => {
      const pt = pointers.get(e.pointerId);
      if (!pt) return;
      pt.x = e.clientX;
      pt.y = e.clientY;
      applyPinch();
    };

    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      if (start && pointers.size < 2) start = null;
      if (pointers.size === 0) {
        pinched = false;
        setActive(false);
      } else if (pinched) {
        // Residual finger after pinch must not complete stale gestures either.
        e.stopPropagation();
      }
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      setActive(false);
    };
  }, [viewportRef, navRef, activeRef]);
}
