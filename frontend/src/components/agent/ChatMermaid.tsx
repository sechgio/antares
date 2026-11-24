import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PALETTE } from './ChatChart';

const MERMAID_THEME = {
  '--pele-bg': 'var(--bg-elevated)',
  '--pele-fg': 'var(--text-primary)',
  '--pele-muted': 'var(--text-muted)',
  '--pele-line': 'var(--text-muted)',
  '--pele-surface': 'color-mix(in srgb, var(--text-primary) 6%, transparent)',
  '--pele-surface-alt': 'color-mix(in srgb, var(--text-primary) 10%, transparent)',
  '--pele-border': 'color-mix(in srgb, var(--text-primary) 28%, transparent)',
  '--pele-accent': 'var(--accent-primary)',
  '--pele-critical': 'var(--accent-red)',
  ...Object.fromEntries(PALETTE.map((color, i) => [`--pele-series-${i + 1}`, color])),
} as CSSProperties;

const MERMAID_KINDS: Record<string, string> = {
  flowchart: 'Diagrama de flujo',
  graph: 'Diagrama de flujo',
  sequenceDiagram: 'Diagrama de secuencia',
  classDiagram: 'Diagrama de clases',
  stateDiagram: 'Diagrama de estados',
  'stateDiagram-v2': 'Diagrama de estados',
  erDiagram: 'Diagrama entidad-relación',
  gantt: 'Cronograma',
  pie: 'Gráfico circular',
  mindmap: 'Mapa mental',
  timeline: 'Línea de tiempo',
};

export function mermaidTitle(source: string): string {
  const title = /^\s*(?:pie\s+)?title[\s:]\s*(.+?)\s*$/m.exec(source)?.[1].replace(/^["']|["']$/g, '');
  if (title) return title;
  const kind = /^\s*([\w-]+)/m.exec(source.replace(/^\s*---[\s\S]*?---/, '').replace(/^\s*%%.*$/gm, ''))?.[1];
  return (kind && MERMAID_KINDS[kind]) || 'Diagrama';
}

export function Mermaid({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let cancelled = false;
    let mounted: { destroy(): void } | undefined;
    const fail = (reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'No se pudo dibujar el diagrama.');
    };
    Promise.all([import('pele/lazy'), import('dompurify')])
      .then(([pele, { default: DOMPurify }]) => {
        if (cancelled) return undefined;
        const purifier = DOMPurify(window);
        return pele.mountAsync(element, source, {
          links: false,
          images: false,
          zoom: false,
          autoDirection: false,
          sanitize: (svg) =>
            purifier.sanitize(svg, {
              FORBID_ATTR: ['href', 'xlink:href', 'src', 'srcset'],
              FORBID_TAGS: ['a', 'image', 'foreignObject', 'style'],
              USE_PROFILES: { svg: true, svgFilters: true },
              RETURN_DOM_FRAGMENT: true,
            }),
          onRender: () => setError(null),
          onError: fail,
        });
      })
      .then((result) => {
        if (cancelled) result?.destroy();
        else mounted = result;
      }, fail);
    return () => {
      cancelled = true;
      mounted?.destroy();
    };
  }, [source]);
  return (
    <>
      {error && (
        <div>
          <p className="mb-1 text-[11.5px] text-[var(--accent-red)]">No se pudo dibujar el diagrama: {error}</p>
          <pre className="overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-[18px] text-[var(--text-secondary)]">
            {source}
          </pre>
        </div>
      )}
      <div
        ref={ref}
        data-mermaid
        hidden={error !== null}
        style={MERMAID_THEME}
        className="flex justify-center [&_svg]:max-w-full"
      />
    </>
  );
}
