import { useEffect, useId, useRef, useState } from 'react';
import { Brain, ChevronRight } from 'lucide-react';

function thoughtLabel(ms?: number): string {
  if (ms === undefined) return 'Pensó';
  const seconds = Math.round(ms / 1000);
  if (seconds < 1) return 'Pensó menos de 1 s';
  if (seconds < 60) return `Pensó durante ${seconds} s`;
  return `Pensó durante ${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export default function Reasoning({ text, streaming, ms }: { text: string; streaming: boolean; ms?: number }) {
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const bodyId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const open = openOverride ?? streaming;

  useEffect(() => {
    const body = bodyRef.current;
    if (streaming && open && body && body.scrollHeight - body.scrollTop - body.clientHeight < 48) body.scrollTop = body.scrollHeight;
  }, [text, streaming, open]);

  return (
    <div className="agent-trace-in w-full max-w-[min(620px,100%)]">
      <button
        type="button"
        className="group/reasoning flex items-center gap-1.5 rounded-md py-0.5 text-left text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
        onClick={() => setOpenOverride(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
      >
        <Brain size={13} className={`shrink-0 ${streaming ? 'text-[var(--accent-primary-hover)]' : ''}`} />
        <span className={`font-medium ${streaming ? 'agent-shimmer' : 'tabular-nums'}`}>{streaming ? 'Pensando…' : thoughtLabel(ms)}</span>
        <ChevronRight
          size={11}
          className={`shrink-0 transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
        />
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="agent-subagent-body overflow-hidden" inert={!open} aria-hidden={!open}>
          <div
            ref={bodyRef}
            id={bodyId}
            className="custom-scrollbar mt-1.5 max-h-60 overflow-y-auto whitespace-pre-wrap break-words border-l border-[var(--border-medium)] pl-3 text-[12.5px] leading-[19px] text-[var(--text-secondary)]"
          >
            {text}
          </div>
        </div>
      </div>
    </div>
  );
}
