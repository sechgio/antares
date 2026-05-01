import React, { useState, Suspense } from 'react';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
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

const tabTitles: Record<string, string> = {
  convert: 'Conversión',
  db: 'Base de Datos',
  formatos: 'Formatos PDF',
  padron: 'Generar Padrones',
  volantes: 'Generar Volantes',
  reportesCampo: 'Reportes de Campo',
  imageOptimizer: 'Optimizador de Imágenes',
  history: 'Historial',
  appearance: 'Apariencia',
};

type TabId = 'convert' | 'db' | 'formatos' | 'padron' | 'volantes' | 'reportesCampo' | 'imageOptimizer' | 'history' | 'appearance';

function AppContent() {
  const [activeTab, setActiveTab] = useState<TabId>('convert');
  const [commandOpen, setCommandOpen] = useState(false);

  useKeyboardShortcut('k', () => setCommandOpen(true), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('1', () => setActiveTab('convert'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('2', () => setActiveTab('db'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('3', () => setActiveTab('formatos'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('4', () => setActiveTab('padron'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('5', () => setActiveTab('volantes'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('6', () => setActiveTab('history'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('7', () => setActiveTab('appearance'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('8', () => setActiveTab('reportesCampo'), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('9', () => setActiveTab('imageOptimizer'), { ctrl: true, preventDefault: true });

  const commandItems = [
    { id: 'tab-convert', label: 'Ir a Conversión', shortcut: 'Ctrl+1', action: () => setActiveTab('convert') },
    { id: 'tab-db', label: 'Ir a Base de Datos', shortcut: 'Ctrl+2', action: () => setActiveTab('db') },
    { id: 'tab-formatos', label: 'Ir a Formatos PDF', shortcut: 'Ctrl+3', action: () => setActiveTab('formatos') },
    { id: 'tab-padron', label: 'Ir a Generar Padrones', shortcut: 'Ctrl+4', action: () => setActiveTab('padron') },
    { id: 'tab-volantes', label: 'Ir a Generar Volantes', shortcut: 'Ctrl+5', action: () => setActiveTab('volantes') },
    { id: 'tab-history', label: 'Ir a Historial', shortcut: 'Ctrl+6', action: () => setActiveTab('history') },
    { id: 'tab-appearance', label: 'Ir a Apariencia', shortcut: 'Ctrl+7', action: () => setActiveTab('appearance') },
    { id: 'tab-reportes-campo', label: 'Ir a Reportes de Campo', shortcut: 'Ctrl+8', action: () => setActiveTab('reportesCampo') },
    { id: 'tab-image-optimizer', label: 'Ir a Optimizador de Imágenes', shortcut: 'Ctrl+9', action: () => setActiveTab('imageOptimizer') },
  ];

  // Tabs that use full-bleed layout (no padding) because they manage their own internal layout
  const fullBleedTabs = ['padron', 'volantes', 'reportesCampo', 'formatos'];
  const isFullBleed = fullBleedTabs.includes(activeTab);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
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
              {activeTab === 'history' && <HistoryView />}
              {activeTab === 'appearance' && <AppearanceView />}
            </div>
          </Suspense>
        </main>
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
