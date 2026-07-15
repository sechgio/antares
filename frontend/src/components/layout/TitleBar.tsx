import { Minus, Square, X, Settings } from 'lucide-react';
import TaskNotificationsBell from './TaskNotificationsBell';
import UpdateButton from './UpdateButton';

function handleWindowAction(action: 'minimizeWindow' | 'maximizeWindow' | 'closeWindow') {
  window.electronAPI?.[action]?.();
}

interface TitleBarProps {
  onOpenSettings?: () => void;
  onOpenEspacios?: () => void;
}

export default function TitleBar({ onOpenSettings, onOpenEspacios }: TitleBarProps) {
  return (
    <div
      data-testid="app-titlebar"
      className="app-titlebar flex h-9 shrink-0 items-center justify-end border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] select-none"
    >
      <div className="app-titlebar-controls flex h-full items-stretch">
        <TaskNotificationsBell onOpenEspacios={onOpenEspacios} />
        <UpdateButton />
        {onOpenSettings && (
          <button
            type="button"
            data-testid="titlebar-settings-button"
            aria-label="Configuración"
            title="Configuración"
            onClick={onOpenSettings}
            className="app-titlebar-button group flex h-full w-10 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <Settings size={14} strokeWidth={1.8} className="transition-transform duration-300 group-hover:rotate-45" />
          </button>
        )}
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
          className="app-titlebar-button flex w-12 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-red)] hover:text-[var(--text-on-accent)]"
        >
          <X size={15} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
