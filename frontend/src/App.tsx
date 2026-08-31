import React, { useState, Suspense, useMemo, useCallback, useEffect } from 'react';
import Sidebar from './components/layout/Sidebar';
import TitleBar from './components/layout/TitleBar';
import { ToastProvider } from './hooks/useToast';
import { DialogProvider } from './hooks/useDialog';
import { useKeyboardShortcut } from './hooks/useKeyboardShortcut';
import ToastContainer from './components/ui/Toast';
import Dialog from './components/ui/Dialog';
import CommandPalette from './components/ui/CommandPalette';
import ErrorBoundary from './components/ui/ErrorBoundary';
import { DEFAULT_TAB, FULL_BLEED_TABS, TAB_DEFINITIONS, CONFIG_SECTION_DEFINITIONS, type TabId, type ConfigSectionId } from './navigation';
import { AuthProvider, useAuth } from './auth/AuthContext';
import EspaciosAuthSkeleton from './components/espacios/components/EspaciosAuthSkeleton';
import { subscribeHistoryReexecute } from './components/history/historyEvents';
import { api, onNotify } from './api';
import { acknowledgeCanvasFlush } from './utils/ackCanvasFlush';
import { bootThemeFromBackend } from './utils/themeApplier';

// Lazy: LoginScreen pulls framer-motion (~100KB+ gzip). Only needed for Espacios auth.
const LoginScreen = React.lazy(() => import('./auth/LoginScreen'));
const SettingsModal = React.lazy(() => import('./components/settings/SettingsModal'));
const PetMascot = React.lazy(() => import('./components/layout/PetMascot'));

const ConversionView = React.lazy(() => import('./components/conversion/ConversionView'));
const FormatosView = React.lazy(() => import('./components/formatos/FormatosView'));
const SelladorView = React.lazy(() => import('./components/sellador'));
const PadronView = React.lazy(() => import('./components/padron/PadronView'));
const VolantesView = React.lazy(() => import('./components/volantes/VolantesView'));
const ReportesCampoView = React.lazy(() => import('./components/reportes-campo'));
const ImageOptimizerView = React.lazy(() => import('./components/image-optimizer'));
const PreviewPanelView = React.lazy(() => import('./components/preview-panel/PreviewPanelView'));
const TechnicalReportsView = React.lazy(() => import('./components/technical-reports'));
const InformesV2View = React.lazy(() => import('./components/informes-v2'));
const PanelAvisoCorteView = React.lazy(() => import('./components/panel-aviso-corte'));
const UbicacionesView = React.lazy(() => import('./components/UbicacionesView').then(m => ({ default: m.UbicacionesView })));
const EvidenciaVolanteoView = React.lazy(() => import('./components/evidencia-volanteo'));
const AutoIMGView = React.lazy(() => import('./components/autoimg'));
const FichasTecnicasView = React.lazy(() => import('./components/fichas-tecnicas'));
const EspaciosView = React.lazy(() => import('./components/espacios'));
const CanvasView = React.lazy(() => import('./components/canvas'));

/** Keep Canvas mounted briefly after leaving the tab; then unmount to free blob/history RAM. */
const CANVAS_KEEPALIVE_MS = 60 * 1000;
function prefetchSettingsModal() {
  void import('./components/settings/SettingsModal');
}

function prefetchCanvasView() {
  void import('./components/canvas');
}

function isPetMascotEnabled(): boolean {
  try {
    return localStorage.getItem('petdex_enabled') === 'true';
  } catch {
    return false;
  }
}

const VIEWS: Record<TabId, React.LazyExoticComponent<React.ComponentType<{ active?: boolean }>>> = {
  espacios: EspaciosView,
  convert: ConversionView,
  formatos: FormatosView,
  sellador: SelladorView,
  padron: PadronView,
  volantes: VolantesView,
  reportesCampo: ReportesCampoView,
  technicalReports: TechnicalReportsView,
  informesV2: InformesV2View,
  imageOptimizer: ImageOptimizerView,
  previewPanel: PreviewPanelView,
  canvas: CanvasView,
  panelAvisoCorte: PanelAvisoCorteView,
  ubicaciones: UbicacionesView,
  evidenciaVolanteo: EvidenciaVolanteoView,
  autoimg: AutoIMGView,
  fichasTecnicas: FichasTecnicasView,
};

function isElectronRenderer(): boolean {
  if (typeof window === 'undefined') return false;
  const w: unknown = window;
  if (typeof w !== 'object' || w === null || !('process' in w)) return false;
  const proc = w.process;
  if (!proc || typeof proc !== 'object' || !('type' in proc)) return false;
  return proc.type === 'renderer';
}

function ElectronOnlyNotice() {
  const isElectron = isElectronRenderer();
  const hasAPI = typeof window !== 'undefined' && !!window.electronAPI;

  return (
    <main className="flex h-screen w-screen items-center justify-center bg-[var(--bg-base)] px-6 text-[var(--text-primary)]">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold">Abre Antares desde la aplicacion de escritorio</h1>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          Esta interfaz necesita el puente de Electron para comunicarse con el backend.
        </p>
        <div className="mt-6 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-4 text-left text-xs font-mono">
          <div className="mb-2 font-sans font-semibold text-[var(--text-primary)]">Diagnóstico:</div>
          <div>Es Electron: <span className={isElectron ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}>{isElectron ? 'Sí' : 'No'}</span></div>
          <div>electronAPI: <span className={hasAPI ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}>{hasAPI ? 'Disponible' : 'No disponible'}</span></div>
          <div className="mt-2 text-[var(--text-muted)]">
            {isElectron && !hasAPI && 'El preload script no se ejecutó correctamente.'}
            {!isElectron && 'Abriendo desde navegador, no desde Electron.'}
          </div>
        </div>
      </div>
    </main>
  );
}

/** Tabs that require Supabase auth (cloud collaboration). Local tools stay usable offline. */
const CLOUD_AUTH_TABS = new Set<TabId>(['espacios']);

function AuthGate() {
  const { user, loading, signOut } = useAuth();

  // Electron bridge is required for the whole app — check before auth.
  if (!window.electronAPI) {
    return <ElectronOnlyNotice />;
  }

  if (!loading && user?.isDisabled) {
    return <DisabledUserNotice onSignOut={signOut} />;
  }

  // Show the shell immediately (default tab is local). Do not block on session resolve.
  return <AppContent />;
}

function DisabledUserNotice({ onSignOut }: { onSignOut: () => Promise<void> }) {
  React.useEffect(() => { onSignOut(); }, [onSignOut]);
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--bg-base)] px-6 text-center text-[var(--text-primary)]">
      <div className="max-w-sm">
        <h1 className="text-xl font-semibold">Cuenta desactivada</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Tu cuenta ha sido desactivada. Contacta al administrador.
        </p>
      </div>
    </div>
  );
}

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>(DEFAULT_TAB);
  /** Once visited, Canvas stays mounted (hidden) briefly so docs/picker/history survive tab switches. */
  const [canvasMounted, setCanvasMounted] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<ConfigSectionId>('appearance');
  const [petEnabled, setPetEnabled] = useState(isPetMascotEnabled);

  const openCommandPalette = useCallback(() => setCommandOpen(true), []);
  const handleTabChange = useCallback((tab: TabId) => {
    if (tab === 'canvas') {
      prefetchCanvasView();
      setCanvasMounted(true);
    }
    setActiveTab(tab);
  }, []);
  const openSettings = useCallback((section: ConfigSectionId = 'appearance') => {
    prefetchSettingsModal();
    setSettingsSection(section);
    setSettingsOpen(true);
  }, []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const openAppearanceSettings = useCallback(() => openSettings('appearance'), [openSettings]);
  const closeCommandPalette = useCallback(() => setCommandOpen(false), []);

  useEffect(() => {
    if (!canvasMounted || activeTab === 'canvas') return;
    const t = window.setTimeout(() => setCanvasMounted(false), CANVAS_KEEPALIVE_MS);
    return () => window.clearTimeout(t);
  }, [activeTab, canvasMounted]);

  // If Canvas has never been mounted (or its keep-alive already expired),
  // there is no CanvasView listener to acknowledge the main-process shutdown
  // request. A no-op flush ACK prevents an unnecessary 120s wait in that case;
  // while Canvas is mounted, CanvasView owns the ACK after saving dirty state.
  useEffect(() => {
    if (canvasMounted) return undefined;
    return onNotify(async (method) => {
      if (method !== 'app.flush-canvas-before-quit') return;
      try {
        await acknowledgeCanvasFlush();
      } catch {}
    });
  }, [canvasMounted]);

  // Prefetch settings chunk after first paint so open feels instant.
  // Skip in Vitest to avoid EnvironmentTeardownError from pending dynamic imports.
  useEffect(() => {
    if (import.meta.env.MODE === 'test') return;
    const ric = window.requestIdleCallback?.bind(window);
    if (ric) {
      const id = ric(() => prefetchSettingsModal(), { timeout: 2500 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(prefetchSettingsModal, 1);
    return () => window.clearTimeout(t);
  }, []);

  // Backend theme is the persisted authority: the cached CSS painted first in
  // main.tsx (no flash), then this reconciles with the saved theme as soon as
  // IPC answers. Fixes startup ignoring theme_config.json when localStorage
  // cache is missing or stale.
  useEffect(() => bootThemeFromBackend(api.getTheme), []);

  // Mount PetMascot only when Petdex enables it (same session or prior).
  useEffect(() => {
    const sync = () => setPetEnabled(isPetMascotEnabled());
    window.addEventListener('petdex-config-changed', sync);
    return () => window.removeEventListener('petdex-config-changed', sync);
  }, []);

  useKeyboardShortcut('k', openCommandPalette, { ctrl: true, preventDefault: true });
  useKeyboardShortcut('e', () => handleTabChange('espacios'), { ctrl: true, shift: true, preventDefault: true });
  useKeyboardShortcut('1', () => handleTabChange('convert'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('3', () => handleTabChange('formatos'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('s', () => handleTabChange('sellador'), { ctrl: true, shift: true, preventDefault: true });
  useKeyboardShortcut('4', () => handleTabChange('padron'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('5', () => handleTabChange('volantes'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('6', () => openSettings('history'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('7', () => openSettings('appearance'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('8', () => handleTabChange('reportesCampo'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('9', () => handleTabChange('imageOptimizer'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('0', () => handleTabChange('previewPanel'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('c', () => handleTabChange('canvas'), { ctrl: true, alt: true, preventDefault: true });
  useKeyboardShortcut('2', () => handleTabChange('panelAvisoCorte'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('u', () => handleTabChange('ubicaciones'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('v', () => handleTabChange('evidenciaVolanteo'), { ctrl: true, shift: true, preventDefault: true });
  useKeyboardShortcut('a', () => handleTabChange('autoimg'), { ctrl: true, shift: true, preventDefault: true });
  useKeyboardShortcut('f', () => handleTabChange('fichasTecnicas'), { ctrl: true, shift: true, preventDefault: true });
  useKeyboardShortcut('i', () => handleTabChange('technicalReports'), { ctrl: true, shift: true, preventDefault: true });
  useKeyboardShortcut('j', () => handleTabChange('informesV2'), { ctrl: true, shift: true, preventDefault: true });
  useKeyboardShortcut('d', () => openSettings('petdex'), { ctrl: true, shift: true, preventDefault: true });

  // History "Reejecutar" only has a listener inside ConversionView, which is
  // unmounted when another tab is active. Switch to convert so the pending
  // payload (or the live event) can be applied.
  useEffect(() => {
    return subscribeHistoryReexecute(() => {
      setActiveTab('convert');
      setSettingsOpen(false);
    });
  }, []);

  const commandItems = useMemo(
    () => [
      ...TAB_DEFINITIONS.map((tab) => ({
        id: `tab-${tab.id}`,
        label: `Ir a ${'commandLabel' in tab ? tab.commandLabel : tab.label}`,
        shortcut: tab.shortcut,
        action: () => handleTabChange(tab.id),
      })),
      ...CONFIG_SECTION_DEFINITIONS
        .filter((section) => section.id !== 'panel' || user?.isAdmin)
        .map((section) => ({
          id: `settings-${section.id}`,
          label: `Configuración: ${section.label}`,
          shortcut: section.shortcut,
          action: () => openSettings(section.id),
        })),
    ],
    [handleTabChange, openSettings, user?.isAdmin],
  );

  const needsCloudAuth = CLOUD_AUTH_TABS.has(activeTab);
  const cloudAuthBlocked = needsCloudAuth && !user;
  const isFullBleed = FULL_BLEED_TABS.has(activeTab);
  const showCanvas = activeTab === 'canvas';
  const ActiveView = showCanvas ? null : VIEWS[activeTab];
  const CanvasKeepAlive = VIEWS.canvas;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      <TitleBar
        onOpenSettings={openAppearanceSettings}
        onPrefetchSettings={prefetchSettingsModal}
        onOpenEspacios={() => handleTabChange('espacios')}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onPrefetchTab={(tab) => {
            if (tab === 'canvas') prefetchCanvasView();
          }}
        />
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <main className="flex-1 overflow-hidden relative">
            {cloudAuthBlocked ? (
              authLoading ? (
                <EspaciosAuthSkeleton />
              ) : (
                <Suspense fallback={<EspaciosAuthSkeleton />}>
                  <LoginScreen />
                </Suspense>
              )
            ) : (
              <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">Cargando...</div>}>
                {canvasMounted && (
                  <div
                    data-testid="canvas-keep-alive"
                    className={`h-full min-h-0 overflow-hidden ${showCanvas ? '' : 'hidden'}`}
                    aria-hidden={!showCanvas}
                    inert={!showCanvas ? true : undefined}
                  >
                    <ErrorBoundary view="canvas">
                      <CanvasKeepAlive active={showCanvas} />
                    </ErrorBoundary>
                  </div>
                )}
                {ActiveView && (
                  <div className={`h-full min-h-0 ${isFullBleed ? 'overflow-hidden' : 'overflow-y-auto px-6 py-4'}`}>
                    <ErrorBoundary key={activeTab} view={activeTab}>
                      <ActiveView />
                    </ErrorBoundary>
                  </div>
                )}
              </Suspense>
            )}
          </main>
        </div>
      </div>
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={settingsOpen}
            section={settingsSection}
            onSectionChange={setSettingsSection}
            onClose={closeSettings}
          />
        </Suspense>
      )}
      <CommandPalette isOpen={commandOpen} onClose={closeCommandPalette} items={commandItems} />
      <Dialog />
      <ToastContainer />
      {petEnabled && (
        <Suspense fallback={null}>
          <PetMascot />
        </Suspense>
      )}
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary view="app">
      <ToastProvider>
        <DialogProvider>
          <AuthProvider>
            <AuthGate />
          </AuthProvider>
        </DialogProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
