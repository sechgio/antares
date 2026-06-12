import { Minus, Square, X } from 'lucide-react';
import UpdateButton from './UpdateButton';

function handleWindowAction(action: 'minimizeWindow' | 'maximizeWindow' | 'closeWindow') {
  window.electronAPI?.[action]?.();
}

export default function TitleBar() {
  return (
    <div
      data-testid="app-titlebar"
      className="app-titlebar flex h-9 shrink-0 items-center justify-end border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] select-none"
    >
      <div className="app-titlebar-controls flex h-full items-stretch">
        <UpdateButton />
        <button
          type="button"
          aria-label="Minimizar"
          title="Minimizar"
          onClick={() => handleWindowAction('minimizeWindow')}
          className="app-titlebar-button flex w-12 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          <Minus size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="Maximizar"
          title="Maximizar"
          onClick={() => handleWindowAction('maximizeWindow')}
          className="app-titlebar-button flex w-12 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          <Square size={11} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="Cerrar"
          title="Cerrar"
          onClick={() => handleWindowAction('closeWindow')}
          className="app-titlebar-button flex w-12 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-red)] hover:text-white"
        >
          <X size={15} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
