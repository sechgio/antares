import { useState, type ReactNode } from 'react';
import { WrapText } from 'lucide-react';
import CopyButton from './CopyButton';

export default function MarkdownCodeBlock({
  lang,
  text,
  open,
  cursor,
}: {
  lang?: string;
  text: string;
  open?: true;
  cursor?: ReactNode;
}) {
  const [wrapped, setWrapped] = useState(false);
  const wrapLabel = wrapped ? 'No ajustar líneas' : 'Ajustar líneas';
  return (
    <div className="group/code overflow-hidden rounded-xl bg-[color:color-mix(in_srgb,var(--text-primary)_7%,transparent)]">
      <div className="flex h-7 items-center justify-between border-b border-[var(--border-subtle)] pl-2.5 pr-1.5 font-mono text-[11px] text-[var(--text-muted)]">
        {lang || 'código'}
        {!open && (
          <span className="flex items-center gap-1">
            <button
              type="button"
              aria-label={wrapLabel}
              aria-pressed={wrapped}
              title={wrapLabel}
              onClick={() => setWrapped(!wrapped)}
              className={`flex size-5 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-[var(--bg-input)] focus-visible:opacity-100 group-hover/code:opacity-100 ${wrapped ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
              <WrapText size={13} />
            </button>
            <CopyButton text={text} label="Copiar código" className="group-hover/code:opacity-100" />
          </span>
        )}
      </div>
      <pre
        className={`p-2.5 font-mono text-[12.5px] leading-[18px] ${wrapped ? 'whitespace-pre-wrap break-words' : 'overflow-x-auto whitespace-pre'}`}
      >
        {text}
        {cursor}
      </pre>
    </div>
  );
}
