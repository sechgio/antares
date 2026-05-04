import React, { useState, Suspense, useMemo, useCallback, useEffect } from 'react';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import TitleBar from './components/layout/TitleBar';
import { ToastProvider } from './hooks/useToast';
import { DialogProvider } from './hooks/useDialog';
import { useKeyboardShortcut } from './hooks/useKeyboardShortcut';
import ToastContainer from './components/ui/Toast';
import Dialog from './components/ui/Dialog';
import CommandPalette from './components/ui/CommandPalette';

const ConversionView = React.lazy(() => import('./components/conversion/ConversionView'));
const DatabaseView = React.lazy(() => import('./components/database/DatabaseView'));
const FormatosView = React.lazy(() => import('./components/formatos/FormatosView'));
const PadronView = React.lazy(() => import('./components/padron/PadronView'));
const VolantesView = React.lazy(() => import('./components/volantes/VolantesView'));
const ReportesCampoView = React.lazy(() => import('./components/reportes-campo'));
const HistoryView = React.lazy(() => import('./components/history/HistoryView'));
const AppearanceView = React.lazy(() => import('./components/settings/AppearanceView'));
const ImageOptimizerView = React.lazy(() => import('./components/image-optimizer'));
const PreviewPanelView = React.lazy(() => import('./components/preview-panel/PreviewPanelView'));

const LAZY_MODULES = [
  () => import('./components/database/DatabaseView'),
  () => import('./components/formatos/FormatosView'),
  () => import('./components/padron/PadronView'),
  () => import('./components/volantes/VolantesView'),
  () => import('./components/reportes-campo'),
  () => import('./components/history/HistoryView'),
  () => import('./components/settings/AppearanceView'),
  () => import('./components/image-optimizer'),
  () => import('./components/preview-panel/PreviewPanelView'),
];

const tabTitles: Record<string, string> = {
  convert: 'Conversión',
  db: 'Base de Datos',
  formatos: 'Formatos PDF',
  padron: 'Generar Padrones',
  volantes: 'Generar Volantes',
  reportesCampo: 'Reportes de Campo',
  imageOptimizer: 'Optimizador de Imágenes',
  previewPanel: 'Generador Reportes',
  history: 'Historial',
  appearance: 'Apariencia',
};

const FULL_BLEED_TABS = new Set(['padron', 'volantes', 'reportesCampo', 'formatos', 'previewPanel']);

type TabId = 'convert' | 'db' | 'formatos' | 'padron' | 'volantes' | 'reportesCampo' | 'imageOptimizer' | 'previewPanel' | 'history' | 'appearance';

function AppContent() {
  const [activeTab, setActiveTab] = useState<TabId>('convert');
  const [commandOpen, setCommandOpen] = useState(false);

  // Prefetch lazy modules after mount for faster tab switching
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const loader of LAZY_MODULES) {
        loader().catch(() => {});
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  const openCommandPalette = useCallback(() => setCommandOpen(true), []);
  const setActiveTabConvert = useCallback(() => setActiveTab('convert'), []);
  const setActiveTabDb = useCallback(() => setActiveTab('db'), []);
  const setActiveTabFormatos = useCallback(() => setActiveTab('formatos'), []);
  const setActiveTabPadron = useCallback(() => setActiveTab('padron'), []);
  const setActiveTabVolantes = useCallback(() => setActiveTab('volantes'), []);
  const setActiveTabHistory = useCallback(() => setActiveTab('history'), []);
  const setActiveTabAppearance = useCallback(() => setActiveTab('appearance'), []);
  const setActiveTabReportesCampo = useCallback(() => setActiveTab('reportesCampo'), []);
  const setActiveTabImageOptimizer = useCallback(() => setActiveTab('imageOptimizer'), []);
  const setActiveTabPreviewPanel = useCallback(() => setActiveTab('previewPanel'), []);

  useKeyboardShortcut('k', openCommandPalette, { ctrl: true, preventDefault: true });
  useKeyboardShortcut('1', setActiveTabConvert, { ctrl: true, preventDefault: true });
  useKeyboardShortcut('2', setActiveTabDb, { ctrl: true, preventDefault: true });
  useKeyboardShortcut('3', setActiveTabFormatos, { ctrl: true, preventDefault: true });
  useKeyboardShortcut('4', setActiveTabPadron, { ctrl: true, preventDefault: true });
  useKeyboardShortcut('5', setActiveTabVolantes, { ctrl: true, preventDefault: true });
  useKeyboardShortcut('6', setActiveTabHistory, { ctrl: true, preventDefault: true });
  useKeyboardShortcut('7', setActiveTabAppearance, { ctrl: true, preventDefault: true });
  useKeyboardShortcut('8', setActiveTabReportesCampo, { ctrl: true, preventDefault: true });
  useKeyboardShortcut('9', setActiveTabImageOptimizer, { ctrl: true, preventDefault: true });
  useKeyboardShortcut('0', setActiveTabPreviewPanel, { ctrl: true, preventDefault: true });

  const commandItems = useMemo(() => [
    { id: 'tab-convert', label: 'Ir a Conversión', shortcut: 'Ctrl+1', action: () => setActiveTab('convert') },
    { id: 'tab-db', label: 'Ir a Base de Datos', shortcut: 'Ctrl+2', action: () => setActiveTab('db') },
    { id: 'tab-formatos', label: 'Ir a Formatos PDF', shortcut: 'Ctrl+3', action: () => setActiveTab('formatos') },
    { id: 'tab-padron', label: 'Ir a Generar Padrones', shortcut: 'Ctrl+4', action: () => setActiveTab('padron') },
    { id: 'tab-volantes', label: 'Ir a Generar Volantes', shortcut: 'Ctrl+5', action: () => setActiveTab('volantes') },
    { id: 'tab-history', label: 'Ir a Historial', shortcut: 'Ctrl+6', action: () => setActiveTab('history') },
    { id: 'tab-appearance', label: 'Ir a Apariencia', shortcut: 'Ctrl+7', action: () => setActiveTab('appearance') },
    { id: 'tab-reportes-campo', label: 'Ir a Reportes de Campo', shortcut: 'Ctrl+8', action: () => setActiveTab('reportesCampo') },
    { id: 'tab-image-optimizer', label: 'Ir a Optimizador de Imágenes', shortcut: 'Ctrl+9', action: () => setActiveTab('imageOptimizer') },
    { id: 'tab-preview-panel', label: 'Ir a Generador de Reportes', shortcut: 'Ctrl+0', action: () => setActiveTab('previewPanel') },
  ], []);

  const isFullBleed = FULL_BLEED_TABS.has(activeTab);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          activeTab={activeTab}
          onTabChange={(t) => setActiveTab(t as TabId)}
        />
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <Header title={tabTitles[activeTab]} onSearchClick={() => setCommandOpen(true)} />
          <main className="flex-1 overflow-hidden relative">
            <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">Cargando...</div>}>
              <div className={`h-full overflow-y-auto ${isFullBleed ? '' : 'px-6 py-6'}`}>
                {activeTab === 'convert' && <ConversionView />}
                {activeTab === 'db' && <DatabaseView />}
                {activeTab === 'formatos' && <FormatosView />}
                {activeTab === 'padron' && <PadronView />}
                {activeTab === 'volantes' && <VolantesView />}
                {activeTab === 'reportesCampo' && <ReportesCampoView />}
                {activeTab === 'imageOptimizer' && <ImageOptimizerView />}
                {activeTab === 'previewPanel' && <PreviewPanelView />}
                {activeTab === 'history' && <HistoryView />}
                {activeTab === 'appearance' && <AppearanceView />}
              </div>
            </Suspense>
          </main>
        </div>
      </div>
      <CommandPalette isOpen={commandOpen} onClose={() => setCommandOpen(false)} items={commandItems} />
      <Dialog />
      <ToastContainer />
    </div>
  );
}

function App() {
  return (
    <ToastProvider>
      <DialogProvider>
        <AppContent />
      </DialogProvider>
    </ToastProvider>
  );
}

export default App;
