import { useEffect, useState } from 'react';

interface BrandMarkProps {
  showText?: boolean;
  tagline?: string;
  size?: 'sm' | 'md';
  className?: string;
}

/* ──────────────────────────────────────────────────────────
   Determine whether the actual rendered background is
   perceptually "dark" or "light" by reading the live
   --bg-base CSS variable and computing its relative
   luminance.  This is the ONLY reliable way to choose
   the correct logo variant, because the user can pick
   any arbitrary background color regardless of the
   "mode" label (dark / light / system).
   ────────────────────────────────────────────────────── */

function hexToRgb(hex: string) {
  const h = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function relativeLuminance(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(rgb.r) + 0.7152 * ch(rgb.g) + 0.0722 * ch(rgb.b);
}

/** Read the current --bg-base value and decide if it's light */
function isBgLight(): boolean {
  if (typeof document === 'undefined') return false;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--bg-base')
    .trim();
  if (!raw) return false;
  return relativeLuminance(raw) > 0.4;
}

function useIsBgLight(): boolean {
  const [light, setLight] = useState(() => isBgLight());

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setLight(isBgLight());

    // Re-check whenever theme attributes or inline styles change
    const observer = new MutationObserver(update);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-theme-mode', 'class', 'style'],
    });

    // Also listen to system preference changes
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    mq?.addEventListener?.('change', update);

    // Initial check
    update();

    return () => {
      observer.disconnect();
      mq?.removeEventListener?.('change', update);
    };
  }, []);

  return light;
}

/* ──────────────────────────────────────────────────────── */

export default function BrandMark({
  showText = false,
  tagline,
  size = 'sm',
  className = '',
}: BrandMarkProps) {
  const bgIsLight = useIsBgLight();

  // logo1 = dark text "ANTARES" → for light backgrounds
  // logo2 = white text "ANTARES" → for dark backgrounds
  // favicon1 = eye with dark pupil → for dark backgrounds
  // favicon2 = eye outline only  → for light backgrounds
  const iconSrc = bgIsLight ? './favicon2.png' : './favicon1.png';
  const logoSrc = bgIsLight ? './logo1.png' : './logo2.png';

  const markPx = size === 'md' ? 36 : 28;

  return (
    <div className={`inline-flex items-center gap-2 min-w-0 ${className}`}>
      {showText ? (
        <>
          <img
            src={logoSrc}
            alt="ANTARES"
            className="object-contain shrink-0"
            style={{ maxHeight: size === 'md' ? 48 : 36, width: 'auto', maxWidth: '100%' }}
            draggable={false}
          />
          {tagline && (
            <span
              className={`min-w-0 leading-none mt-1 truncate text-[var(--text-secondary)] ${
                size === 'md' ? 'text-[11px]' : 'text-[10px]'
              }`}
            >
              {tagline}
            </span>
          )}
        </>
      ) : (
        <div
          role="img"
          aria-label="ANTARES logo"
          style={{ width: markPx, height: markPx }}
          className="shrink-0 flex items-center justify-center overflow-hidden rounded-md"
        >
          <img
            src={iconSrc}
            alt=""
            aria-hidden="true"
            className="w-full h-full object-contain"
            draggable={false}
          />
        </div>
      )}
    </div>
  );
}
