import { Suspense, lazy } from 'react';
import { Minus, Square, X, Settings } from 'lucide-react';
import UpdateButton from './UpdateButton';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import Button from '@/components/ui/Button';

// La campana arrastra useDueNotifications → la API de espacios → @supabase/supabase-js.
// Importarla en directo metería ese vendor en el grafo estático del shell (lo mide
// frontend/scripts/shell-preload-budget.mjs) y el arranque en frío lo pagaría.
const TaskNotificationsBell = lazy(() => import('./TaskNotificationsBell'));

const bellPlaceholder = (
  <div className="relative flex h-full" aria-hidden>
    <div className="h-full w-10" />
  </div>
);

function handleWindowAction(action: 'minimizeWindow' | 'maximizeWindow' | 'closeWindow') {
  window.electronAPI?.[action]?.();
}

interface TitleBarProps {
  onOpenSettings?: () => void;
  onPrefetchSettings?: () => void;
  onOpenEspacios?: () => void;
}

export default function TitleBar({ onOpenSettings, onPrefetchSettings, onOpenEspacios }: TitleBarProps) {
  return (
    <div
      data-testid="app-titlebar"
      className="app-titlebar flex h-9 shrink-0 items-center justify-end overflow-visible border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] select-none"
    >
      <div className="app-titlebar-controls flex h-full items-stretch overflow-visible">
        <Suspense fallback={bellPlaceholder}>
          <TaskNotificationsBell onOpenEspacios={onOpenEspacios} />
        </Suspense>
        <UpdateButton />
        {onOpenSettings && (
          <div className="group relative flex h-full">
            <Button variant="none" size="none"
              data-testid="titlebar-settings-button"
              aria-label="Configuración"
              onClick={onOpenSettings}
              onMouseEnter={onPrefetchSettings}
              onFocus={onPrefetchSettings}
              className="app-titlebar-button flex h-full w-10 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            >
              <Settings size={14} strokeWidth={1.8} className="transition-transform duration-300 group-hover:rotate-45" />
            </Button>
            <HoverTooltip label="Configuración" placement="bottom" />
          </div>
        )}
        <div className="relative flex h-full">
          <Button variant="none" size="none"
            aria-label="Minimizar"
            onClick={() => handleWindowAction('minimizeWindow')}
            className="app-titlebar-button flex h-full w-12 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <Minus size={14} strokeWidth={1.8} />
          </Button>
          <HoverTooltip label="Minimizar" placement="bottom" />
        </div>
        <div className="relative flex h-full">
          <Button variant="none" size="none"
            aria-label="Maximizar"
            onClick={() => handleWindowAction('maximizeWindow')}
            className="app-titlebar-button flex h-full w-12 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <Square size={11} strokeWidth={1.8} />
          </Button>
          <HoverTooltip label="Maximizar" placement="bottom" />
        </div>
        <div className="relative flex h-full">
          <Button variant="none" size="none"
            aria-label="Cerrar"
            onClick={() => handleWindowAction('closeWindow')}
            className="app-titlebar-button flex h-full w-12 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-red)] hover:text-[var(--text-on-accent)]"
          >
            <X size={15} strokeWidth={1.8} />
          </Button>
          <HoverTooltip label="Cerrar" placement="bottom" />
        </div>
      </div>
    </div>
  );
}
