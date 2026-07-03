import React, { useState, Suspense, useMemo, useCallback } from 'react';
import Sidebar from './components/layout/Sidebar';
import TitleBar from './components/layout/TitleBar';
import BackendStatusBar from './components/layout/BackendStatusBar';
import SettingsModal from './components/settings/SettingsModal';
import { ToastProvider } from './hooks/useToast';
import { DialogProvider } from './hooks/useDialog';
import { useKeyboardShortcut } from './hooks/useKeyboardShortcut';
import ToastContainer from './components/ui/Toast';
import Dialog from './components/ui/Dialog';
import CommandPalette from './components/ui/CommandPalette';
import { DEFAULT_TAB, FULL_BLEED_TABS, TAB_DEFINITIONS, CONFIG_SECTION_DEFINITIONS, type TabId, type ConfigSectionId } from './navigation';
import { AuthProvider, useAuth } from './auth/AuthContext';
import LoginScreen from './auth/LoginScreen';

const ConversionView = React.lazy(() => import('./components/conversion/ConversionView'));
const FormatosView = React.lazy(() => import('./components/formatos/FormatosView'));
const SelladorView = React.lazy(() => import('./components/sellador'));
const PadronView = React.lazy(() => import('./components/padron/PadronView'));
const VolantesView = React.lazy(() => import('./components/volantes/VolantesView'));
const ReportesCampoView = React.lazy(() => import('./components/reportes-campo'));
const ImageOptimizerView = React.lazy(() => import('./components/image-optimizer'));
const PreviewPanelView = React.lazy(() => import('./components/preview-panel/PreviewPanelView'));
const TechnicalReportsView = React.lazy(() => import('./components/technical-reports'));
const PanelAvisoCorteView = React.lazy(() => import('./components/panel-aviso-corte'));
const UbicacionesView = React.lazy(() => import('./components/UbicacionesView').then(m => ({ default: m.UbicacionesView })));
const EvidenciaVolanteoView = React.lazy(() => import('./components/evidencia-volanteo'));
const AutoIMGView = React.lazy(() => import('./components/autoimg'));

const VIEWS: Record<TabId, React.LazyExoticComponent<React.ComponentType>> = {
  convert: ConversionView,
  formatos: FormatosView,
  sellador: SelladorView,
  padron: PadronView,
  volantes: VolantesView,
  reportesCampo: ReportesCampoView,
  technicalReports: TechnicalReportsView,
  imageOptimizer: ImageOptimizerView,
  previewPanel: PreviewPanelView,
  panelAvisoCorte: PanelAvisoCorteView,
  ubicaciones: UbicacionesView,
  evidenciaVolanteo: EvidenciaVolanteoView,
  autoimg: AutoIMGView,
};

function ElectronOnlyNotice() {
  const isElectron = typeof window !== 'undefined' && (window as any).process?.type === 'renderer';
  const hasAPI = typeof window !== 'undefined' && !!(window as any).electronAPI;

  return (
    <main className="flex h-screen w-screen items-center justify-center bg-[var(--bg-base)] px-6 text-[var(--text-primary)]">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold">Abre Antares desde la aplicacion de escritorio</h1>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          Esta interfaz necesita el puente de Electron para comunicarse con el backend.
        </p>
        <div className="mt-6 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-4 text-left text-xs font-mono">
          <div className="mb-2 font-sans font-semibold text-[var(--text-primary)]">Diagnóstico:</div>
          <div>Es Electron: <span className={isElectron ? 'text-green-400' : 'text-red-400'}>{isElectron ? 'Sí' : 'No'}</span></div>
          <div>electronAPI: <span className={hasAPI ? 'text-green-400' : 'text-red-400'}>{hasAPI ? 'Disponible' : 'No disponible'}</span></div>
          <div className="mt-2 text-[var(--text-muted)]">
            {isElectron && !hasAPI && 'El preload script no se ejecutó correctamente.'}
            {!isElectron && 'Abriendo desde navegador, no desde Electron.'}
          </div>
        </div>
      </div>
    </main>
  );
}

function AuthGate() {
  const { user, loading, signOut } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--bg-base)]">
        <div className="text-sm text-[var(--text-muted)]">Cargando...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  if (user.isDisabled) {
    return <DisabledUserNotice onSignOut={signOut} />;
  }

  // User is authenticated — check Electron bridge
  if (!window.electronAPI) {
    return <ElectronOnlyNotice />;
  }

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
  const [activeTab, setActiveTab] = useState<TabId>(DEFAULT_TAB);
  const [commandOpen, setCommandOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<ConfigSectionId>('appearance');

  const openCommandPalette = useCallback(() => setCommandOpen(true), []);
  const handleTabChange = useCallback((tab: TabId) => setActiveTab(tab), []);
  const openSettings = useCallback((section: ConfigSectionId = 'appearance') => {
    setSettingsSection(section);
    setSettingsOpen(true);
  }, []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const openAppearanceSettings = useCallback(() => openSettings('appearance'), [openSettings]);
  const closeCommandPalette = useCallback(() => setCommandOpen(false), []);

  useKeyboardShortcut('k', openCommandPalette, { ctrl: true, preventDefault: true });
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
  useKeyboardShortcut('2', () => handleTabChange('panelAvisoCorte'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('u', () => handleTabChange('ubicaciones'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('v', () => handleTabChange('evidenciaVolanteo'), { ctrl: true, shift: true, preventDefault: true });
  useKeyboardShortcut('a', () => handleTabChange('autoimg'), { ctrl: true, shift: true, preventDefault: true });
  useKeyboardShortcut('i', () => handleTabChange('technicalReports'), { ctrl: true, shift: true, preventDefault: true });

  const commandItems = useMemo(
    () => [
      ...TAB_DEFINITIONS.map((tab) => ({
        id: `tab-${tab.id}`,
        label: `Ir a ${'commandLabel' in tab ? tab.commandLabel : tab.label}`,
        shortcut: tab.shortcut,
        action: () => handleTabChange(tab.id),
      })),
      ...CONFIG_SECTION_DEFINITIONS.map((section) => ({
        id: `settings-${section.id}`,
        label: `Configuración: ${section.label}`,
        shortcut: section.shortcut,
        action: () => openSettings(section.id),
      })),
    ],
    [handleTabChange, openSettings],
  );

  const isFullBleed = FULL_BLEED_TABS.has(activeTab);
  const ActiveView = VIEWS[activeTab];

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      <TitleBar onOpenSettings={openAppearanceSettings} />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          activeTab={activeTab}
          onTabChange={handleTabChange}
        />
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <main className="flex-1 overflow-hidden relative">
            <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">Cargando...</div>}>
              <div className={`h-full overflow-y-auto ${isFullBleed ? '' : 'px-6 py-4'}`}>
                <ActiveView />
              </div>
            </Suspense>
          </main>
        </div>
      </div>
      <SettingsModal
        isOpen={settingsOpen}
        section={settingsSection}
        onSectionChange={setSettingsSection}
        onClose={closeSettings}
      />
      <CommandPalette isOpen={commandOpen} onClose={closeCommandPalette} items={commandItems} />
      <Dialog />
      <ToastContainer />
      <BackendStatusBar />
    </div>
  );
}

function App() {
  return (
    <ToastProvider>
      <DialogProvider>
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </DialogProvider>
    </ToastProvider>
  );
}

export default App;
