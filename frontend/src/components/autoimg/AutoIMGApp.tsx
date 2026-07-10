import { useCallback, useEffect, useState } from 'react';
import {
  ClipboardList,
  FolderOpen,
  LayoutDashboard,
  ScrollText,
  Table2,
  Tag,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, onNotify } from '../../api';
import type { ArrastreEntry, AutoImgFolder, AutoImgStatus, AutoImgTab } from './types';
import GoogleAuthPanel from './components/GoogleAuthPanel';
import GoogleDrivePanel from './components/GoogleDrivePanel';
import BdImgTable from './components/BdImgTable';
import FolderMgmt from './components/FolderMgmt';
import RenameExportPanel from './components/RenameExportPanel';
import SyncPanel from './components/SyncPanel';
import SyncActions from './components/SyncActions';
import LogsViewer from './components/LogsViewer';
import ArrastreViewer from './components/ArrastreViewer';
import AutoImgSidebarHeader from './components/AutoImgSidebarHeader';
import { SidebarShell } from './components/shared';

const TABS: { id: AutoImgTab; label: string; icon: LucideIcon; hint: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, hint: 'Resumen y sync' },
  { id: 'bdimg', label: 'Padrón', icon: Table2, hint: 'BD_IMG' },
  { id: 'arrastre', label: 'Arrastre', icon: ClipboardList, hint: 'Casos manuales' },
  { id: 'carpetas', label: 'Carpetas', icon: FolderOpen, hint: 'Fuentes Drive' },
  { id: 'renombrar', label: 'Renombrar', icon: Tag, hint: 'NIS → SGIO en carpeta destino' },
  { id: 'logs', label: 'Logs', icon: ScrollText, hint: 'Historial' },
];

function statusFromBootstrap(data: Awaited<ReturnType<typeof api.autoimgBootstrap>>): AutoImgStatus {
  return {
    connected: data.connected,
    sheetName: data.sheetName,
    sheetId: data.sheetId,
    sheetLinked: data.sheetLinked,
    lastSync: data.lastSync,
    autoSync: data.autoSync,
    totalNis: data.totalNis,
    completos: data.completos,
    faltantes: data.faltantes,
    sobrantes: data.sobrantes,
    sinSgio: data.sinSgio,
    carpetasActivas: data.carpetasActivas,
  };
}

export default function AutoIMGApp() {
  const [activeTab, setActiveTab] = useState<AutoImgTab>('dashboard');
  const [status, setStatus] = useState<AutoImgStatus | null>(null);
  const [bdRows, setBdRows] = useState<string[][]>([]);
  const [logRows, setLogRows] = useState<string[][]>([]);
  const [folders, setFolders] = useState<AutoImgFolder[]>([]);
  const [arrastre, setArrastre] = useState<ArrastreEntry[]>([]);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [bootstrapError, setBootstrapError] = useState('');
  const [globalError, setGlobalError] = useState('');
  const [syncStatus, setSyncStatus] = useState<{ error?: string; result?: string }>({});

  const loadBootstrap = useCallback(async (refresh = true) => {
    try {
      const data = await api.autoimgBootstrap(refresh);
      setStatus(statusFromBootstrap(data));
      setBdRows(data.bdRows);
      setLogRows(data.logRows);
      setFolders(data.folders);
      setArrastre(data.arrastre);
      setGoogleConnected(data.connected);
      setBootstrapError('');
    } catch (e) {
      setStatus(null);
      const msg = e instanceof Error ? e.message : 'Error al cargar AutoIMG';
      setBootstrapError(msg);
      if (/expiró|revocad|Conectar con Google|invalid_grant|No autenticado/i.test(msg)) {
        setGoogleConnected(false);
      }
    }
  }, []);

  const refreshFolders = useCallback(async () => {
    try {
      const res = await api.autoimgFoldersList(true);
      setFolders(res.folders);
    } catch { /* sheet not ready */ }
  }, []);

  const refreshAfterFolderChange = useCallback(async () => {
    await refreshFolders();
    try {
      setStatus(await api.autoimgStatus());
    } catch { /* sheet not ready */ }
  }, [refreshFolders]);

  const refreshLogs = useCallback(async () => {
    try {
      const res = await api.autoimgLogsList(true);
      setLogRows(res.values);
    } catch {
      setLogRows([]);
    }
  }, []);

  const refreshArrastre = useCallback(async () => {
    try {
      const res = await api.autoimgArrastreList(true);
      setArrastre(res.entries);
    } catch {
      setArrastre([]);
    }
  }, []);

  useEffect(() => {
    loadBootstrap(true);
  }, [loadBootstrap]);

  useEffect(() => {
    return onNotify((method, params) => {
      if (method === 'autoimg.error' && params && typeof params === 'object') {
        const p = params as Record<string, unknown>;
        setGlobalError(String(p.detail || p.code || 'Error de AutoIMG'));
      }
      if (method === 'autoimg.sync.from_complete') {
        loadBootstrap(true);
      }
    });
  }, [loadBootstrap]);

  const handleSynced = useCallback(() => {
    loadBootstrap(true);
  }, [loadBootstrap]);

  const handleAuthChange = useCallback((connected: boolean) => {
    setGoogleConnected(connected);
    if (connected) {
      loadBootstrap(true);
    } else {
      setStatus(null);
      setBdRows([]);
      setLogRows([]);
      setFolders([]);
      setArrastre([]);
    }
  }, [loadBootstrap]);

  const handleSheetLinked = useCallback(() => {
    loadBootstrap(true);
  }, [loadBootstrap]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--bg-base)]">
      <div className="flex h-12 shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/80">
        <div className="flex w-[280px] min-w-[240px] shrink-0 items-center border-r border-[var(--border-subtle)] px-4">
          <AutoImgSidebarHeader
            connected={!!status?.connected || googleConnected}
            sheetName={status?.sheetName}
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center">
          <nav
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-3"
            aria-label="Secciones de AutoIMG"
          >
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.hint}
                  className={`relative flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] ${
                    isActive
                      ? 'bg-[var(--bg-elevated)] font-medium text-[var(--text-primary)] shadow-[inset_0_0_0_1px_var(--border-medium)]'
                      : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]/50 hover:text-[var(--text-secondary)]'
                  }`}
                >
                  <Icon
                    size={14}
                    strokeWidth={isActive ? 2 : 1.75}
                    className={isActive ? 'text-[var(--accent-primary-hover)]' : ''}
                  />
                  {tab.label}
                </button>
              );
            })}
          </nav>
          <SyncPanel
            autoSync={status?.autoSync ?? false}
            onAutoSyncChange={(enabled) => setStatus((s) => (s ? { ...s, autoSync: enabled } : s))}
            lastSync={status?.lastSync}
            sheetName={status?.sheetName}
            total={status?.totalNis}
            completos={status?.completos}
            faltantes={status?.faltantes}
            sobrantes={status?.sobrantes}
            sinSgio={status?.sinSgio}
            statusMessage={syncStatus}
          />
          <SyncActions
            onSynced={handleSynced}
            onStatus={setSyncStatus}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-[280px] min-w-[240px] shrink-0 flex-col border-r border-[var(--border-subtle)]">
          <div className="flex-1 overflow-y-auto px-3 py-4">
            <SidebarShell title="Conexión">
              <GoogleAuthPanel
                onAuthChange={handleAuthChange}
                onSheetLinked={handleSheetLinked}
              />
              <GoogleDrivePanel
                googleConnected={googleConnected}
                onFolderAdded={refreshAfterFolderChange}
              />
            </SidebarShell>
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden p-4 md:p-5">
          {(bootstrapError || globalError) && (
            <div className="mb-4 rounded-xl border border-[color-mix(in_srgb,var(--accent-red)_25%,transparent)] bg-[color-mix(in_srgb,var(--accent-red)_8%,transparent)] px-3.5 py-2.5 text-[11px] text-[var(--accent-red)]">
              {bootstrapError || globalError}
            </div>
          )}
          {activeTab === 'dashboard' && (
            <div className="h-full min-h-0 overflow-hidden">
              <BdImgTable rows={bdRows} />
            </div>
          )}
          {activeTab === 'bdimg' && (
            <div className="h-full">
              <BdImgTable rows={bdRows} />
            </div>
          )}
          {activeTab === 'arrastre' && (
            <div className="h-full">
              <ArrastreViewer entries={arrastre} onRefresh={refreshArrastre} />
            </div>
          )}
          {activeTab === 'carpetas' && (
            <FolderMgmt folders={folders} onFoldersChange={refreshAfterFolderChange} />
          )}
          {activeTab === 'renombrar' && (
            <RenameExportPanel onDone={() => loadBootstrap(true)} />
          )}
          {activeTab === 'logs' && (
            <div className="h-full">
              <LogsViewer rows={logRows} onRefresh={refreshLogs} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
