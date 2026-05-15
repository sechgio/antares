import React, { useState, Suspense, useMemo, useCallback, useEffect } from 'react';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import TitleBar from './components/layout/TitleBar';
import BackendStatusBar from './components/layout/BackendStatusBar';
import { ToastProvider } from './hooks/useToast';
import { DialogProvider } from './hooks/useDialog';
import { useKeyboardShortcut } from './hooks/useKeyboardShortcut';
import ToastContainer from './components/ui/Toast';
import Dialog from './components/ui/Dialog';
import CommandPalette from './components/ui/CommandPalette';

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

const LAZY_MODULES = [
  () => import('./components/formatos/FormatosView'),
  () => import('./components/padron/PadronView'),
  () => import('./components/volantes/VolantesView'),
  () => import('./components/reportes-campo'),
  () => import('./components/technical-reports'),
  () => import('./components/history/HistoryView'),
  () => import('./components/settings/AppearanceView'),
  () => import('./components/image-optimizer'),
  () => import('./components/preview-panel/PreviewPanelView'),
  () => import('./components/panel-aviso-corte'),
];

const tabTitles: Record<string, string> = {
  convert: 'Conversión',
  formatos: 'Formatos PDF',
  padron: 'Generar Padrones',
  volantes: 'Generar Volantes',
  reportesCampo: 'Reportes de Campo',
  technicalReports: 'Informes técnicos',
  imageOptimizer: 'Optimizador de Imágenes',
  previewPanel: 'Generador Reportes',
  panelAvisoCorte: 'Aviso de Corte',
  history: 'Historial',
  appearance: 'Apariencia',
};

const FULL_BLEED_TABS = new Set(['padron', 'volantes', 'reportesCampo', 'technicalReports', 'formatos', 'imageOptimizer', 'previewPanel', 'panelAvisoCorte']);

type TabId = 'convert' | 'formatos' | 'padron' | 'volantes' | 'reportesCampo' | 'technicalReports' | 'imageOptimizer' | 'previewPanel' | 'panelAvisoCorte' | 'history' | 'appearance';

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

  const commandItems = useMemo(() => [
    { id: 'tab-convert', label: 'Ir a Conversión', shortcut: 'Ctrl+1', action: () => handleTabChange('convert') },
    { id: 'tab-formatos', label: 'Ir a Formatos PDF', shortcut: 'Ctrl+3', action: () => handleTabChange('formatos') },
    { id: 'tab-padron', label: 'Ir a Generar Padrones', shortcut: 'Ctrl+4', action: () => handleTabChange('padron') },
    { id: 'tab-volantes', label: 'Ir a Generar Volantes', shortcut: 'Ctrl+5', action: () => handleTabChange('volantes') },
    { id: 'tab-history', label: 'Ir a Historial', shortcut: 'Ctrl+6', action: () => handleTabChange('history') },
    { id: 'tab-appearance', label: 'Ir a Apariencia', shortcut: 'Ctrl+7', action: () => handleTabChange('appearance') },
    { id: 'tab-reportes-campo', label: 'Ir a Reportes de Campo', shortcut: 'Ctrl+8', action: () => handleTabChange('reportesCampo') },
    { id: 'tab-technical-reports', label: 'Ir a Informes técnicos', shortcut: 'Ctrl+Shift+I', action: () => handleTabChange('technicalReports') },
    { id: 'tab-image-optimizer', label: 'Ir a Optimizador de Imágenes', shortcut: 'Ctrl+9', action: () => handleTabChange('imageOptimizer') },
    { id: 'tab-preview-panel', label: 'Ir a Generador de Reportes', shortcut: 'Ctrl+0', action: () => handleTabChange('previewPanel') },
    { id: 'tab-panel-aviso-corte', label: 'Ir a Aviso de Corte', shortcut: 'Ctrl+2', action: () => handleTabChange('panelAvisoCorte') },
  ], [handleTabChange]);

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
                {activeTab === 'formatos' && <FormatosView />}
                {activeTab === 'padron' && <PadronView />}
                {activeTab === 'volantes' && <VolantesView />}
                {activeTab === 'reportesCampo' && <ReportesCampoView />}
                {activeTab === 'technicalReports' && <TechnicalReportsView />}
                {activeTab === 'imageOptimizer' && <ImageOptimizerView />}
                {activeTab === 'previewPanel' && <PreviewPanelView />}
                {activeTab === 'panelAvisoCorte' && <PanelAvisoCorteView />}
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
      <BackendStatusBar />
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
