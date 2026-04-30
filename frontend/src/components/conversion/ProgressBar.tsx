interface ProgressBarProps {
  progress: number;
}

export default function ProgressBar({ progress }: ProgressBarProps) {
  const pct = Math.round(progress);
  return (
    <div className="fixed top-0 left-0 right-0 z-50">
      <div className="h-1 bg-[var(--border-subtle)]">
        <div
          className="h-full bg-[var(--accent-primary)] transition-all duration-300 ease-out shadow-[0_0_10px_rgba(94,106,210,0.5)]"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="absolute right-3 top-2 px-2 py-0.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[11px] font-semibold text-[var(--accent-primary)] shadow-sm">
        {pct}%
      </div>
    </div>
  );
}
