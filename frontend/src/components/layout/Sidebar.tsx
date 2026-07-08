import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, ClipboardList, FolderKanban, LogOut, PanelLeft } from 'lucide-react';
import BrandMark from '../brand/BrandMark';
import { TAB_DEFINITIONS, type TabId } from '../../navigation';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../hooks/useToast';

const SIDEBAR_STORAGE_KEY = 'antares_sidebar_expanded';
const SIDEBAR_WIDTH_EXPANDED = 240;
const SIDEBAR_WIDTH_COLLAPSED = 52;

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const ICONS: Record<TabId, ComponentType<{ className?: string }>> = {
  espacios: FolderKanban,
  convert: LightningIcon,
  formatos: FilePdfIcon,
  sellador: StampIcon,
  padron: ScrollTextIcon,
  volantes: MegaphoneIcon,
  reportesCampo: Camera,
  technicalReports: ClipboardList,
  imageOptimizer: ImageOptimizerIcon,
  previewPanel: PreviewPanelIcon,
  panelAvisoCorte: PanelAvisoCorteIcon,
  ubicaciones: MapPinIcon,
  evidenciaVolanteo: EvidenciaVolanteoIcon,
  autoimg: AutoIMGIcon,
};

function readStoredExpanded(): boolean {
  try {
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

function LightningIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function MegaphoneIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 11l18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </svg>
  );
}

function ScrollTextIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function FilePdfIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M9 15v-2" />
      <path d="M12 15v-6" />
      <path d="M15 15v-4" />
    </svg>
  );
}

function StampIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 21h14" />
      <path d="M6 17h12" />
      <path d="M12 3l4 8H8l4-8z" />
      <path d="M8 11h8v6H8z" />
    </svg>
  );
}

function ImageOptimizerIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function PreviewPanelIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <path d="M3 9h18" />
      <path d="M9 21V9" />
      <circle cx="15" cy="15" r="2" />
    </svg>
  );
}

function PanelAvisoCorteIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <path d="M3 9h18" />
      <path d="M9 21V9" />
      <rect x="12" y="12" width="6" height="6" rx="1" />
    </svg>
  );
}

function MapPinIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function EvidenciaVolanteoIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function AutoIMGIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <polyline points="21 3 21 9 15 9" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
    </svg>
  );
}

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const { addToast } = useToast();
  const [expanded, setExpanded] = useState(readStoredExpanded);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(expanded));
    } catch {
      // Ignore storage failures in restricted environments.
    }
  }, [expanded]);

  const toggleExpanded = () => setExpanded((value) => !value);

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
      aria-label="Barra lateral de navegación"
      className="shrink-0 flex flex-col bg-[var(--bg-base)] transition-[width] duration-200 ease-out overflow-hidden"
      style={{ width: expanded ? SIDEBAR_WIDTH_EXPANDED : SIDEBAR_WIDTH_COLLAPSED }}
    >
      <div className="relative flex h-11 shrink-0 items-center gap-1.5 px-2">
        <button
          type="button"
          data-testid="sidebar-toggle"
          aria-label="Alternar barra lateral"
          aria-expanded={expanded}
          title="Alternar barra lateral"
          onClick={toggleExpanded}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          <PanelLeft size={16} strokeWidth={1.75} />
        </button>
        {expanded && (
          <div className="min-w-0 flex-1 overflow-hidden">
            <BrandMark showText size="md" />
          </div>
        )}
        <div
          className="absolute right-0 top-1/2 h-8 w-px -translate-y-1/2 bg-[var(--border-subtle)]"
          aria-hidden="true"
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-r border-[var(--border-subtle)]">
      <div className="mx-2 mb-2 h-px shrink-0 bg-[var(--border-subtle)]" />

      <nav className="flex flex-col gap-0.5 flex-1 py-1 px-2 min-h-0 overflow-y-auto">
        {TAB_DEFINITIONS.map((t) => {
          const isActive = activeTab === t.id;
          const Icon = ICONS[t.id];
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              title={!expanded ? t.label : undefined}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-lg px-2 py-2 w-full text-left transition-colors duration-150 ${
                isActive
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <span className="shrink-0 flex h-5 w-5 items-center justify-center">
                <Icon className={isActive ? 'text-[var(--text-primary)]' : undefined} />
              </span>
              <span
                className={`text-[13px] font-medium whitespace-nowrap overflow-hidden transition-[opacity,width] duration-200 ${
                  expanded ? 'opacity-100 w-auto' : 'opacity-0 w-0 pointer-events-none'
                }`}
              >
                {t.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mx-2 mt-auto h-px shrink-0 bg-[var(--border-subtle)]" />

      <div className="shrink-0 px-2 py-2">
        <button
          type="button"
          data-testid="sidebar-signout-button"
          aria-label={t('auth.signOut')}
          title={t('auth.signOut')}
          disabled={signingOut}
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-surface)] hover:text-[var(--text-secondary)] disabled:opacity-50"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center">
            <LogOut size={18} strokeWidth={1.75} />
          </span>
          <span
            className={`min-w-0 truncate text-[13px] font-medium whitespace-nowrap transition-[opacity,width] duration-200 ${
              expanded ? 'opacity-100 w-auto' : 'opacity-0 w-0 pointer-events-none'
            }`}
          >
            {t('auth.signOut')}
          </span>
        </button>
      </div>
      </div>
    </aside>
  );
}
