import { Database, Eye, PenLine } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import type { ReportWorkspaceMobileTab } from '../../hooks/useReportWorkspace';
import Button from '../ui/Button';
import { FileImportInput } from '../ui/FileImportInput';

interface Props {
  title: string;
  appClassName?: string;
  surface?: string;
  actions: ReactNode;
  headerCenter?: ReactNode;
  importInputRef: RefObject<HTMLInputElement | null>;
  onImportFile: (file: File) => void;
  mobileTab: ReportWorkspaceMobileTab;
  onMobileTabChange: (tab: ReportWorkspaceMobileTab) => void;
  dbTabLabel: string;
  tabsAriaLabel: string;
  workspaceClassName?: string;
  workspaceProps?: Record<string, string>;
  trailing?: ReactNode;
  children: ReactNode;
}

const TABS: Array<{ id: ReportWorkspaceMobileTab; icon: ReactNode }> = [
  { id: 'db', icon: <Database size={14} /> },
  { id: 'preview', icon: <Eye size={14} /> },
  { id: 'form', icon: <PenLine size={14} /> },
];

export default function ReportWorkspaceShell({
  title,
  appClassName,
  surface,
  actions,
  headerCenter,
  importInputRef,
  onImportFile,
  mobileTab,
  onMobileTabChange,
  dbTabLabel,
  tabsAriaLabel,
  workspaceClassName,
  workspaceProps,
  trailing,
  children,
}: Props) {
  const labels: Record<ReportWorkspaceMobileTab, string> = {
    db: dbTabLabel,
    preview: 'Vista previa',
    form: 'Editar',
  };
  return (
    <div
      className={`tr-app${appClassName ? ` ${appClassName}` : ''}`}
      {...(surface ? { 'data-surface': surface } : {})}
    >
      <header className="tr-header">
        <h1>{title}</h1>
        {headerCenter ? <div className="tr-header-center">{headerCenter}</div> : null}
        <div className="tr-header-toolbar">
          <div className="tr-header-actions">{actions}</div>
        </div>
        <FileImportInput
          ref={importInputRef}
          className="hidden"
          accept=".csv,.xlsx"
          onFiles={(files) => {
            const file = files?.[0];
            if (file) onImportFile(file);
          }}
        />
      </header>

      <nav className="tr-mobile-tabs" role="tablist" aria-label={tabsAriaLabel}>
        {TABS.map(({ id, icon }) => (
          <Button
            key={id}
            variant="none"
            size="none"
            role="tab"
            aria-selected={mobileTab === id}
            className={`tr-mobile-tab${mobileTab === id ? ' is-active' : ''}`}
            onClick={() => onMobileTabChange(id)}
          >
            {icon}
            <span>{labels[id]}</span>
          </Button>
        ))}
      </nav>

      <div
        className={`tr-workspace${workspaceClassName ? ` ${workspaceClassName}` : ''}`}
        data-mobile-tab={mobileTab}
        {...workspaceProps}
      >
        {children}
      </div>
      {trailing}
    </div>
  );
}
