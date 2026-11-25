import { useRef } from 'react';
import { PELE_THEME, usePeleMount } from './ChatChart';

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
  const error = usePeleMount(ref, source);
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
        style={PELE_THEME}
        className="flex justify-center [&_svg]:max-w-full [&_.pele-zoom]:opacity-0 [&_.pele-zoom]:transition-opacity hover:[&_.pele-zoom]:opacity-100 focus-within:[&_.pele-zoom]:opacity-100"
      />
    </>
  );
}
