import type { ReactNode } from 'react';

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^)\s]+\))/g;

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
  | { kind: 'code'; text: string }
  | { kind: 'quote'; text: string };

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
    if (line.trim().startsWith('```')) {
      flush();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
      blocks.push({ kind: 'code', text: code.join('\n') });
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
    <>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        const cursor = streaming && index === blocks.length - 1
          ? <span className="ml-0.5 animate-pulse text-[var(--text-muted)]">▍</span> : null;
        switch (block.kind) {
          case 'h':
            return <p key={key} className={`font-semibold ${block.level <= 2 ? 'text-[15px]' : ''}`}>{inline(block.text, key)}{cursor}</p>;
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
          case 'code':
            return (
              <pre key={key} className="overflow-x-auto whitespace-pre rounded-xl bg-[color:color-mix(in_srgb,var(--text-primary)_7%,transparent)] p-2.5 font-mono text-[12.5px] leading-[18px]">
                {block.text}{cursor}
              </pre>
            );
          case 'quote':
            return <p key={key} className="border-l-2 border-[var(--border-medium)] pl-2.5 text-[var(--text-secondary)]">{inline(block.text, key)}{cursor}</p>;
          default:
            return <p key={key} className="whitespace-pre-wrap break-words">{inline(block.text, key)}{cursor}</p>;
        }
      })}
    </>
  );
}
