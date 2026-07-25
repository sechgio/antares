import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

/** Animated face mark inspired by syedsubhan.in — eyes follow cursor and blink. */
export default function BrandFace() {
  const faceRef = useRef<HTMLDivElement>(null);
  const leftEyeRef = useRef<HTMLDivElement>(null);
  const rightEyeRef = useRef<HTMLDivElement>(null);
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const face = faceRef.current;
      const left = leftEyeRef.current;
      const right = rightEyeRef.current;
      if (!face || !left || !right) return;

      const rect = face.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const max = rect.width * 0.15;
      let dx = event.clientX - cx;
      let dy = event.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > max) {
        dx = (dx / dist) * max;
        dy = (dy / dist) * max;
      }
      const transform = `translate(${dx}px, ${dy}px)`;
      left.style.transform = transform;
      right.style.transform = transform;
    };

    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  useEffect(() => {
    let blinkTimeout: ReturnType<typeof setTimeout>;
    let closeTimeout: ReturnType<typeof setTimeout>;
    const scheduleBlink = () => {
      setBlinking(true);
      closeTimeout = setTimeout(() => setBlinking(false), 200);
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
        <motion.div
          className="canvas-brand-face-eye"
          animate={{ height: blinking ? 2 : 9 }}
          transition={{ duration: 0.08 }}
        />
      </div>
      <div ref={rightEyeRef} className="canvas-brand-face-eye-track">
        <motion.div
          className="canvas-brand-face-eye"
          animate={{ height: blinking ? 2 : 9 }}
          transition={{ duration: 0.08 }}
        />
      </div>
    </div>
  );
}
