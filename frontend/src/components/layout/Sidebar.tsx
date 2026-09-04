import { useCallback, useEffect, useState, type ComponentType } from 'react';
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
  Image,
  LayoutDashboard,
  LogOut,
  MapPin,
  Megaphone,
  Paintbrush,
  PanelLeft,
  RefreshCw,
  ScrollText,
  Stamp,
  Zap,
} from 'lucide-react';
import BrandMark from '../brand/BrandMark';
import { Separator } from '@/components/ui/separator';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { cn } from '@/lib/utils';
import { TAB_DEFINITIONS, type TabId } from '../../navigation';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../hooks/useToast';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';

const SIDEBAR_STORAGE_KEY = 'antares_sidebar_expanded';
const SIDEBAR_WIDTH_EXPANDED = 200;
const SIDEBAR_WIDTH_COLLAPSED = 44;

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onPrefetchTab?: (tab: TabId) => void;
}

const ICONS: Record<TabId, ComponentType<{ className?: string }>> = {
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
  panelAvisoCorte: FileStack,
  ubicaciones: MapPin,
  evidenciaVolanteo: Grid2X2,
  autoimg: RefreshCw,
  fichasTecnicas: FileText,
};

const NAV_GROUPS: { id: string; tabs: TabId[] }[] = [
  { id: 'general', tabs: ['espacios'] },
  {
    id: 'produccion',
    tabs: ['convert', 'formatos', 'sellador', 'padron', 'volantes'],
  },
  {
    id: 'reportes',
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
    tabs: ['imageOptimizer', 'ubicaciones', 'autoimg'],
  },
];

const TAB_BY_ID = Object.fromEntries(TAB_DEFINITIONS.map((tab) => [tab.id, tab])) as Record<
  TabId,
  (typeof TAB_DEFINITIONS)[number]
>;

function readStoredExpanded(): boolean {
  try {
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

export default function Sidebar({ activeTab, onTabChange, onPrefetchTab }: SidebarProps) {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const { addToast } = useToast();
  const [expanded, setExpanded] = useState(readStoredExpanded);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(expanded));
    } catch {
    }
  }, [expanded]);

  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);

  useKeyboardShortcut('b', toggleExpanded, { ctrl: true, preventDefault: true });

  const handleSignOut = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      addToast({ message: t('auth.signedOut'), type: 'success' });
    } finally {
      setSigningOut(false);
    }
  }, [addToast, signOut, signingOut, t]);

  return (
    <aside
      data-testid="app-sidebar"
      data-expanded={expanded ? 'true' : 'false'}
      data-slot="sidebar"
      aria-label="Barra lateral de navegación"
      className="flex min-w-0 shrink-0 flex-col overflow-visible border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] text-[var(--sidebar-foreground)] transition-[width] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none"
      style={{ width: expanded ? SIDEBAR_WIDTH_EXPANDED : SIDEBAR_WIDTH_COLLAPSED }}
    >
      <div className="flex h-11 shrink-0 items-center gap-1.5 px-1.5">
        <div className="group/toggle relative shrink-0">
          <button
            type="button"
            data-testid="sidebar-toggle"
            aria-label="Alternar barra lateral"
            aria-expanded={expanded}
            onClick={toggleExpanded}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-[color,background-color,transform] duration-150 ease-[var(--ease-out)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)] active:scale-[0.97] motion-reduce:active:scale-100"
          >
            <PanelLeft className="size-4" strokeWidth={1.75} />
          </button>
          <HoverTooltip label={expanded ? 'Hide Sidebar' : 'Show Sidebar'} groupHoverClass="group-hover/toggle:opacity-100" />
        </div>
        <div
          className={cn(
            'min-w-0 overflow-hidden transition-[max-width,opacity] duration-150 ease-[var(--ease-out)] motion-reduce:transition-none',
            expanded ? 'max-w-[140px] opacity-100' : 'max-w-0 opacity-0',
          )}
        >
          <BrandMark showText size="md" />
        </div>
      </div>

      {expanded && <Separator className="mx-1.5 -mb-px w-auto" />}

      <nav
        className={cn(
          'flex min-h-0 flex-1 flex-col py-2',
          expanded ? 'gap-0.5 overflow-y-auto overflow-x-hidden px-1.5' : 'items-center gap-0.5 overflow-visible px-1.5',
        )}
      >
        {NAV_GROUPS.map((group) => (
          <div
            key={group.id}
            className={cn('relative flex w-full min-w-0 flex-col gap-0.5', !expanded && 'items-start')}
            data-slot="sidebar-group"
          >
            {group.tabs.map((tabId) => {
              const tab = TAB_BY_ID[tabId];
              const isActive = activeTab === tabId;
              const Icon = ICONS[tabId];
              return (
                <div key={tabId} className={cn('relative', !expanded && 'group/nav-item flex size-8 items-center')}>
                  <button
                    type="button"
                    onClick={() => onTabChange(tabId)}
                    onMouseEnter={() => onPrefetchTab?.(tabId)}
                    onFocus={() => onPrefetchTab?.(tabId)}
                    aria-label={tab.label}
                    aria-current={isActive ? 'page' : undefined}
                    data-active={isActive ? 'true' : undefined}
                    className={cn(
                      'group/menu-button flex items-center rounded-md text-left transition-[color,background-color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.97] motion-reduce:active:scale-100',
                      expanded ? 'h-8 w-full gap-2 px-2 py-1.5' : 'size-8 shrink-0 justify-start gap-0 p-0 pl-2',
                      isActive
                        ? 'bg-[var(--sidebar-accent)] font-medium text-[var(--sidebar-accent-foreground)]'
                        : 'text-[var(--text-muted)] hover:bg-[var(--sidebar-accent)]/60 hover:text-[var(--text-secondary)]',
                    )}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      <Icon
                        className={cn(
                          'size-4',
                          isActive ? 'text-[var(--sidebar-primary)]' : 'text-current',
                        )}
                      />
                    </span>
                    <span
                      className={cn(
                        'min-w-0 max-w-0 overflow-hidden truncate whitespace-nowrap text-[13px] opacity-0 transition-[max-width,opacity] duration-150 ease-[var(--ease-out)] motion-reduce:transition-none',
                        expanded ? 'max-w-[140px] opacity-100' : 'pointer-events-none',
                      )}
                      aria-hidden="true"
                    >
                      {tab.label}
                    </span>
                  </button>
                  {!expanded && (
                    <HoverTooltip label={tab.label} groupHoverClass="group-hover/nav-item:opacity-100" />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      {expanded && user && <Separator className="mx-1.5 w-auto" />}

      {user && (
        <div className="shrink-0 px-1.5 py-1.5">
          <div className={cn('relative', !expanded && 'group/signout flex size-8 items-start')}>
            <button
              type="button"
              data-testid="sidebar-signout-button"
              aria-label={t('auth.signOut')}
              disabled={signingOut}
              onClick={handleSignOut}
              className={cn(
                'flex items-center rounded-md text-left text-[var(--text-muted)] transition-[color,background-color,transform] duration-150 ease-[var(--ease-out)] hover:bg-[var(--sidebar-accent)]/60 hover:text-[var(--text-secondary)] active:scale-[0.97] disabled:opacity-50 motion-reduce:active:scale-100',
                expanded ? 'h-8 w-full gap-2 px-2 py-1.5' : 'size-8 shrink-0 justify-start gap-0 p-0 pl-2',
              )}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                <LogOut className="size-4" strokeWidth={1.75} />
              </span>
              <span
                className={cn(
                  'min-w-0 max-w-0 overflow-hidden truncate whitespace-nowrap text-[13px] font-medium opacity-0 transition-[max-width,opacity] duration-150 ease-[var(--ease-out)] motion-reduce:transition-none',
                  expanded ? 'max-w-[140px] opacity-100' : 'pointer-events-none',
                )}
                aria-hidden="true"
              >
                {t('auth.signOut')}
              </span>
            </button>
            {!expanded && (
              <HoverTooltip label={t('auth.signOut')} groupHoverClass="group-hover/signout:opacity-100" />
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
