import { memo, useEffect, useRef } from 'react';
import { createGestureRaf } from '../ops/gestureRaf';

/** Animated face mark — eyes follow cursor (compositor translate) and blink (scaleY). */
function BrandFace() {
  const faceRef = useRef<HTMLDivElement>(null);
  const leftEyeRef = useRef<HTMLDivElement>(null);
  const rightEyeRef = useRef<HTMLDivElement>(null);
  const leftPupilRef = useRef<HTMLDivElement>(null);
  const rightPupilRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const face = faceRef.current;
    if (!face) return;

    // Cache face geometry; refresh only when layout may have changed (not every move).
    let rect = face.getBoundingClientRect();
    let rectDirty = false;
    const refreshRect = () => {
      rect = face.getBoundingClientRect();
      rectDirty = false;
    };
    const invalidateRect = () => {
      rectDirty = true;
    };
    const ro = new ResizeObserver(invalidateRect);
    ro.observe(face);
    window.addEventListener('resize', invalidateRect);
    window.addEventListener('scroll', invalidateRect, true);

    const raf = createGestureRaf((ev: { clientX: number; clientY: number }) => {
      // Pause eye tracking while the artboard owns an active pointer gesture.
      if (document.body.dataset.canvasGesture === '1') return;

      const left = leftEyeRef.current;
      const right = rightEyeRef.current;
      if (!left || !right) return;

      if (rectDirty) refreshRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const max = rect.width * 0.15;
      let dx = ev.clientX - cx;
      let dy = ev.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > max) {
        dx = (dx / dist) * max;
        dy = (dy / dist) * max;
      }
      const transform = `translate(${dx}px, ${dy}px)`;
      left.style.transform = transform;
      right.style.transform = transform;
    });

    const onMove = (event: MouseEvent) => {
      raf.schedule({ clientX: event.clientX, clientY: event.clientY });
    };

    window.addEventListener('mousemove', onMove);
    return () => {
      raf.cancel();
      ro.disconnect();
      window.removeEventListener('resize', invalidateRect);
      window.removeEventListener('scroll', invalidateRect, true);
      window.removeEventListener('mousemove', onMove);
    };
  }, []);

  useEffect(() => {
    let blinkTimeout: ReturnType<typeof setTimeout>;
    let closeTimeout: ReturnType<typeof setTimeout>;
    const setBlink = (on: boolean) => {
      for (const el of [leftPupilRef.current, rightPupilRef.current]) {
        if (!el) continue;
        if (on) el.setAttribute('data-blink', 'true');
        else el.removeAttribute('data-blink');
      }
    };
    const scheduleBlink = () => {
      setBlink(true);
      closeTimeout = setTimeout(() => setBlink(false), 200);
      blinkTimeout = setTimeout(scheduleBlink, Math.random() * 3000 + 3000);
    };
    blinkTimeout = setTimeout(scheduleBlink, 3000);
    return () => {
      clearTimeout(blinkTimeout);
      clearTimeout(closeTimeout);
    };
  }, []);

  return (
    <div ref={faceRef} className="canvas-brand-face" aria-hidden>
      <div ref={leftEyeRef} className="canvas-brand-face-eye-track">
        <div ref={leftPupilRef} className="canvas-brand-face-eye" />
      </div>
      <div ref={rightEyeRef} className="canvas-brand-face-eye-track">
        <div ref={rightPupilRef} className="canvas-brand-face-eye" />
      </div>
    </div>
  );
}

export default memo(BrandFace);
