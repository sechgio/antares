import { Suspense, lazy } from 'react';
import { Minus, Square, X } from 'lucide-react';
import UpdateButton from './UpdateButton';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import Button from '@/components/ui/Button';
import { usePluginEnabled } from '../../plugins';
import { cn } from '@/lib/utils';

// Los plugins se cargan aparte para excluir dnd-kit del bundle inicial.
const TitleBarPlugins = lazy(() => import('./TitleBarPlugins'));

const WINDOW_BUTTON = 'app-titlebar-button flex size-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors';

function handleWindowAction(action: 'minimizeWindow' | 'maximizeWindow' | 'closeWindow') {
  window.electronAPI?.[action]?.();
}

export default function TitleBar() {
  const radioEnabled = usePluginEnabled('radio-live');
  const spotifyEnabled = usePluginEnabled('spotify');
  const audiusEnabled = usePluginEnabled('audius');
  const jamendoEnabled = usePluginEnabled('jamendo');
  const archiveEnabled = usePluginEnabled('archive');
  const hasTitlebarPlugins = radioEnabled || spotifyEnabled || audiusEnabled || jamendoEnabled || archiveEnabled;
  return (
    <div
      data-testid="app-titlebar"
      className="app-titlebar flex h-11 shrink-0 items-center justify-end overflow-visible pr-2 text-[var(--text-secondary)] select-none"
    >
      <div className="app-titlebar-controls flex h-8 items-stretch overflow-visible">
        {hasTitlebarPlugins && (
          <Suspense fallback={null}>
            <TitleBarPlugins />
          </Suspense>
        )}
        <UpdateButton />
      </div>
      <span className="mx-2 h-4 w-px bg-[var(--border-medium)]" aria-hidden />
      <div className="app-titlebar-controls flex items-center gap-0.5">
        <div className="relative">
          <Button variant="none" size="none"
            aria-label="Minimizar"
            onClick={() => handleWindowAction('minimizeWindow')}
            className={cn(WINDOW_BUTTON, 'hover:bg-[var(--sidebar-accent)] hover:text-[var(--text-primary)]')}
          >
            <Minus size={14} strokeWidth={1.8} />
          </Button>
          <HoverTooltip label="Minimizar" placement="bottom" />
        </div>
        <div className="relative">
          <Button variant="none" size="none"
            aria-label="Maximizar"
            onClick={() => handleWindowAction('maximizeWindow')}
            className={cn(WINDOW_BUTTON, 'hover:bg-[var(--sidebar-accent)] hover:text-[var(--text-primary)]')}
          >
            <Square size={11} strokeWidth={1.8} />
          </Button>
          <HoverTooltip label="Maximizar" placement="bottom" />
        </div>
        <div className="relative">
          <Button variant="none" size="none"
            aria-label="Cerrar"
            onClick={() => handleWindowAction('closeWindow')}
            className={cn(WINDOW_BUTTON, 'hover:bg-[var(--accent-red)] hover:text-[var(--text-on-accent)]')}
          >
            <X size={15} strokeWidth={1.8} />
          </Button>
          <HoverTooltip label="Cerrar" placement="bottom" />
        </div>
      </div>
    </div>
  );
}
