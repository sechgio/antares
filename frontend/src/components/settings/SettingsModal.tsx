import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { History, Palette, X, Users, PawPrint, type LucideIcon } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { CONFIG_SECTION_DEFINITIONS, type ConfigSectionId } from '../../navigation';
import { useAuth } from '../../auth/AuthContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';

const AppearanceView = React.lazy(() => import('./AppearanceView'));
const HistoryView = React.lazy(() => import('../history/HistoryView'));
const PanelView = React.lazy(() => import('./PanelView'));
const PetdexView = React.lazy(() => import('./PetdexView'));

const sectionFallback = (
  <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
    Cargando...
  </div>
);

interface SettingsModalProps {
  isOpen: boolean;
  section: ConfigSectionId;
  onSectionChange: (section: ConfigSectionId) => void;
  onClose: () => void;
}

const SECTION_ICONS: Record<ConfigSectionId, LucideIcon> = {
  appearance: Palette,
  history: History,
  panel: Users,
  petdex: PawPrint,
};

export default function SettingsModal({ isOpen, section, onSectionChange, onClose }: SettingsModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const overlayRef = useRef<HTMLDivElement>(null);
  const sectionButtonsRef = useRef<Record<string, HTMLButtonElement | null>>({});

  useFocusTrap(overlayRef, isOpen);

  const visibleSectionDefs = useMemo(
    () => CONFIG_SECTION_DEFINITIONS.filter((def) => def.id !== 'panel' || user?.isAdmin),
    [user?.isAdmin],
  );

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const target = e.target as HTMLElement | null;
        if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
        const ids = visibleSectionDefs.map((s) => s.id);
        const currentIndex = Math.max(0, ids.indexOf(section));
        const nextIndex = e.key === 'ArrowDown'
          ? (currentIndex + 1) % ids.length
          : (currentIndex - 1 + ids.length) % ids.length;
        e.preventDefault();
        onSectionChange(ids[nextIndex]);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [isOpen, onClose, section, onSectionChange, visibleSectionDefs]);

  useEffect(() => {
  }, [isOpen, section]);

  const sections = useMemo(
    () => visibleSectionDefs.map((def) => ({
      ...def,
      label: def.id === 'appearance'
        ? t('tab.appearance')
        : def.id === 'history'
        ? t('tab.history')
        : def.id === 'panel'
        ? t('tab.panel')
        : t('tab.petdex'),
      icon: SECTION_ICONS[def.id],
    })),
    [t, visibleSectionDefs],
  );

  useEffect(() => {
    if (!isOpen) return;
    if (section === 'panel' && !user?.isAdmin) {
      onSectionChange('appearance');
    }
  }, [isOpen, section, user?.isAdmin, onSectionChange]);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      data-testid="settings-modal-overlay"
      className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6 animate-fade-in"
      style={{ backgroundColor: 'color-mix(in srgb, var(--bg-base) 85%, transparent)' }}
      onClick={handleOverlayClick}
    >
      <div
        data-testid="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Configuración"
        tabIndex={-1}
        className="relative flex h-full w-full max-w-[1380px] max-h-[900px] overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] animate-scale-in"
        style={{
          boxShadow:
            '0 24px 48px color-mix(in srgb, var(--bg-base) 55%, transparent), 0 0 0 1px color-mix(in srgb, var(--border-subtle) 80%, transparent)',
        }}
      >
        <aside
          data-testid="settings-modal-sidebar"
          aria-label="Secciones de configuración"
          className="flex w-[230px] shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        >
          <div className="flex h-14 shrink-0 items-center border-b border-[var(--border-subtle)] px-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">Configuración</div>
          </div>

          <nav className="flex flex-col gap-1 p-2" aria-label="Secciones">
            {sections.map((def) => {
              const Icon = def.icon;
              const isActive = section === def.id;
              return (
                <button
                  key={def.id}
                  ref={(el) => { sectionButtonsRef.current[def.id] = el; }}
                  type="button"
                  onClick={() => onSectionChange(def.id)}
                  aria-current={isActive ? 'page' : undefined}
                  data-testid={`settings-section-${def.id}`}
                  className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] ${
                    isActive
                      ? 'bg-[var(--accent-primary-glow)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
                      isActive
                        ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)]'
                        : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]'
                    }`}
                  >
                    <Icon size={15} strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{def.label}</span>
                  {isActive && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-primary)]" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="mt-auto flex h-8 shrink-0 items-center border-t border-[var(--border-subtle)] px-4 text-[10px] leading-none text-[var(--text-muted)]">
            <span className="font-mono">Esc</span> para cerrar
          </div>
        </aside>

        <div className="relative flex min-w-0 flex-1 flex-col bg-[var(--bg-base)]">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6">
            <div className="flex min-w-0 items-center gap-3">
              <h2 className="truncate text-[15px] font-semibold text-[var(--text-primary)]">
                {section === 'appearance'
                  ? t('tab.appearance')
                  : section === 'history'
                  ? t('tab.history')
                  : section === 'panel'
                  ? t('tab.panel')
                  : t('tab.petdex')}
              </h2>
              <span className="hidden text-[11px] font-medium text-[var(--text-muted)] sm:inline">
                {section === 'appearance'
                  ? 'Personaliza el aspecto de la aplicación'
                  : section === 'history'
                  ? 'Revisa las ejecuciones anteriores'
                  : section === 'panel'
                  ? 'Gestiona usuarios y permisos'
                  : 'Colecciona y activa mascotas animadas'}
              </span>
            </div>
            <WithHoverTooltip label="Cerrar (Esc)" placement="bottom">
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar configuración"
                data-testid="settings-modal-close"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              >
                <X size={16} strokeWidth={1.9} />
              </button>
            </WithHoverTooltip>
          </header>

          <div className="relative min-h-0 flex-1 overflow-hidden">
            {section === 'appearance' && (
              <div className="h-full overflow-y-auto">
                <Suspense fallback={sectionFallback}>
                  <AppearanceView />
                </Suspense>
              </div>
            )}
            {section === 'history' && (
              <div className="h-full overflow-hidden">
                <Suspense fallback={sectionFallback}>
                  <HistoryView />
                </Suspense>
              </div>
            )}
            {section === 'panel' && (
              <div className="h-full overflow-y-auto">
                <Suspense fallback={sectionFallback}>
                  <PanelView />
                </Suspense>
              </div>
            )}
            {section === 'petdex' && (
              <div className="h-full overflow-y-auto">
                <Suspense fallback={sectionFallback}>
                  <PetdexView />
                </Suspense>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
