import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import type { ArrastreEntry, AutoImgFolder, AutoImgStatus, AutoImgTab } from './types';
import GoogleAuthPanel from './components/GoogleAuthPanel';
import GoogleDrivePanel from './components/GoogleDrivePanel';
import DashboardCards from './components/DashboardCards';
import BdImgTable from './components/BdImgTable';
import FolderMgmt from './components/FolderMgmt';
import ScannerPanel from './components/ScannerPanel';
import SyncPanel from './components/SyncPanel';
import LogsViewer from './components/LogsViewer';
import ArrastreViewer from './components/ArrastreViewer';
import AutoImgSidebarHeader from './components/AutoImgSidebarHeader';
import { SidebarShell } from './components/shared';

const TABS: { id: AutoImgTab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'bdimg', label: 'BD_IMG' },
  { id: 'arrastre', label: 'Arrastre' },
  { id: 'carpetas', label: 'Carpetas' },
  { id: 'scan', label: 'Escaneo' },
  { id: 'logs', label: 'Logs' },
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

  const loadBootstrap = useCallback(async (refresh = true) => {
    try {
      const data = await api.autoimgBootstrap(refresh);
      setStatus(statusFromBootstrap(data));
      setBdRows(data.bdRows);
      setLogRows(data.logRows);
      setFolders(data.folders);
      setArrastre(data.arrastre);
      setGoogleConnected(data.connected);
    } catch {
      setStatus(null);
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

  const handleSynced = useCallback(() => {
    loadBootstrap(true);
  }, [loadBootstrap]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--bg-base)]">
      <div className="flex h-11 shrink-0 border-b border-[var(--border-subtle)]">
        <div className="flex w-[260px] min-w-[240px] shrink-0 items-center border-r border-[var(--border-subtle)] px-5">
          <AutoImgSidebarHeader connected={!!status?.connected} />
        </div>
        <nav className="flex min-w-0 flex-1 items-stretch gap-6 overflow-x-auto px-6">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex shrink-0 items-center text-[13px] transition-colors ${
                  isActive
                    ? 'font-medium text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {tab.label}
                {isActive && (
                  <span className="absolute inset-x-0 bottom-0 h-px bg-[var(--text-primary)]" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-[260px] min-w-[240px] shrink-0 flex-col border-r border-[var(--border-subtle)]">
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <SidebarShell title="Conexión">
              <GoogleAuthPanel
                onAuthChange={(connected) => {
                  setGoogleConnected(connected);
                  if (connected) loadBootstrap(true);
                  else {
                    setStatus(null);
                    setBdRows([]);
                    setLogRows([]);
                    setFolders([]);
                    setArrastre([]);
                  }
                }}
                onSheetLinked={() => loadBootstrap(true)}
              />
              <GoogleDrivePanel
                googleConnected={googleConnected}
                onFolderAdded={refreshAfterFolderChange}
              />
            </SidebarShell>
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden p-5 md:p-6">
          {activeTab === 'dashboard' && (
            <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
              <DashboardCards
                total={status?.totalNis}
                completos={status?.completos}
                faltantes={status?.faltantes}
                sobrantes={status?.sobrantes}
              />
              <SyncPanel
                autoSync={status?.autoSync ?? false}
                onAutoSyncChange={(enabled) => setStatus((s) => (s ? { ...s, autoSync: enabled } : s))}
                onSynced={handleSynced}
                lastSync={status?.lastSync}
                sheetName={status?.sheetName}
              />
              <div className="min-h-0 flex-1">
                <BdImgTable rows={bdRows} />
              </div>
            </div>
          )}
          {activeTab === 'bdimg' && <div className="h-full"><BdImgTable rows={bdRows} /></div>}
          {activeTab === 'arrastre' && (
            <div className="h-full">
              <ArrastreViewer entries={arrastre} onRefresh={refreshArrastre} />
            </div>
          )}
          {activeTab === 'carpetas' && (
            <FolderMgmt folders={folders} onFoldersChange={refreshAfterFolderChange} />
          )}
          {activeTab === 'scan' && <ScannerPanel onSynced={handleSynced} />}
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