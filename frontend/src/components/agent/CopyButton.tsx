import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export default function CopyButton({ text, label = 'Copiar respuesta', className = 'group-hover:opacity-100' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`flex size-5 items-center justify-center rounded-md text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] focus-visible:opacity-100 ${className}`}
      aria-label={copied ? 'Copiado' : label}
      title={copied ? 'Copiado' : 'Copiar'}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }}
    >
      {copied ? <Check size={13} className="text-[var(--accent-green)]" /> : <Copy size={13} />}
    </button>
  );
}
