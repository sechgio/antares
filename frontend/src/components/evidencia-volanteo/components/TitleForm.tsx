import { Type } from 'lucide-react';

interface Props {
  title: string;
  onTitleChange: (value: string) => void;
}

export default function TitleForm({ title, onTitleChange }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-1.5 text-[var(--text-muted)]" htmlFor="ev-titulo">
        <Type size={14} />
        <span className="text-[11px] font-semibold uppercase tracking-wider">Título del Documento</span>
      </label>
      <textarea
        id="ev-titulo"
        rows={4}
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5 text-xs text-[var(--text-primary)] resize-none focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)] focus:border-[var(--accent-primary)] transition-all shadow-sm placeholder:text-[var(--text-muted)]/50"
        placeholder={'EVIDENCIAS FOTOGRÁFICAS DEL VOLANTEO\nCORTE DE SERVICIO DIA 26.05.2026'}
      />
    </div>
  );
}