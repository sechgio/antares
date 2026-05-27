import React, { useState, Suspense, useMemo, useCallback } from 'react';
import Sidebar from './components/layout/Sidebar';
import TitleBar from './components/layout/TitleBar';
import BackendStatusBar from './components/layout/BackendStatusBar';
import { ToastProvider } from './hooks/useToast';
import { DialogProvider } from './hooks/useDialog';
import { useKeyboardShortcut } from './hooks/useKeyboardShortcut';
import ToastContainer from './components/ui/Toast';
import Dialog from './components/ui/Dialog';
import CommandPalette from './components/ui/CommandPalette';
import { FULL_BLEED_TABS, TAB_DEFINITIONS, type TabId } from './navigation';

const ConversionView = React.lazy(() => import('./components/conversion/ConversionView'));
const FormatosView = React.lazy(() => import('./components/formatos/FormatosView'));
const PadronView = React.lazy(() => import('./components/padron/PadronView'));
const VolantesView = React.lazy(() => import('./components/volantes/VolantesView'));
const ReportesCampoView = React.lazy(() => import('./components/reportes-campo'));
const HistoryView = React.lazy(() => import('./components/history/HistoryView'));
const AppearanceView = React.lazy(() => import('./components/settings/AppearanceView'));
const ImageOptimizerView = React.lazy(() => import('./components/image-optimizer'));
const PreviewPanelView = React.lazy(() => import('./components/preview-panel/PreviewPanelView'));
const TechnicalReportsView = React.lazy(() => import('./components/technical-reports'));
const PanelAvisoCorteView = React.lazy(() => import('./components/panel-aviso-corte'));

const VIEWS: Record<TabId, React.LazyExoticComponent<React.ComponentType>> = {
  convert: ConversionView,
  formatos: FormatosView,
  padron: PadronView,
  volantes: VolantesView,
  reportesCampo: ReportesCampoView,
  technicalReports: TechnicalReportsView,
  imageOptimizer: ImageOptimizerView,
  previewPanel: PreviewPanelView,
  panelAvisoCorte: PanelAvisoCorteView,
  history: HistoryView,
  appearance: AppearanceView,
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

function AppContent() {
  const [activeTab, setActiveTab] = useState<TabId>('convert');
  const [commandOpen, setCommandOpen] = useState(false);

  const openCommandPalette = useCallback(() => setCommandOpen(true), []);
  const handleTabChange = useCallback((tab: TabId) => setActiveTab(tab), []);

  useKeyboardShortcut('k', openCommandPalette, { ctrl: true, preventDefault: true });
  useKeyboardShortcut('1', () => handleTabChange('convert'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('3', () => handleTabChange('formatos'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('4', () => handleTabChange('padron'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('5', () => handleTabChange('volantes'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('6', () => handleTabChange('history'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('7', () => handleTabChange('appearance'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('8', () => handleTabChange('reportesCampo'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('9', () => handleTabChange('imageOptimizer'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('0', () => handleTabChange('previewPanel'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('2', () => handleTabChange('panelAvisoCorte'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('i', () => handleTabChange('technicalReports'), { ctrl: true, shift: true, preventDefault: true });

  const commandItems = useMemo(
    () => TAB_DEFINITIONS.map((tab) => ({
      id: `tab-${tab.id}`,
      label: `Ir a ${'commandLabel' in tab ? tab.commandLabel : tab.label}`,
      shortcut: tab.shortcut,
      action: () => handleTabChange(tab.id),
    })),
    [handleTabChange],
  );

  const isFullBleed = FULL_BLEED_TABS.has(activeTab);
  const ActiveView = VIEWS[activeTab];

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          activeTab={activeTab}
          onTabChange={(t) => setActiveTab(t as TabId)}
        />
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <main className="flex-1 overflow-hidden relative">
            <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">Cargando...</div>}>
              <div className={`h-full overflow-y-auto ${isFullBleed ? '' : 'px-6 py-6'}`}>
                <ActiveView />
              </div>
            </Suspense>
          </main>
        </div>
      </div>
      <CommandPalette isOpen={commandOpen} onClose={() => setCommandOpen(false)} items={commandItems} />
      <Dialog />
      <ToastContainer />
      <BackendStatusBar />
    </div>
  );
}

function App() {
  if (!window.electronAPI) {
    return <ElectronOnlyNotice />;
  }

  return (
    <ToastProvider>
      <DialogProvider>
        <AppContent />
      </DialogProvider>
    </ToastProvider>
  );
}

export default App;
