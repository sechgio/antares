interface Props {
  format: 'pdf' | 'docx';
  onFormatChange: (format: 'pdf' | 'docx') => void;
}

export default function ExportBar({ format, onFormatChange }: Props) {
  return (
    <div className="flex bg-[var(--bg-surface)] rounded-md border border-[var(--border-subtle)] p-1">
      {(['pdf', 'docx'] as const).map((fmt) => (
        <button
          key={fmt}
          type="button"
          onClick={() => onFormatChange(fmt)}
          className={`flex-1 py-1.5 text-[11px] font-semibold rounded transition-all duration-200 ${
            format === fmt
              ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_1px_3px_rgba(0,0,0,0.1)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-base)]'
          }`}
        >
          {fmt === 'pdf' ? 'Documento PDF' : 'Documento Word'}
        </button>
      ))}
    </div>
  );
}