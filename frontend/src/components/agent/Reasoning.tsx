import { useEffect, useId, useRef, useState } from 'react';
import { Brain, ChevronRight } from 'lucide-react';
import MessageMarkdown from './MessageMarkdown';
import { thinkingPhrase } from './statusPhrase';

function thoughtLabel(ms?: number): [string, string] {
  if (ms === undefined) return ['Pensó', ''];
  const seconds = Math.round(ms / 1000);
  if (seconds < 1) return ['Pensó', ' menos de 1 s'];
  if (seconds < 60) return ['Pensó', ` durante ${seconds} s`];
  return ['Pensó', ` durante ${Math.floor(seconds / 60)} min ${seconds % 60} s`];
}

export function ThinkingStatus({ seed }: { seed: string }) {
  const label = thinkingPhrase(seed);
  return (
    <p className="flex min-h-6 items-center gap-2 py-0.5 text-[13px] leading-5 text-[var(--text-muted)]" role="status">
      <Brain size={14} aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]" />
      <span className="agent-shimmer">{label}</span>
    </p>
  );
}

export default function Reasoning({
  text,
  streaming,
  ms,
  defaultOpen = false,
}: {
  text: string;
  streaming: boolean;
  ms?: number;
  defaultOpen?: boolean;
}) {
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const bodyId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const open = openOverride ?? (streaming || defaultOpen);
  const [verb, duration] = thoughtLabel(ms);

  useEffect(() => {
    const body = bodyRef.current;
    if (streaming && open && body && body.scrollHeight - body.scrollTop - body.clientHeight < 48)
      body.scrollTop = body.scrollHeight;
  }, [text, streaming, open]);

  return (
    <div className="agent-trace-in w-full">
      <button
        type="button"
        className="agent-tool-row group/reasoning flex min-h-6 w-full max-w-full items-center gap-2 py-0.5 text-left text-[13px] leading-5 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        onClick={() => setOpenOverride(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
      >
        <Brain size={14} aria-hidden="true" className={`shrink-0 ${streaming ? 'text-[var(--text-secondary)]' : ''}`} />
        {streaming ? (
          <span className="agent-shimmer shrink-0">Pensando…</span>
        ) : (
          <span className="shrink-0 tabular-nums">
            <span className="text-[var(--text-secondary)]">{verb}</span>
            {duration}
          </span>
        )}
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={`ml-auto shrink-0 transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
        />
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="agent-subagent-body overflow-hidden" inert={!open} aria-hidden={!open}>
          <div
            ref={bodyRef}
            id={bodyId}
            data-streaming={streaming || undefined}
            className={`agent-reasoning-body custom-scrollbar mb-1 ml-[22px] mt-0.5 space-y-1.5 overflow-y-auto break-words text-[12.5px] leading-[19px] text-[var(--text-muted)] ${streaming ? 'max-h-24' : 'max-h-60'}`}
          >
            <MessageMarkdown text={text} />
          </div>
        </div>
      </div>
    </div>
  );
}
