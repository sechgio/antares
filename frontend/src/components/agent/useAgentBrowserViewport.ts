import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { agentApi } from '../../api/agentApi';

const OVERLAY = '[role="menu"], [role="dialog"], [role="listbox"], [role="alertdialog"]';

function viewportBounds(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + element.clientLeft,
    y: rect.top + element.clientTop,
    width: element.clientWidth || rect.width,
    height: element.clientHeight || rect.height,
  };
}

export default function useAgentBrowserViewport({ viewportRef, panelRef, open, setLayout }: {
  viewportRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  setLayout: Dispatch<SetStateAction<{ width: number; available: number }>>;
}) {
  const [frozenPage, setFrozenPage] = useState<string | null>(null);
  const [pagePaused, setPagePaused] = useState(false);
  const annotatingRef = useRef(false);
  const capturingRef = useRef(false);
  const frozenRef = useRef(false);
  const freezingRef = useRef(false);
  const coveredRef = useRef(false);
  const dockedRef = useRef(false);
  const mountedRef = useRef(false);
  const openRef = useRef(false);
  const boundsKeyRef = useRef('');
  const reportRef = useRef<() => void>(() => {});
  openRef.current = open;

  const releaseFrozen = useCallback(() => {
    frozenRef.current = false;
    setFrozenPage(null);
    setPagePaused(false);
  }, []);

  useEffect(() => {
    if (!open) releaseFrozen();
  }, [open, releaseFrozen]);

  const dockViewport = useCallback(async () => {
    const element = viewportRef.current;
    if (!element) return false;
    const bounds = viewportBounds(element);
    if (!(bounds.width > 0 && bounds.height > 0)) return false;
    try {
      await agentApi.agentBrowser('bounds', { bounds });
      boundsKeyRef.current = JSON.stringify(bounds);
      dockedRef.current = true;
      return true;
    } catch {
      dockedRef.current = false;
      return false;
    }
  }, [viewportRef]);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;
    mountedRef.current = true;
    let frame = 0;
    const sendBounds = (bounds: ReturnType<typeof viewportBounds> | null) => {
      const key = JSON.stringify(bounds);
      if (key === boundsKeyRef.current) return null;
      boundsKeyRef.current = key;
      dockedRef.current = !!bounds;
      const request = agentApi.agentBrowser('bounds', { bounds });
      void request.catch(() => {
        dockedRef.current = false;
        boundsKeyRef.current = '';
      });
      return request;
    };
    const clearFrozen = () => {
      frozenRef.current = false;
      setFrozenPage(null);
    };
    const freezePage = () => {
      if (freezingRef.current || frozenRef.current || capturingRef.current) return;
      freezingRef.current = true;
      void agentApi.agentBrowserCapture().then((shot) => {
        freezingRef.current = false;
        if (!mountedRef.current || annotatingRef.current || capturingRef.current) return;
        if (!openRef.current) { sendBounds(null); return; }
        if (!coveredRef.current) { void sendBounds(viewportBounds(element)); return; }
        frozenRef.current = true;
        setFrozenPage(`data:image/png;base64,${shot.png_base64}`);
        // El raster entra en el DOM antes de retirar la vista nativa.
        requestAnimationFrame(() => {
          if (mountedRef.current && coveredRef.current && !annotatingRef.current && !capturingRef.current) sendBounds(null);
        });
      }).catch(() => {
        freezingRef.current = false;
        if (!mountedRef.current || annotatingRef.current || capturingRef.current) return;
        if (!openRef.current || coveredRef.current) sendBounds(null);
        else void sendBounds(viewportBounds(element));
      });
    };
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Durante la captura el acople lo controla annotate: no lo pises.
        if (capturingRef.current) return;
        const panel = panelRef.current;
        const conversation = panel?.previousElementSibling;
        if (panel && conversation) {
          const width = panel.getBoundingClientRect().width;
          const available = width + conversation.getBoundingClientRect().width;
          setLayout((prev) => prev.width === width && prev.available === available ? prev : { width, available });
        }
        const rect = element.getBoundingClientRect();
        // Solo se retira si está medido y completamente fuera de pantalla; un rect en
        // ceros significa que el layout aún no midió, no que esté oculto.
        const measured = rect.width > 0 && rect.height > 0;
        const offscreen = measured && (rect.right <= 0 || rect.bottom <= 0
          || rect.left >= window.innerWidth || rect.top >= window.innerHeight);
        // La vista nativa pinta encima del DOM: si un menú o diálogo la pisa,
        // se congela la página y se retira la vista para que el menú quede encima.
        const covered = Array.from(document.querySelectorAll(OVERLAY)).some((overlay) => {
          const box = overlay.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top;
        });
        coveredRef.current = covered;
        if (document.hidden || offscreen || annotatingRef.current) {
          setPagePaused(false);
          sendBounds(null);
          return;
        }
        if (!covered) {
          setPagePaused(false);
          const request = sendBounds(viewportBounds(element));
          if (frozenRef.current) {
            const clear = () => requestAnimationFrame(() => {
              if (!coveredRef.current && !annotatingRef.current) clearFrozen();
            });
            if (request) void request.then(clear).catch(() => {});
            else clear();
          }
          return;
        }
        if (frozenRef.current) {
          setPagePaused(false);
          sendBounds(null);
          return;
        }
        if (!openRef.current || !dockedRef.current) {
          setPagePaused(false);
          sendBounds(null);
          return;
        }
        setPagePaused(true);
        if (!freezingRef.current) freezePage();
      });
    };
    reportRef.current = report;
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    if (panelRef.current?.parentElement) observer.observe(panelRef.current.parentElement);
    const overlays = new MutationObserver(report);
    // subtree: diálogos como Ajustes se montan dentro de #root, no en <body>.
    overlays.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', report);
    document.addEventListener('visibilitychange', report);
    return () => {
      mountedRef.current = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      overlays.disconnect();
      window.removeEventListener('resize', report);
      document.removeEventListener('visibilitychange', report);
      boundsKeyRef.current = 'null';
      dockedRef.current = false;
      freezingRef.current = false;
      frozenRef.current = false;
      void agentApi.agentBrowser('bounds', { bounds: null }).catch(() => {});
    };
  }, [panelRef, setLayout, viewportRef]);

  return { frozenPage, pagePaused, annotatingRef, capturingRef, reportRef, dockViewport, releaseFrozen };
}
