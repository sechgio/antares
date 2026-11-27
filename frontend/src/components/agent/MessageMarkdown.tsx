import { lazy, memo, Suspense, useContext, useMemo, useState, type ReactNode } from 'react';
import { Maximize2 } from 'lucide-react';
import CopyButton from './CopyButton';
import Button from '../ui/Button';
import MarkdownCodeBlock from './MarkdownCodeBlock';
import MarkdownList, { type MarkdownListItem } from './MarkdownList';
import { TablePanel } from './PanelRenderer';
import ErrorBoundary from '../ui/ErrorBoundary';
import { closesFence, FENCE, httpsSource, REFERENCE, referencesIn } from './markdownSyntax';
import { FilePreviewContext, localPreviewResource } from './filePreviewContext';

const ChatVisual = lazy(() => import('./ChatVisual'));
const VISUAL_LABELS: Record<string, string> = { chart: 'gráfico', svg: 'ilustración', html: 'interfaz', mermaid: 'diagrama' };

function VisualPlaceholder({ lang }: { lang: string }) {
  return (
    <div
      role="status"
      className="w-full overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
    >
      <p className="border-b border-[var(--border-subtle)] px-4 py-2.5 text-[12.5px] text-[var(--text-muted)]">
        Generando {VISUAL_LABELS[lang]}…
      </p>
      <div className="flex h-[188px] items-end gap-2 px-4 pb-4 pt-3.5 motion-safe:animate-pulse" aria-hidden="true">
        {[45, 70, 55, 85, 40, 65].map((height, i) => (
          <span
            key={i}
            className="flex-1 rounded-t bg-[color:color-mix(in_srgb,var(--text-primary)_7%,transparent)]"
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
    </div>
  );
}

const INLINE =
  /(`[^`\n]+`|~~[^~\n]+~~|\*\*(?:\*[^*\n]+\*|[^*\n])+\*\*|(?<![\p{L}\p{N}_])__[^_\n]+__(?![\p{L}\p{N}_])|\*[^*\n]+\*|(?<![\p{L}\p{N}_])_[^_\n]+_(?![\p{L}\p{N}_])|\[[^\]\n]+\](?:\((?:<[^>\n]+>|[^)\s]+)\)|\[[^\]\n]*\]))/gu;

const LINK_REFERENCE = /\[([^\]\n]+)\]\[([^\]\n]*)\]/;

function inline(text: string, keyPrefix: string, onPreview: ((resource: string) => void) | null,
  references: ReadonlyMap<string, string>): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith('`')) {
      const value = token.slice(1, -1);
      const resource = localPreviewResource(value);
      const code = (
        <code className="rounded-md bg-[color:color-mix(in_srgb,var(--text-primary)_8%,transparent)] px-1 py-px font-mono text-[12.5px]">
          {value}
        </code>
      );
      out.push(
        resource && onPreview ? (
          <Button
            key={key}
            variant="none"
            size="none"
            className="max-w-full text-left"
            aria-label={`Previsualizar ${value}`}
            onClick={() => onPreview(resource)}
          >
            {code}
          </Button>
        ) : (
          <span key={key}>{code}</span>
        ),
      );
    } else if (token.startsWith('~~')) {
      out.push(
        <del key={key} className="text-[var(--text-muted)]">
          {token.slice(2, -2)}
        </del>,
      );
    } else if (token.startsWith('**') || token.startsWith('__')) {
      out.push(
        <strong key={key} className="font-semibold">
          {inline(token.slice(2, -2), key, onPreview, references)}
        </strong>,
      );
    } else if (token.startsWith('[')) {
      const label = token.slice(1, token.indexOf(']'));
      const reference = LINK_REFERENCE.exec(token);
      const href = reference ? references.get((reference[2] || reference[1]).toLowerCase()) : token.slice(token.indexOf('(') + 1, -1);
      if (!href) {
        out.push(token);
        last = start + token.length;
        continue;
      }
      const resource = localPreviewResource(href);
      const external = httpsSource(href);
      out.push(
        resource && onPreview ? (
          <Button
            key={key}
            variant="none"
            size="none"
            className="max-w-full text-left underline decoration-dotted underline-offset-2"
            title={href}
            aria-label={`Previsualizar ${label}`}
            onClick={() => onPreview(resource)}
          >
            {label}
          </Button>
        ) : external ? (
          <a key={key} href={external} target="_blank" rel="noopener noreferrer" title={href}
            className="underline decoration-dotted underline-offset-2">{label}</a>
        ) : (
          <span key={key} className="underline decoration-dotted underline-offset-2" title={href}>
            {label}
          </span>
        ),
      );
    } else {
      out.push(<em key={key}>{inline(token.slice(1, -1), key, onPreview, references)}</em>);
    }
    last = start + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function plainCell(text: string): string {
  return text
    .replace(/\[([^\]\n]+)\]\((?:<[^>\n]+>|[^)\s]+)\)/g, '$1')
    .replace(/(\*\*|__|~~|`)(.+?)\1/g, '$2')
    .replace(/[\t\r\n]+/g, ' ');
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function tableClipboard(headers: string[], rows: string[][]): { text: string; html: string } {
  const body = [headers, ...rows].map((row) => headers.map((_, n) => plainCell(row[n] ?? '')));
  const html = `<table><thead><tr>${body[0].map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${body
    .slice(1)
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
  return { text: body.map((row) => row.join('\t')).join('\n'), html };
}

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'ul' | 'ol'; items: MarkdownListItem[] }
  | { kind: 'hr' }
  | { kind: 'code'; text: string; lang?: string; open?: true }
  | { kind: 'table'; headers: string[]; align: ('left' | 'center' | 'right')[]; rows: string[][] }
  | { kind: 'quote'; text: string };

function tableCells(line: string): string[] {
  const text = line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '');
  const cells: string[] = [];
  let cell = '';
  let fence = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\' && text[i + 1] === '|') {
      cell += '|';
      i += 1;
    } else if (text[i] === '`') {
      let end = i + 1;
      while (text[end] === '`') end += 1;
      const run = text.slice(i, end);
      if (!fence) fence = run;
      else if (run === fence) fence = '';
      cell += run;
      i += run.length - 1;
    } else if (text[i] === '|' && !fence) {
      cells.push(cell.trim());
      cell = '';
    } else cell += text[i];
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
        blocks.push({
          kind: 'table',
          headers,
          rows,
          align: separators.map((cell) => (cell.endsWith(':') ? (cell.startsWith(':') ? 'center' : 'right') : 'left')),
        });
        continue;
      }
    }
    const opening = FENCE.exec(line);
    if (opening) {
      flush();
      const lang = opening[2].trim().toLowerCase();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !closesFence(lines[i], opening[1])) code.push(lines[i++]);
      blocks.push({
        kind: 'code',
        text: code.join('\n'),
        ...(lang ? { lang } : {}),
        ...(i >= lines.length ? { open: true as const } : {}),
      });
      continue;
    }
    if (REFERENCE.test(line)) {
      flush();
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    const bullet = /^(\s*)[-*•]\s+(.+)$/.exec(line);
    const numbered = /^(\s*)(\d+)[.)]\s+(.+)$/.exec(line);
    const previous = blocks[blocks.length - 1];
    if (!line.trim()) {
      flush();
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ kind: 'hr' });
    } else if (heading) {
      flush();
      blocks.push({ kind: 'h', level: heading[1].length, text: heading[2] });
    } else if (bullet || numbered) {
      flush();
      const kind: 'ul' | 'ol' = bullet ? 'ul' : 'ol';
      const indent = bullet ? bullet[1] : numbered![1];
      const item = {
        text: bullet ? bullet[2] : numbered![3],
        depth: [...indent].reduce((width, char) => width + (char === '\t' ? 2 : 1), 0),
        kind,
        ...(numbered ? { start: Number(numbered[2]) } : {}),
      };
      const latest = blocks[blocks.length - 1];
      if (latest && (latest.kind === 'ul' || latest.kind === 'ol') && (latest.kind === kind || item.depth > 0)) latest.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (line.startsWith('>')) {
      const text = line.replace(/^>\s?/, '');
      if (previous?.kind === 'quote' && lines[i - 1].startsWith('>')) previous.text += `\n${text}`;
      else {
        flush();
        blocks.push({ kind: 'quote', text });
      }
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

const BLOCK_CACHE_ENTRIES = 200;
const BLOCK_CACHE_CHARS = 1_048_576;
const blockCache = new Map<string, Block[]>();
let blockCacheChars = 0;

export function cachedBlocks(text: string, streaming: boolean): Block[] {
  if (streaming || text.length > BLOCK_CACHE_CHARS) return parseBlocks(text);
  const hit = blockCache.get(text);
  if (hit) {
    blockCache.delete(text);
    blockCache.set(text, hit);
    return hit;
  }
  const blocks = parseBlocks(text);
  blockCache.set(text, blocks);
  blockCacheChars += text.length;
  while (blockCache.size > BLOCK_CACHE_ENTRIES || blockCacheChars > BLOCK_CACHE_CHARS) {
    const oldest = blockCache.keys().next().value;
    if (oldest === undefined) break;
    blockCache.delete(oldest);
    blockCacheChars -= oldest.length;
  }
  return blocks;
}

const LIST_CONTINUATION = /^(?:[ \t]|[-*•](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$))/;

export function splitMarkdownBlocks(text: string): string[] | null {
  if (text.includes('\r')) return null;
  const blocks: string[] = [];
  let blockStart = 0;
  let lineStart = 0;
  let fence = '';
  let afterBlank = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (fence) {
      if (closesFence(line, fence)) fence = '';
    } else if (!trimmed) {
      afterBlank = true;
    } else {
      if (afterBlank && lineStart > blockStart && !LIST_CONTINUATION.test(line)) {
        blocks.push(text.slice(blockStart, lineStart));
        blockStart = lineStart;
      }
      afterBlank = false;
      fence = FENCE.exec(line)?.[1] ?? '';
    }
    lineStart += line.length + 1;
  }
  blocks.push(text.slice(blockStart));
  return blocks.length > 1 ? blocks : null;
}

function MarkdownPart({ text, streaming, references }: { text: string; streaming: boolean; references: ReadonlyMap<string, string> }) {
  const onPreview = useContext(FilePreviewContext);
  const [expandedTable, setExpandedTable] = useState<number | null>(null);
  const renderInline = (value: string, key: string) => inline(value, key, onPreview, references);
  const blocks = cachedBlocks(text, streaming);
  return (
    <>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        const cursor =
          streaming && index === blocks.length - 1 ? (
            <span className="ml-0.5 animate-pulse text-[var(--text-muted)]">▍</span>
          ) : null;
        switch (block.kind) {
          case 'h': {
            const Heading = block.level <= 2 ? 'h3' : 'h4';
            return (
              <Heading key={key} className="font-semibold">
                {renderInline(block.text, key)}
                {cursor}
              </Heading>
            );
          }
          case 'table': {
            const clipboard = streaming && index === blocks.length - 1 ? null : tableClipboard(block.headers, block.rows);
            return (
              <div key={key} className="group/table relative">
                {clipboard && (
                  <CopyButton
                    text={clipboard.text}
                    html={clipboard.html}
                    label="Copiar tabla"
                    className="absolute -right-1 -top-3 z-10 border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-sm group-hover/table:opacity-100"
                  />
                )}
                <div
                  role="region"
                  aria-label="Tabla de la respuesta"
                  tabIndex={0}
                  className="agent-markdown-table overflow-x-auto"
                >
                  <table className="w-full border-collapse text-left text-[13px] leading-[21px]">
                    <thead>
                      <tr>
                        {block.headers.map((cell, n) => (
                          <th key={n} scope="col" style={{ textAlign: block.align[n] }}>
                            {renderInline(cell, `${key}-h${n}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, r) => (
                        <tr key={r}>
                          {block.headers.map((_, n) => (
                            <td key={n} style={{ textAlign: block.align[n] }}>
                              {renderInline(row[n] ?? '', `${key}-${r}-${n}`)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {cursor}
                </div>
                {clipboard && block.rows.length > 8 && (
                  <Button size="sm" variant="ghost" onClick={() => setExpandedTable(index)}>
                    <Maximize2 size={13} /> Ampliar tabla
                  </Button>
                )}
                {expandedTable === index && (
                  <TablePanel props={{ title: 'Tabla de la respuesta', columns: block.headers.map(plainCell), rows: block.rows.map((row) => row.map(plainCell)) }}
                    onCloseFull={() => setExpandedTable(null)} />
                )}
              </div>
            );
          }
          case 'ul':
          case 'ol':
            return (
              <MarkdownList
                key={key}
                items={block.items}
                renderInline={renderInline}
                itemKey={key}
                cursor={cursor}
              />
            );
          case 'code': {
            const framed = !block.lang || !VISUAL_LABELS[block.lang];
            const pre = (
              <pre
                key={key}
                className={`overflow-x-auto whitespace-pre p-2.5 font-mono text-[12.5px] leading-[18px] ${framed ? '' : 'rounded-xl bg-[color:color-mix(in_srgb,var(--text-primary)_7%,transparent)]'}`}
              >
                {block.text}
                {cursor}
              </pre>
            );
            if (!block.lang || !VISUAL_LABELS[block.lang]) {
              return <MarkdownCodeBlock key={key} lang={block.lang} text={block.text} open={block.open} cursor={cursor} />;
            }
            if (block.open) return streaming ? <VisualPlaceholder key={key} lang={block.lang} /> : pre;
            return (
              <Suspense key={key} fallback={<VisualPlaceholder lang={block.lang} />}>
                <ErrorBoundary key={block.text} view="agent-chat-visual" fallback={pre}>
                  <ChatVisual lang={block.lang} source={block.text} fallback={pre} />
                </ErrorBoundary>
              </Suspense>
            );
          }
          case 'hr':
            return <hr key={key} className="border-[var(--border-medium)]" />;
          case 'quote':
            return (
              <p key={key} className="whitespace-pre-wrap border-l-2 border-[var(--border-medium)] pl-2.5 text-[var(--text-secondary)]">
                {renderInline(block.text, key)}
                {cursor}
              </p>
            );
          default:
            return (
              <p key={key} className="whitespace-pre-wrap break-words">
                {renderInline(block.text, key)}
                {cursor}
              </p>
            );
        }
      })}
    </>
  );
}

const MemoMarkdownPart = memo(MarkdownPart);

function MessageMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const references = useMemo(() => referencesIn(text), [text]);
  const parts = splitMarkdownBlocks(text);
  return (
    <div className="agent-markdown min-w-0">
      {parts
        ? parts.map((part, index) => (
          <MemoMarkdownPart key={index} text={part} references={references} streaming={streaming && index === parts.length - 1} />
        ))
        : <MemoMarkdownPart text={text} references={references} streaming={streaming} />}
    </div>
  );
}

export default memo(MessageMarkdown);
