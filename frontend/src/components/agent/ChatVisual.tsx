import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Image as ImageIcon, Maximize2, X } from 'lucide-react';
import { DialogSurface } from '../ui/Dialog';
import { sanitizeHtmlForPreview } from '../../../../shared/html-sanitizer.js';
import { CartesianChart, DataTable, DonutChart, HorizontalBars, Legend, PALETTE, horizontal, parseChart } from './ChatChart';
import { Mermaid, mermaidTitle } from './ChatMermaid';

function Frame({ lang, source }: { lang: 'svg' | 'html'; source: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);
  const [ready, setReady] = useState(false);
  const doc = useMemo(() => {
    const color = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || 'CanvasText';
    const base = `<style>html,body{margin:0;background:transparent;color:${color};font:13px system-ui,sans-serif}svg{display:block;max-width:100%;max-height:480px;height:auto;margin:auto}</style>`;
    return sanitizeHtmlForPreview(
      lang === 'html' && /<html[\s>]/i.test(source)
        ? source.replace(/<head[^>]*>/i, (head) => head + base)
        : `<!doctype html><html><head><meta charset="utf-8">${base}</head><body>${source}</body></html>`,
    );
  }, [lang, source]);
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  // The first load can report the empty initial document, and the content keeps
  // resizing with the chat width, so the height follows the document instead.
  const measure = () => {
    const frame = ref.current;
    const root = frame?.contentDocument?.documentElement;
    const Observer = (frame?.contentWindow as (Window & typeof globalThis) | null | undefined)?.ResizeObserver;
    setReady(true);
    if (!root || !Observer) return;
    const fit = () => {
      const content = Math.ceil(root.getBoundingClientRect().height);
      // A scrollbar narrows the content until it fits and then stays; only scroll past the cap.
      root.style.overflowY = content > 640 ? 'auto' : 'hidden';
      if (content) setHeight(Math.min(Math.max(content, 40), 640));
    };
    observer.current?.disconnect();
    const next = new Observer(fit);
    next.observe(root);
    observer.current = next;
    fit();
  };
  return (
    <iframe
      ref={ref}
      title={lang === 'svg' ? 'Gráfico' : 'Interfaz'}
      sandbox="allow-same-origin"
      srcDoc={doc}
      loading="lazy"
      onLoad={measure}
      style={{ height }}
      className={`block w-full border-0 transition-opacity duration-200 ${ready ? 'opacity-100' : 'opacity-0'}`}
    />
  );
}

const TAB = 'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors';
const ICON_BUTTON =
  'rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_6%,transparent)] hover:text-[var(--text-primary)]';

function ChatVisual({ lang, source, fallback }: { lang: string; source: string; fallback: ReactNode }) {
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [imaged, setImaged] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const titleId = useId();
  const view = useRef<HTMLDivElement>(null);
  const spec = useMemo(() => (lang === 'chart' ? parseChart(source) : null), [lang, source]);
  if (lang === 'chart' && !spec)
    return (
      <div>
        <p className="mb-1 text-[11.5px] text-[var(--text-muted)]">No se pudo dibujar el gráfico; se muestra su código.</p>
        {fallback}
      </div>
    );
  const title =
    spec?.title ||
    (lang === 'html' ? 'Interfaz' : lang === 'svg' ? 'Ilustración' : lang === 'mermaid' ? mermaidTitle(source) : 'Gráfico');
  const legend =
    spec && spec.type !== 'pie' && spec.series.length > 1
      ? spec.series.map((s, i) => ({ name: s.name, color: PALETTE[i] }))
      : [];
  const copy = () => {
    void navigator.clipboard
      ?.writeText(source)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  const copyImage = () => {
    const node = view.current;
    if (!node || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return;
    const backgroundColor = getComputedStyle(node.closest('section') ?? node).backgroundColor;
    void import('html-to-image')
      .then(({ toBlob }) => toBlob(node, { backgroundColor, pixelRatio: 2 }))
      .then((blob) => {
        if (!blob) throw new Error('No se pudo generar la imagen');
        return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      })
      .then(() => {
        setImaged(true);
        window.setTimeout(() => setImaged(false), 1500);
      })
      .catch(() => {});
  };
  const body = (
    <>
      {legend.length > 0 && <Legend items={legend} />}
      {spec ? (
        spec.type === 'pie' ? (
          <DonutChart spec={spec} />
        ) : horizontal(spec) ? (
          <HorizontalBars spec={spec} />
        ) : (
          <CartesianChart spec={spec} />
        )
      ) : lang === 'mermaid' ? (
        <Mermaid source={source} />
      ) : (
        <Frame lang={lang as 'svg' | 'html'} source={source} />
      )}
    </>
  );
  return (
    <section
      aria-label={title}
      className="chat-visual w-full overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
    >
      <header className="flex items-center gap-2 border-b border-[var(--border-subtle)] py-2 pl-4 pr-2.5">
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--text-primary)]">{title}</p>
        <div className="flex rounded-lg bg-[color:color-mix(in_srgb,var(--text-primary)_6%,transparent)] p-0.5">
          {(['Vista', 'Código'] as const).map((label) => {
            const active = (label === 'Código') === showCode;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={active}
                onClick={() => setShowCode(label === 'Código')}
                className={`${TAB} ${active ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
              >
                {label}
              </button>
            );
          })}
        </div>
        {(spec || lang === 'mermaid') && !showCode && (
          <button
            type="button"
            onClick={copyImage}
            aria-label={imaged ? 'Imagen copiada' : 'Copiar imagen'}
            title={imaged ? 'Imagen copiada' : 'Copiar imagen (se pega en Word o Excel)'}
            className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_6%,transparent)] hover:text-[var(--text-primary)]"
          >
            {imaged ? <Check size={13} /> : <ImageIcon size={13} />}
          </button>
        )}
        {!showCode && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label="Ampliar"
            title="Ampliar"
            className={ICON_BUTTON}
          >
            <Maximize2 size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Copiado' : 'Copiar código'}
          title={copied ? 'Copiado' : 'Copiar código'}
          className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_6%,transparent)] hover:text-[var(--text-primary)]"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </header>
      {showCode ? (
        <pre className="max-h-[420px] overflow-auto whitespace-pre px-4 py-3 font-mono text-[12px] leading-[18px] text-[var(--text-secondary)]">
          {source}
        </pre>
      ) : (
        <div ref={view} className="space-y-4 px-4 pb-4 pt-3.5">
          {body}
          {spec && <DataTable spec={spec} />}
        </div>
      )}
      {expanded && (
        <DialogSurface portal labelledBy={titleId} onClose={() => setExpanded(false)} className="max-w-5xl p-3">
          <div className="mb-3 flex items-center gap-2">
            <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-medium">
              {title}
            </h2>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="Cerrar vista ampliada"
              className={ICON_BUTTON}
            >
              <X size={16} />
            </button>
          </div>
          <div className="max-h-[80vh] space-y-3 overflow-auto rounded-lg bg-[var(--bg-elevated)] p-4">{body}</div>
        </DialogSurface>
      )}
    </section>
  );
}

export default memo(ChatVisual, (a, b) => a.lang === b.lang && a.source === b.source);