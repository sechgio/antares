import { useState } from 'react';
import { Camera } from 'lucide-react';
import BrandMark from '../brand/BrandMark';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const tabs = [
  { id: 'convert', icon: LightningIcon, label: 'Conversión', shortcut: '1' },
  { id: 'db', icon: DatabaseIcon, label: 'Base de datos', shortcut: '2' },
  { id: 'formatos', icon: FilePdfIcon, label: 'Formatos PDF', shortcut: '3' },
  { id: 'padron', icon: ScrollTextIcon, label: 'Generar Padrones', shortcut: '4' },
  { id: 'volantes', icon: MegaphoneIcon, label: 'Generar Volantes', shortcut: '5' },
  { id: 'reportesCampo', icon: Camera, label: 'Reportes de Campo', shortcut: '8' },
  { id: 'imageOptimizer', icon: ImageOptimizerIcon, label: 'Optimizador', shortcut: '9' },
  { id: 'history', icon: HistoryIcon, label: 'Historial', shortcut: '6' },
  { id: 'appearance', icon: PaletteIcon, label: 'Apariencia', shortcut: '7' },
];

function LightningIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function DatabaseIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function PaletteIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="13.5" cy="6.5" r=".5" />
      <circle cx="17.5" cy="10.5" r=".5" />
      <circle cx="8.5" cy="7.5" r=".5" />
      <circle cx="6.5" cy="12.5" r=".5" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.01 17.461 2 12 2z" />
    </svg>
  );
}

function MegaphoneIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 11l18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </svg>
  );
}

function ScrollTextIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function FilePdfIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M9 15v-2" />
      <path d="M12 15v-6" />
      <path d="M15 15v-4" />
    </svg>
  );
}

function ImageOptimizerIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <aside
      className="shrink-0 flex flex-col bg-[var(--bg-base)] border-r border-[var(--border-subtle)] transition-all duration-300 ease-out overflow-hidden"
      style={{ width: expanded ? 224 : 64 }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* App branding — visible when expanded */}
      <div
        className="flex items-center px-4 shrink-0 overflow-hidden transition-all duration-300"
        style={{ height: expanded ? 52 : 0, opacity: expanded ? 1 : 0, marginTop: expanded ? 12 : 0, marginBottom: expanded ? 8 : 0 }}
      >
        <BrandMark showText />
      </div>

      {/* Tabs */}
      <div className="flex flex-col gap-0.5 flex-1 py-2 px-2 min-h-0">
        {tabs.map((t) => {
          const isActive = activeTab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              title={!expanded ? t.label : undefined}
              className={`relative flex items-center gap-3 px-2 py-2.5 rounded-xl transition-all duration-200 w-full ${
                isActive
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]'
              }`}
            >
              <span className={`shrink-0 flex items-center justify-center ${expanded ? '' : 'mx-auto'}`}>
                <Icon className={isActive ? 'text-[var(--text-primary)]' : ''} />
              </span>
              <span
                className="text-[13px] font-medium whitespace-nowrap overflow-hidden transition-all duration-300"
                style={{ width: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }}
              >
                {t.label}
              </span>
              {expanded && isActive && (
                <span className="absolute right-2 w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]" />
              )}
              {!expanded && isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-[var(--accent-primary)]" />
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
