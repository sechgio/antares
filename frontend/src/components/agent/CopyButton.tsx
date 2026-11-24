import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

function writeClipboard(text: string, html?: string): Promise<void> {
  if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    return navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })]);
  }
  return navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('Portapapeles no disponible'));
}

export default function CopyButton({ text, html, label = 'Copiar respuesta', className = 'group-hover:opacity-100' }: { text: string; html?: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`flex size-5 items-center justify-center rounded-md text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] focus-visible:opacity-100 ${className}`}
      aria-label={copied ? 'Copiado' : label}
      title={copied ? 'Copiado' : 'Copiar'}
      onClick={() => {
        void writeClipboard(text, html).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }}
    >
      {copied ? <Check size={13} className="text-[var(--accent-green)]" /> : <Copy size={13} />}
    </button>
  );
}
