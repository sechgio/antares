import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Minus, Plus } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { clampZoom, wheelZoomFactor, zoomAtCursor } from '../ops/viewportNav';

interface PreviewViewportProps {
  html: string;
  widthPx: number;
  heightPx: number;
}

export interface PreviewViewportHandle {
  print: () => void;
}

const DEFAULT_ZOOM = 0.85;
const ZOOM_STEP = 0.1;

const PreviewViewport = forwardRef<PreviewViewportHandle, PreviewViewportProps>(
  function PreviewViewport({ html, widthPx, heightPx }, ref) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [zoom, setZoom] = useState(DEFAULT_ZOOM);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [panning, setPanning] = useState(false);
    const navRef = useRef({ zoom, pan, setZoom, setPan });
    navRef.current = { zoom, pan, setZoom, setPan };

    useImperativeHandle(ref, () => ({
      print: () => {
        iframeRef.current?.contentWindow?.print();
      },
    }));

    // Set srcdoc only when html changes — never on zoom/pan re-renders.
    useEffect(() => {
      const iframe = iframeRef.current;
      if (!iframe || !html) return;
      if (iframe.srcdoc !== html) iframe.srcdoc = html;
    }, [html]);

    useEffect(() => {
      const el = viewportRef.current;
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const { zoom: z, pan: p, setZoom: setZ, setPan: setP } = navRef.current;
        const rect = el.getBoundingClientRect();
        const cursor = {
          x: e.clientX - rect.left - rect.width / 2,
          y: e.clientY - rect.top - rect.height / 2,
        };

        if (e.ctrlKey || e.metaKey) {
          const factor = wheelZoomFactor(e.deltaY, true);
          const next = zoomAtCursor(z, p, cursor, z * factor);
          setZ(next.zoom);
          setP(next.pan);
          return;
        }

        setP({ x: p.x - e.deltaX, y: p.y - e.deltaY });
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    }, []);

    const startPan = (e: ReactPointerEvent<HTMLDivElement>) => {
      // Preview is read-only: any left/middle drag pans (iframe has pointer-events: none).
      if (e.button !== 0 && e.button !== 1) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const origin = { ...navRef.current.pan };
      setPanning(true);
      const onMove = (ev: PointerEvent) => {
        setPan({ x: origin.x + (ev.clientX - startX), y: origin.y + (ev.clientY - startY) });
      };
      const onUp = () => {
        setPanning(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };

    const zoomByStep = (direction: 1 | -1) => {
      setZoom((z) => clampZoom(z + direction * ZOOM_STEP));
    };

    return (
      <div className="relative min-h-0 min-w-0 flex-1">
        <div
          ref={viewportRef}
          className="canvas-dot-bg absolute inset-0 overflow-hidden"
          data-testid="generate-preview-viewport"
          style={{ cursor: panning ? 'grabbing' : 'grab' }}
          onPointerDown={startPan}
        >
          {html ? (
            <div
              data-testid="generate-preview-stage"
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: widthPx,
                height: heightPx,
                // CSS `zoom` (Chromium/Electron) re-rasterizes at the zoom level — crisp like
                // layout-scale. Avoid `transform: scale()` which upscales a 1× bitmap.
                // Divide pan by zoom so visual offset stays in screen px after CSS zoom.
                transform: `translate(calc(-50% + ${pan.x / zoom}px), calc(-50% + ${pan.y / zoom}px))`,
                transformOrigin: 'center center',
                zoom,
              }}
            >
              <iframe
                ref={iframeRef}
                title="Canvas preview"
                sandbox="allow-same-origin allow-scripts"
                className="border-0 bg-white"
                style={{
                  width: widthPx,
                  height: heightPx,
                  display: 'block',
                  // Let wheel/drag hit the viewport so pan/zoom work over the page.
                  pointerEvents: 'none',
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.08), 0 12px 40px rgba(0,0,0,0.14)',
                }}
              />
            </div>
          ) : (
            <p
              className="absolute inset-0 flex items-center justify-center text-sm"
              style={{ color: 'var(--cv-text-muted)' }}
            >
              Preparando preview…
            </p>
          )}
        </div>

        <div
          className="canvas-zoom-chip pointer-events-auto absolute bottom-5 right-5 z-50 flex items-center gap-0.5 rounded-xl border px-1.5 py-1"
          style={{
            background: 'rgba(255,255,255,0.96)',
            borderColor: 'var(--cv-border)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          }}
        >
          <WithHoverTooltip label="Alejar" shortcut="Ctrl+-" placement="top" variant="dark">
            <button
              type="button"
              className="canvas-icon-btn shrink-0"
              aria-label="Alejar"
              onClick={() => zoomByStep(-1)}
            >
              <Minus className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </WithHoverTooltip>
          <span
            className="min-w-[3rem] text-center text-[11px] font-medium tabular-nums"
            style={{ color: 'var(--cv-text-secondary)' }}
          >
            {Math.round(zoom * 100)}%
          </span>
          <WithHoverTooltip label="Acercar" shortcut="Ctrl++" placement="top" variant="dark">
            <button
              type="button"
              className="canvas-icon-btn shrink-0"
              aria-label="Acercar"
              onClick={() => zoomByStep(1)}
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </WithHoverTooltip>
        </div>
      </div>
    );
  },
);

export default PreviewViewport;
