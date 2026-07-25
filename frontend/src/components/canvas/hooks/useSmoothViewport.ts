import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampZoom,
  inertiaStep,
  lerpViewport,
  zoomAnimDuration,
  type Velocity,
  type ViewportState,
} from '../ops/viewportNav';

/**
 * Owns zoom/pan state with Figma-like smooth animated transitions
 * for programmatic zoom (fit, selection, menu) and inertial panning
 * after hand-tool drag release.
 *
 * Wheel zoom remains instant (already incremental).
 */
export function useSmoothViewport(initialZoom = 0.85) {
  const [zoom, setZoomRaw] = useState(initialZoom);
  const [pan, setPanRaw] = useState({ x: 0, y: 0 });

  const animRef = useRef<number | null>(null);
  const inertiaRef = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  zoomRef.current = zoom;
  panRef.current = pan;

  /** Cancel any running animation. */
  const cancelAnim = useCallback(() => {
    if (animRef.current != null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  }, []);

  const cancelInertia = useCallback(() => {
    if (inertiaRef.current != null) {
      cancelAnimationFrame(inertiaRef.current);
      inertiaRef.current = null;
    }
  }, []);

  /** Instant set (for wheel zoom / drag pan — no animation). */
  const setZoom = useCallback(
    (z: number | ((prev: number) => number)) => {
      cancelAnim();
      setZoomRaw((prev) => {
        const next = typeof z === 'function' ? z(prev) : z;
        return clampZoom(next);
      });
    },
    [cancelAnim],
  );

  const setPan = useCallback(
    (p: { x: number; y: number }) => {
      cancelInertia();
      setPanRaw(p);
    },
    [cancelInertia],
  );

  /** Animated transition to target viewport (for fit/selection/menu actions). */
  const animateTo = useCallback(
    (target: ViewportState, duration?: number) => {
      cancelAnim();
      cancelInertia();
      const from: ViewportState = { zoom: zoomRef.current, pan: { ...panRef.current } };
      const to: ViewportState = { zoom: clampZoom(target.zoom), pan: target.pan };
      const ms = duration ?? zoomAnimDuration(from.zoom, to.zoom);

      if (ms <= 0 || (from.zoom === to.zoom && from.pan.x === to.pan.x && from.pan.y === to.pan.y)) {
        setZoomRaw(to.zoom);
        setPanRaw(to.pan);
        return;
      }

      const start = performance.now();
      const tick = (now: number) => {
        const elapsed = now - start;
        const t = Math.min(1, elapsed / ms);
        const state = lerpViewport(from, to, t);
        setZoomRaw(state.zoom);
        setPanRaw(state.pan);
        if (t < 1) {
          animRef.current = requestAnimationFrame(tick);
        } else {
          animRef.current = null;
        }
      };
      animRef.current = requestAnimationFrame(tick);
    },
    [cancelAnim, cancelInertia],
  );

  /** Start inertial panning with given velocity (px/frame). */
  const startInertia = useCallback(
    (velocity: Velocity) => {
      cancelInertia();
      cancelAnim();
      let vel = velocity;
      const tick = () => {
        const result = inertiaStep(panRef.current, vel);
        if (!result) {
          inertiaRef.current = null;
          return;
        }
        setPanRaw(result.pan);
        vel = result.velocity;
        inertiaRef.current = requestAnimationFrame(tick);
      };
      inertiaRef.current = requestAnimationFrame(tick);
    },
    [cancelAnim, cancelInertia],
  );

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (animRef.current != null) cancelAnimationFrame(animRef.current);
      if (inertiaRef.current != null) cancelAnimationFrame(inertiaRef.current);
    };
  }, []);

  return { zoom, pan, setZoom, setPan, animateTo, startInertia, cancelAnim, cancelInertia };
}
