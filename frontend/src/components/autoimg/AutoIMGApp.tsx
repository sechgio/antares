import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import type { AutoImgStatus, AutoImgTab } from './types';
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

const TABS: { id: AutoImgTab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'bdimg', label: 'BD_IMG' },
  { id: 'arrastre', label: 'Arrastre' },
  { id: 'carpetas', label: 'Carpetas' },
  { id: 'scan', label: 'Escaneo' },
  { id: 'logs', label: 'Logs' },
];

export default function AutoIMGApp() {
  const [activeTab, setActiveTab] = useState<AutoImgTab>('dashboard');
  const [status, setStatus] = useState<AutoImgStatus | null>(null);
  const [bdRows, setBdRows] = useState<string[][]>([]);
  const [googleConnected, setGoogleConnected] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.autoimgStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  const refreshBdImg = useCallback(async () => {
    try {
      const res = await api.autoimgSyncFromSheet();
      setBdRows(res.rows);
    } catch {
      try {
        const res = await api.autoimgSheetsReadRange('BD_IMG!A:M');
        setBdRows(res.values);
      } catch { /* not connected */ }
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    refreshBdImg();
  }, [refreshStatus, refreshBdImg]);

  const handleSynced = useCallback(() => {
    refreshStatus();
    refreshBdImg();
  }, [refreshStatus, refreshBdImg]);

  return (
    <div className="flex h-full overflow-hidden bg-[var(--bg-base)]">
      <aside className="flex w-[260px] min-w-[240px] shrink-0 flex-col border-r border-[var(--border-subtle)]">
        <AutoImgSidebarHeader connected={!!status?.connected} />
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <GoogleAuthPanel
            onAuthChange={(connected) => {
              setGoogleConnected(connected);
              refreshStatus();
              if (connected) refreshBdImg();
            }}
            onSheetLinked={() => {
              refreshStatus();
              refreshBdImg();
            }}
          />
          <GoogleDrivePanel
            googleConnected={googleConnected}
            onFolderAdded={refreshStatus}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <nav className="flex shrink-0 gap-6 overflow-x-auto border-b border-[var(--border-subtle)] px-6">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative shrink-0 py-3.5 text-[13px] transition-colors ${
                  isActive
                    ? 'font-medium text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {tab.label}
                {isActive && (
                  <span className="absolute inset-x-0 -bottom-px h-px bg-[var(--text-primary)]" />
                )}
              </button>
            );
          })}
        </nav>

        <main className="min-h-0 flex-1 overflow-hidden p-5 md:p-6">
          {activeTab === 'dashboard' && (
            <div className="flex h-full flex-col gap-5 overflow-y-auto">
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
              />
              <div className="min-h-[280px] flex-1">
                <BdImgTable rows={bdRows} />
              </div>
            </div>
          )}
          {activeTab === 'bdimg' && <div className="h-full"><BdImgTable rows={bdRows} /></div>}
          {activeTab === 'arrastre' && <div className="h-full"><ArrastreViewer /></div>}
          {activeTab === 'carpetas' && <FolderMgmt />}
          {activeTab === 'scan' && <ScannerPanel onSynced={handleSynced} />}
          {activeTab === 'logs' && <LogsViewer />}
        </main>
      </div>
    </div>
  );
}