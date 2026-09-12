import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampZoom,
  inertiaStep,
  lerpViewport,
  zoomAnimDuration,
  type Velocity,
  type ViewportState,
} from '../ops/viewportNav';

export type ViewportFrameListener = (zoom: number, pan: { x: number; y: number }) => void;

const COMMIT_INTERVAL_MS = 150;
const SETTLE_DELAY_MS = 120;

export function useSmoothViewport(initialZoom = 1) {
  const [zoom, setZoomRaw] = useState(initialZoom);
  const [pan, setPanRaw] = useState({ x: 0, y: 0 });

  const animRef = useRef<number | null>(null);
  const inertiaRef = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const listenersRef = useRef(new Set<ViewportFrameListener>());
  const lastCommitRef = useRef(Number.NEGATIVE_INFINITY);
  const settleTimerRef = useRef<number | null>(null);

  const commitNow = useCallback(() => {
    if (settleTimerRef.current != null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    lastCommitRef.current = performance.now();
    setZoomRaw((prev) => (prev === zoomRef.current ? prev : zoomRef.current));
    setPanRaw((prev) =>
      prev.x === panRef.current.x && prev.y === panRef.current.y
        ? prev
        : { x: panRef.current.x, y: panRef.current.y },
    );
  }, []);

  const cancelAnim = useCallback(() => {
    if (animRef.current != null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
      commitNow();
    }
  }, [commitNow]);

  const cancelInertia = useCallback(() => {
    if (inertiaRef.current != null) {
      cancelAnimationFrame(inertiaRef.current);
      inertiaRef.current = null;
      commitNow();
    }
  }, [commitNow]);

  const applyLive = useCallback(
    (z: number, p: { x: number; y: number }, commit = false) => {
      zoomRef.current = z;
      panRef.current = p;
      for (const listener of listenersRef.current) listener(z, p);
      if (commit) {
        commitNow();
        return;
      }
      const now = performance.now();
      if (now - lastCommitRef.current >= COMMIT_INTERVAL_MS) {
        commitNow();
      } else if (settleTimerRef.current == null) {
        settleTimerRef.current = window.setTimeout(() => {
          settleTimerRef.current = null;
          commitNow();
        }, SETTLE_DELAY_MS);
      }
    },
    [commitNow],
  );

  const subscribe = useCallback((listener: ViewportFrameListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const getZoom = useCallback(() => zoomRef.current, []);
  const getPan = useCallback(() => panRef.current, []);

  const setZoom = useCallback(
    (z: number | ((prev: number) => number)) => {
      cancelAnim();
      cancelInertia();
      const next = typeof z === 'function' ? z(zoomRef.current) : z;
      applyLive(clampZoom(next), panRef.current, true);
    },
    [applyLive, cancelAnim, cancelInertia],
  );

  const setPan = useCallback(
    (p: { x: number; y: number }) => {
      cancelAnim();
      cancelInertia();
      applyLive(zoomRef.current, p, true);
    },
    [applyLive, cancelAnim, cancelInertia],
  );

  const animateTo = useCallback(
    (target: ViewportState, duration?: number) => {
      cancelAnim();
      cancelInertia();
      const from: ViewportState = { zoom: zoomRef.current, pan: { ...panRef.current } };
      const to: ViewportState = { zoom: clampZoom(target.zoom), pan: target.pan };
      const ms = duration ?? zoomAnimDuration(from.zoom, to.zoom);

      if (ms <= 0 || (from.zoom === to.zoom && from.pan.x === to.pan.x && from.pan.y === to.pan.y)) {
        applyLive(to.zoom, to.pan);
        commitNow();
        return;
      }

      const start = performance.now();
      const tick = (now: number) => {
        const elapsed = now - start;
        const t = Math.min(1, elapsed / ms);
        const state = lerpViewport(from, to, t);
        applyLive(state.zoom, state.pan);
        if (t < 1) {
          animRef.current = requestAnimationFrame(tick);
        } else {
          animRef.current = null;
          commitNow();
        }
      };
      animRef.current = requestAnimationFrame(tick);
    },
    [applyLive, cancelAnim, cancelInertia, commitNow],
  );

  const startInertia = useCallback(
    (velocity: Velocity) => {
      cancelInertia();
      cancelAnim();
      let vel = velocity;
      let last = performance.now();
      const tick = (now: number) => {
        const dt = now - last;
        last = now;
        const result = inertiaStep(panRef.current, vel, dt);
        if (!result) {
          inertiaRef.current = null;
          commitNow();
          return;
        }
        applyLive(zoomRef.current, result.pan);
        vel = result.velocity;
        inertiaRef.current = requestAnimationFrame(tick);
      };
      inertiaRef.current = requestAnimationFrame(tick);
    },
    [applyLive, cancelAnim, cancelInertia, commitNow],
  );

  useEffect(() => {
    return () => {
      if (animRef.current != null) cancelAnimationFrame(animRef.current);
      if (inertiaRef.current != null) cancelAnimationFrame(inertiaRef.current);
      if (settleTimerRef.current != null) window.clearTimeout(settleTimerRef.current);
    };
  }, []);

  return {
    zoom,
    pan,
    setZoom,
    setPan,
    animateTo,
    startInertia,
    cancelAnim,
    cancelInertia,
    getZoom,
    getPan,
    subscribe,
  };
}
