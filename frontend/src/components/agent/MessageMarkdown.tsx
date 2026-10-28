import { lazy, Suspense, type ReactNode } from 'react';
import CopyButton from './CopyButton';

const ChatVisual = lazy(() => import('./ChatVisual'));
const VISUAL_LABELS: Record<string, string> = { chart: 'gráfico', svg: 'ilustración', html: 'interfaz' };

function VisualPlaceholder({ lang }: { lang: string }) {
  return (
    <div role="status" className="w-full max-w-2xl overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
      <p className="border-b border-[var(--border-subtle)] px-3 py-2 text-[12.5px] text-[var(--text-muted)]">Generando {VISUAL_LABELS[lang]}…</p>
      <div className="flex h-[150px] items-end gap-2 p-3 motion-safe:animate-pulse" aria-hidden="true">
        {[45, 70, 55, 85, 40, 65].map((height, i) => (
          <span key={i} className="flex-1 rounded-t bg-[color:color-mix(in_srgb,var(--text-primary)_7%,transparent)]" style={{ height: `${height}%` }} />
        ))}
      </div>
    </div>
  );
}

// Como en CommonMark, «_» pegado a letras o números no abre ni cierra énfasis:
// gmail_search o mi_archivo_final.pdf se muestran tal cual.
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|(?<![\p{L}\p{N}_])__[^_\n]+__(?![\p{L}\p{N}_])|\*[^*\n]+\*|(?<![\p{L}\p{N}_])_[^_\n]+_(?![\p{L}\p{N}_])|\[[^\]\n]+\]\([^)\s]+\))/gu;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith('`')) {
      out.push(<code key={key} className="rounded-md bg-[color:color-mix(in_srgb,var(--text-primary)_8%,transparent)] px-1 py-px font-mono text-[12.5px]">{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**') || token.startsWith('__')) {
      out.push(<strong key={key} className="font-semibold">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('[')) {
      const label = token.slice(1, token.indexOf(']'));
      const href = token.slice(token.indexOf('(') + 1, -1);
      out.push(<span key={key} className="underline decoration-dotted underline-offset-2" title={href}>{label}</span>);
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = start + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'code'; text: string; lang?: string; open?: true }
  | { kind: 'table'; headers: string[]; align: ('left' | 'center' | 'right')[]; rows: string[][] }
  | { kind: 'quote'; text: string };

function tableCells(line: string): string[] {
  const text = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  const cells: string[] = [];
  let cell = '';
  let fence = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\' && text[i + 1] === '|') { cell += '|'; i += 1; }
    else if (text[i] === '`') {
      let end = i + 1;
      while (text[end] === '`') end += 1;
      const run = text.slice(i, end);
      if (!fence) fence = run;
      else if (run === fence) fence = '';
      cell += run;
      i += run.length - 1;
    } else if (text[i] === '|' && !fence) { cells.push(cell.trim()); cell = ''; }
    else cell += text[i];
  }
  return [...cells, cell.trim()];
}

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'p', text: paragraph.join('\n') });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes('|') && i + 1 < lines.length) {
      const headers = tableCells(line);
      const separators = tableCells(lines[i + 1]);
      if (headers.length === separators.length && separators.every((cell) => /^:?-{3,}:?$/.test(cell))) {
        flush();
        const rows: string[][] = [];
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(tableCells(lines[i++]));
        i -= 1;
        blocks.push({ kind: 'table', headers, rows, align: separators.map((cell) => cell.endsWith(':') ? cell.startsWith(':') ? 'center' : 'right' : 'left') });
        continue;
      }
    }
    if (line.trim().startsWith('```')) {
      flush();
      const lang = line.trim().slice(3).trim().toLowerCase();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
      blocks.push({ kind: 'code', text: code.join('\n'), ...(lang ? { lang } : {}), ...(i >= lines.length ? { open: true as const } : {}) });
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (!line.trim()) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ kind: 'h', level: heading[1].length, text: heading[2] });
    } else if (bullet || numbered) {
      flush();
      const kind = bullet ? 'ul' : 'ol';
      const previous = blocks[blocks.length - 1];
      const text = (bullet ?? numbered)![1];
      if (previous && previous.kind === kind) previous.items.push(text);
      else blocks.push({ kind, items: [text] });
    } else if (line.startsWith('>')) {
      flush();
      blocks.push({ kind: 'quote', text: line.replace(/^>\s?/, '') });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

export default function MessageMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const blocks = parseBlocks(text);
  return (
    <div className="agent-markdown min-w-0">
      {blocks.map((block, index) => {
        const key = `b${index}`;
        const cursor = streaming && index === blocks.length - 1
          ? <span className="ml-0.5 animate-pulse text-[var(--text-muted)]">▍</span> : null;
        switch (block.kind) {
          case 'h': {
            const Heading = block.level <= 2 ? 'h3' : 'h4';
            return <Heading key={key} className="font-semibold">{inline(block.text, key)}{cursor}</Heading>;
          }
          case 'table':
            return (
              <div key={key} role="region" aria-label="Tabla de la respuesta" tabIndex={0} className="agent-markdown-table overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
                <table className="w-full border-collapse text-left text-[13px] leading-[21px]">
                  <thead className="bg-[var(--bg-input)]">
                    <tr>{block.headers.map((cell, n) => <th key={n} scope="col" style={{ textAlign: block.align[n] }}>{inline(cell, `${key}-h${n}`)}</th>)}</tr>
                  </thead>
                  <tbody>{block.rows.map((row, r) => <tr key={r}>{block.headers.map((_, n) => <td key={n} style={{ textAlign: block.align[n] }}>{inline(row[n] ?? '', `${key}-${r}-${n}`)}</td>)}</tr>)}</tbody>
                </table>
                {cursor}
              </div>
            );
          case 'ul':
          case 'ol': {
            const List = block.kind;
            return (
              <List key={key} className={`space-y-1 pl-5 ${block.kind === 'ul' ? 'list-disc' : 'list-decimal'}`}>
                {block.items.map((item, n) => <li key={n}>{inline(item, `${key}-${n}`)}</li>)}
                {cursor}
              </List>
            );
          }
          case 'code': {
            const framed = !block.lang || !VISUAL_LABELS[block.lang];
            const pre = (
              <pre key={key} className={`overflow-x-auto whitespace-pre p-2.5 font-mono text-[12.5px] leading-[18px] ${framed ? '' : 'rounded-xl bg-[color:color-mix(in_srgb,var(--text-primary)_7%,transparent)]'}`}>
                {block.text}{cursor}
              </pre>
            );
            if (!block.lang || !VISUAL_LABELS[block.lang]) {
              return (
                <div key={key} className="group/code overflow-hidden rounded-xl bg-[color:color-mix(in_srgb,var(--text-primary)_7%,transparent)]">
                  <div className="flex h-7 items-center justify-between border-b border-[var(--border-subtle)] pl-2.5 pr-1.5 font-mono text-[11px] text-[var(--text-muted)]">
                    {block.lang || 'código'}
                    {!block.open && <CopyButton text={block.text} label="Copiar código" className="group-hover/code:opacity-100" />}
                  </div>
                  {pre}
                </div>
              );
            }
            if (block.open) return streaming ? <VisualPlaceholder key={key} lang={block.lang} /> : pre;
            return (
              <Suspense key={key} fallback={<VisualPlaceholder lang={block.lang} />}>
                <ChatVisual lang={block.lang} source={block.text} fallback={pre} />
              </Suspense>
            );
          }
          case 'quote':
            return <p key={key} className="border-l-2 border-[var(--border-medium)] pl-2.5 text-[var(--text-secondary)]">{inline(block.text, key)}{cursor}</p>;
          default:
            return <p key={key} className="whitespace-pre-wrap break-words">{inline(block.text, key)}{cursor}</p>;
        }
      })}
    </div>
  );
}
