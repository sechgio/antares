import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Camera,
  ClipboardList,
  ClipboardPen,
  FileBarChart2,
  FileStack,
  FileText,
  FolderKanban,
  Grid2X2,
  House,
  Image,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  Megaphone,
  Paintbrush,
  PanelLeft,
  Pin,
  RefreshCw,
  ScrollText,
  Settings,
  Stamp,
  User,
  Workflow,
  Wrench,
  Zap,
} from 'lucide-react';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { cn } from '@/lib/utils';
import { TAB_DEFINITIONS, type TabId } from '../../navigation';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../hooks/useToast';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';
import { useLocalStorageState } from '../../hooks/useLocalStorageState';
import { useAnchoredPopover, type PopoverPosition } from '../../hooks/useAnchoredPopover';
import Button from '@/components/ui/Button';

// El import lazy mantiene Supabase fuera del bundle inicial del shell.
const TaskNotificationsBell = lazy(() => import('./TaskNotificationsBell'));

const SIDEBAR_STORAGE_KEY = 'antares_sidebar_expanded';
const RAIL_WIDTH = 48;
const PANEL_WIDTH = 232;
const ACCOUNT_MENU_WIDTH = 264;
const PEEK_CLOSE_DELAY_MS = 180;
const PEEK_INSET = 6;

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onPrefetchTab?: (tab: TabId) => void;
  onOpenSettings?: () => void;
  children?: ReactNode;
}

type IconComponent = ComponentType<{ className?: string; strokeWidth?: number }>;

const ICONS: Record<TabId, IconComponent> = {
  espacios: FolderKanban,
  convert: Zap,
  formatos: FileBarChart2,
  sellador: Stamp,
  padron: ScrollText,
  volantes: Megaphone,
  reportesCampo: Camera,
  technicalReports: ClipboardList,
  informesV2: ClipboardPen,
  imageOptimizer: Image,
  previewPanel: LayoutDashboard,
  canvas: Paintbrush,
  flows: Workflow,
  panelAvisoCorte: FileStack,
  ubicaciones: MapPin,
  evidenciaVolanteo: Grid2X2,
  autoimg: RefreshCw,
  fichasTecnicas: FileText,
};

const NAV_GROUPS: { id: string; label: string; icon: IconComponent; tabs: TabId[] }[] = [
  { id: 'general', label: 'General', icon: House, tabs: ['espacios'] },
  {
    id: 'produccion',
    label: 'Producción',
    icon: Zap,
    tabs: ['convert', 'formatos', 'sellador', 'padron', 'volantes'],
  },
  {
    id: 'reportes',
    label: 'Reportes',
    icon: FileBarChart2,
    tabs: [
      'reportesCampo',
      'technicalReports',
      'informesV2',
      'previewPanel',
      'canvas',
      'panelAvisoCorte',
      'evidenciaVolanteo',
      'fichasTecnicas',
    ],
  },
  {
    id: 'herramientas',
    label: 'Herramientas',
    icon: Wrench,
    tabs: ['imageOptimizer', 'ubicaciones', 'autoimg', 'flows'],
  },
];

const TAB_BY_ID = Object.fromEntries(TAB_DEFINITIONS.map((tab) => [tab.id, tab])) as Record<
  TabId,
  (typeof TAB_DEFINITIONS)[number]
>;

const RAIL_BG = 'bg-[linear-gradient(180deg,color-mix(in_srgb,var(--accent-primary)_34%,var(--bg-surface)),color-mix(in_srgb,var(--accent-primary)_22%,var(--bg-surface)))]';
const RAIL_ICON = 'flex size-8 items-center justify-center rounded-lg transition-[color,background-color,box-shadow,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.94] motion-reduce:active:scale-100';
const RAIL_ICON_IDLE = 'text-[color:color-mix(in_srgb,var(--accent-primary)_40%,var(--text-secondary))] hover:bg-[color:color-mix(in_srgb,var(--text-primary)_16%,transparent)] hover:text-[var(--text-primary)] hover:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--text-primary)_10%,transparent)]';
const RAIL_ICON_ON = 'bg-[var(--text-primary)] text-[var(--bg-base)] shadow-[0_1px_2px_rgba(0,0,0,0.16)]';
const RAIL_DIVIDER = 'my-1 h-px w-5 shrink-0 bg-[color:color-mix(in_srgb,var(--text-primary)_14%,transparent)]';
const PANEL_ROW = 'flex h-8 w-full shrink-0 items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-[color,background-color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.99] motion-reduce:active:scale-100';
const MENU_ITEM = 'flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-[var(--text-primary)] transition-colors duration-150 hover:bg-[color:color-mix(in_srgb,var(--text-primary)_7%,transparent)] disabled:pointer-events-none disabled:opacity-45';
const MENU_ICON = 'size-[15px] shrink-0 text-[var(--text-secondary)]';

function initialsOf(name: string | null, email: string) {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function placeBesideRail(trigger: DOMRect, popup: HTMLElement | null): PopoverPosition {
  const height = popup?.offsetHeight ?? 220;
  const top = Math.max(8, Math.min(trigger.bottom - height, window.innerHeight - height - 8));
  return { top, left: trigger.right + 12, width: ACCOUNT_MENU_WIDTH };
}

export default function Sidebar({ activeTab, onTabChange, onPrefetchTab, onOpenSettings, children }: SidebarProps) {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const { addToast } = useToast();
  const [expanded, setExpanded] = useLocalStorageState<boolean>(SIDEBAR_STORAGE_KEY, {
    parse: (raw) => raw === 'true',
    fallback: true,
    serialize: (value) => String(value),
  });
  const [signingOut, setSigningOut] = useState(false);
  const [browsed, setBrowsed] = useState<{ tab: TabId; group: string } | null>(null);
  const account = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    positioner: placeBesideRail,
    stopEscapePropagation: true,
  });

  const activeGroupId = NAV_GROUPS.find((group) => group.tabs.includes(activeTab))?.id ?? NAV_GROUPS[0].id;
  const shownGroupId = browsed?.tab === activeTab ? browsed.group : activeGroupId;
  const shownGroup = NAV_GROUPS.find((group) => group.id === shownGroupId) ?? NAV_GROUPS[0];

  const [peeking, setPeeking] = useState(false);
  const peekTimer = useRef<number | undefined>(undefined);

  const cancelPeekClose = useCallback(() => window.clearTimeout(peekTimer.current), []);
  const closePeek = useCallback(() => {
    cancelPeekClose();
    setPeeking(false);
  }, [cancelPeekClose]);
  const schedulePeekClose = useCallback(() => {
    cancelPeekClose();
    peekTimer.current = window.setTimeout(() => setPeeking(false), PEEK_CLOSE_DELAY_MS);
  }, [cancelPeekClose]);

  const toggleExpanded = useCallback(() => {
    closePeek();
    setExpanded((value) => !value);
  }, [closePeek]);

  useKeyboardShortcut('b', toggleExpanded, { ctrl: true, preventDefault: true });

  useEffect(() => () => window.clearTimeout(peekTimer.current), []);

  useEffect(() => {
    if (!peeking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePeek();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closePeek, peeking]);

  const peekGroup = (groupId: string) => {
    if (expanded) return;
    cancelPeekClose();
    setBrowsed({ tab: activeTab, group: groupId });
    setPeeking(true);
  };

  const showGroup = (groupId: string) => {
    closePeek();
    setBrowsed({ tab: activeTab, group: groupId });
    if (groupId !== shownGroupId || !expanded) setExpanded(true);
    else setExpanded(false);
  };

  const openTab = (tabId: TabId) => {
    closePeek();
    onTabChange(tabId);
  };

  const handleSignOut = useCallback(async () => {
    if (signingOut) return;
    account.close();
    setSigningOut(true);
    try {
      await signOut();
      addToast({ message: t('auth.signedOut'), type: 'success' });
    } finally {
      setSigningOut(false);
    }
  }, [account, addToast, signOut, signingOut, t]);

  const runFromMenu = (action: () => void) => {
    account.close();
    action();
  };

  const initials = user ? initialsOf(user.displayName, user.email) : '';

  const panelVisible = expanded || peeking;

  const panelBody = (
    <>
      <div className="flex h-11 shrink-0 items-center justify-between pl-3.5 pr-1.5">
        <h2 className="truncate text-[13.5px] font-semibold tracking-[-0.01em]">{shownGroup.label}</h2>
        <div className="relative shrink-0">
          <Button variant="none" size="none"
            data-testid="sidebar-toggle"
            aria-label={expanded ? 'Alternar barra lateral' : 'Fijar panel'}
            aria-expanded={expanded}
            onClick={toggleExpanded}
            className="flex size-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-[color,background-color,transform] duration-150 ease-[var(--ease-out)] hover:bg-[color:color-mix(in_srgb,var(--text-primary)_8%,transparent)] hover:text-[var(--text-primary)] active:scale-[0.94] motion-reduce:active:scale-100"
          >
            {expanded ? <PanelLeft className="size-[15px]" strokeWidth={1.75} /> : <Pin className="size-[15px]" strokeWidth={1.75} />}
          </Button>
          <HoverTooltip label={expanded ? 'Ocultar panel' : 'Fijar panel'} shortcut="Ctrl+B" />
        </div>
      </div>

      <nav aria-label={shownGroup.label} className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto overflow-x-hidden px-1.5 pb-1.5">
        {shownGroup.tabs.map((tabId) => {
          const tab = TAB_BY_ID[tabId];
          const isActive = activeTab === tabId;
          const Icon = ICONS[tabId];
          return (
            <Button variant="none" size="none"
              key={tabId}
              onClick={() => openTab(tabId)}
              onMouseEnter={() => onPrefetchTab?.(tabId)}
              onFocus={() => onPrefetchTab?.(tabId)}
              aria-current={isActive ? 'page' : undefined}
              data-active={isActive ? 'true' : undefined}
              className={cn(
                PANEL_ROW,
                isActive
                  ? 'bg-[color:color-mix(in_srgb,var(--text-primary)_9%,transparent)] font-medium text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)] hover:text-[var(--text-primary)]',
              )}
            >
              <Icon className={cn('size-[15px] shrink-0', isActive && 'text-[var(--accent-primary)]')} strokeWidth={1.75} />
              <span className="min-w-0 truncate">{tab.label}</span>
            </Button>
          );
        })}
      </nav>
    </>
  );

  return (
    <div data-slot="sidebar-shell" className={cn('relative flex min-h-0 min-w-0 flex-1 py-1.5 pr-1.5', RAIL_BG)}>
      <aside
        data-testid="app-sidebar"
        data-expanded={expanded ? 'true' : 'false'}
        data-peeking={peeking ? 'true' : 'false'}
        data-slot="sidebar"
        aria-label="Barra lateral de navegación"
        className="flex shrink-0 flex-col items-center gap-1 pb-0.5 pt-0.5"
        style={{ width: RAIL_WIDTH }}
        onMouseLeave={schedulePeekClose}
      >
        <nav aria-label="Grupos" className="flex flex-col items-center gap-1">
          {NAV_GROUPS.map((group, index) => {
            const Icon = group.icon;
            const isShown = panelVisible && group.id === shownGroupId;
            const hasActive = group.id === activeGroupId;
            return (
              <div key={group.id} className="flex flex-col items-center gap-1">
                {index === 1 && <span className={RAIL_DIVIDER} aria-hidden />}
                <div className="relative">
                  <Button variant="none" size="none"
                    data-testid={`sidebar-group-${group.id}`}
                    aria-label={group.label}
                    aria-pressed={isShown}
                    onClick={() => showGroup(group.id)}
                    onMouseEnter={() => peekGroup(group.id)}
                    onFocus={() => peekGroup(group.id)}
                    className={cn(RAIL_ICON, isShown || (!panelVisible && hasActive) ? RAIL_ICON_ON : RAIL_ICON_IDLE)}
                  >
                    <Icon className="size-4" strokeWidth={1.75} />
                  </Button>
                  {expanded && <HoverTooltip label={group.label} />}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="flex flex-1 flex-col items-center justify-end gap-1 self-stretch" onMouseEnter={schedulePeekClose}>
          <Suspense fallback={<div className="size-8" aria-hidden />}>
            <TaskNotificationsBell
              triggerClassName={cn(RAIL_ICON, RAIL_ICON_IDLE)}
              onOpenEspacios={() => onTabChange('espacios')}
            />
          </Suspense>
          <span className={RAIL_DIVIDER} aria-hidden />

          <div className="relative">
            <Button variant="none" size="none"
              ref={account.triggerRef}
              data-testid="sidebar-account-button"
              aria-label="Abrir menú de cuenta"
              aria-haspopup="menu"
              aria-expanded={account.isOpen}
              onClick={account.toggle}
              className={cn(
                'flex size-7 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[11px] font-semibold text-[var(--text-on-accent)] transition-[box-shadow,transform] duration-150 ease-[var(--ease-out)] hover:scale-105 active:scale-[0.94] motion-reduce:hover:scale-100 motion-reduce:active:scale-100',
                account.isOpen && 'ring-2 ring-[color:color-mix(in_srgb,var(--accent-primary)_45%,transparent)] ring-offset-2 ring-offset-transparent',
              )}
            >
              {user ? initials : <User className="size-[15px]" strokeWidth={1.9} />}
            </Button>
            {!account.isOpen && <HoverTooltip label="Cuenta" />}
          </div>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <div
          aria-hidden={!expanded}
          inert={!expanded ? true : undefined}
          className={cn(
            'shrink-0 overflow-hidden transition-[width] duration-[260ms] ease-[var(--ease-drawer)] motion-reduce:transition-none',
            !expanded && 'pointer-events-none',
          )}
          style={{ width: expanded ? PANEL_WIDTH : 0 }}
        >
          <div
            className={cn(
              'flex h-full flex-col border-r border-[var(--sidebar-border)] bg-[color:color-mix(in_srgb,var(--text-primary)_3%,var(--bg-surface))] text-[var(--sidebar-foreground)] transition-[opacity,transform] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none',
              expanded ? 'translate-x-0 opacity-100' : '-translate-x-3 opacity-0',
            )}
            style={{ width: PANEL_WIDTH }}
          >
            {expanded && panelBody}
          </div>
        </div>

        {children}
      </div>

      {!expanded && (
        <div
          data-testid="sidebar-peek"
          aria-hidden={!peeking}
          inert={!peeking ? true : undefined}
          onMouseEnter={cancelPeekClose}
          onMouseLeave={schedulePeekClose}
          className={cn(
            'absolute bottom-3 top-3 z-40 flex flex-col rounded-md [-webkit-app-region:no-drag] border border-[color:color-mix(in_srgb,var(--text-primary)_7%,transparent)] bg-[color:color-mix(in_srgb,var(--text-primary)_4%,var(--bg-surface))] text-[var(--sidebar-foreground)] shadow-[0_16px_48px_rgba(0,0,0,0.28),0_2px_8px_rgba(0,0,0,0.10)] transition-[opacity,transform] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none',
            peeking ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-2 opacity-0',
          )}
          style={{ left: RAIL_WIDTH + PEEK_INSET, width: PANEL_WIDTH }}
        >
          {panelBody}
        </div>
      )}

      {account.isOpen && createPortal(
        <div
          ref={account.popupRef}
          role="menu"
          aria-label="Cuenta"
          data-testid="sidebar-account-menu"
          className="fixed z-50 flex flex-col rounded-xl border border-[var(--border-medium)] bg-[color:color-mix(in_srgb,var(--text-primary)_4%,var(--bg-surface))] p-1 text-[var(--popover-foreground)] shadow-[0_16px_40px_rgba(0,0,0,0.22),0_2px_6px_rgba(0,0,0,0.08)]"
          style={{
            top: account.position?.top ?? -9999,
            left: account.position?.left ?? -9999,
            width: ACCOUNT_MENU_WIDTH,
            visibility: account.position ? 'visible' : 'hidden',
          }}
        >
          <div className="flex items-center gap-2.5 px-2.5 pb-2.5 pt-2">
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[12px] font-semibold text-[var(--text-on-accent)]"
              aria-hidden="true"
            >
              {user ? initials : <User className="size-4" strokeWidth={1.9} />}
            </span>
            {user ? (
              <div className="flex min-w-0 flex-col">
                {user.displayName && <span className="truncate text-[13.5px] font-semibold">{user.displayName}</span>}
                <span className="truncate text-[12px] text-[var(--text-secondary)]">{user.email}</span>
              </div>
            ) : (
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[13.5px] font-semibold">Sin sesión</span>
                <span className="truncate text-[12px] text-[var(--text-secondary)]">Inicia sesión para usar Espacios</span>
              </div>
            )}
          </div>
          <div className="-mx-1 mb-1 h-px bg-[var(--border-subtle)]" />
          <Button variant="none" size="none" role="menuitem" disabled className={MENU_ITEM}>
            <User className={MENU_ICON} strokeWidth={1.75} />
            Cuenta
          </Button>
          {onOpenSettings && (
            <Button variant="none" size="none" role="menuitem" onClick={() => runFromMenu(onOpenSettings)} className={MENU_ITEM}>
              <Settings className={MENU_ICON} strokeWidth={1.75} />
              Configuración
            </Button>
          )}
          <div className="-mx-1 my-1 h-px bg-[var(--border-subtle)]" />
          {user ? (
          <Button variant="none" size="none"
            role="menuitem"
            data-testid="sidebar-signout-button"
            disabled={signingOut}
            onClick={handleSignOut}
            className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-[var(--accent-red)] transition-colors duration-150 hover:bg-[color:color-mix(in_srgb,var(--accent-red)_12%,transparent)] disabled:opacity-50"
          >
            <LogOut className="size-[15px]" strokeWidth={1.75} />
            {t('auth.signOut')}
          </Button>
          ) : (
            <Button variant="none" size="none"
              role="menuitem"
              data-testid="sidebar-signin-button"
              onClick={() => runFromMenu(() => onTabChange('espacios'))}
              className={MENU_ITEM}
            >
              <LogIn className={MENU_ICON} strokeWidth={1.75} />
              Iniciar sesión
            </Button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
