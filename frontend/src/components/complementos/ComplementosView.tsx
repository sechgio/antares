import { useState, type ComponentType } from 'react';
import { Blocks, Sparkles } from 'lucide-react';
import type { ConnectionProviderSpec } from '../../api/connectionsApi';
import ConnectionsView from '../connections/ConnectionsView';
import { ProviderIcon } from '../connections/connectionIcons';
import SkillsView from './SkillsView';

type Section = 'complementos' | 'habilidades';

const SECTIONS: { id: Section; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'complementos', label: 'Complementos', icon: Blocks },
  { id: 'habilidades', label: 'Habilidades', icon: Sparkles },
];

const NAV_ROW = 'flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors duration-150';
const NAV_IDLE = 'text-[var(--text-secondary)] hover:bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)] hover:text-[var(--text-primary)]';
const NAV_ON = 'bg-[var(--bg-input)] text-[var(--text-primary)]';

export default function ComplementosView() {
  const [section, setSection] = useState<Section>('complementos');
  const [providers, setProviders] = useState<ConnectionProviderSpec[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const installed = providers.filter((p) => p.connected);

  return (
    <div className="flex h-full bg-[var(--bg-base)]">
      <aside aria-label="Personalizar" className="hidden w-60 shrink-0 flex-col border-r border-[var(--border-subtle)] px-2.5 py-4 md:flex">
        <h2 className="px-2.5 pb-3 text-[15px] font-semibold text-[var(--text-primary)]">Personalizar</h2>
        <nav aria-label="Secciones de personalización" className="flex flex-col gap-0.5">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={section === id ? 'page' : undefined}
              onClick={() => setSection(id)}
              className={`${NAV_ROW} ${section === id ? NAV_ON : NAV_IDLE}`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>
        <div className="mt-6 px-2.5 pb-1.5 text-[12px] font-medium text-[var(--text-muted)]">Instalados</div>
        <ul aria-label="Complementos instalados" className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {installed.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  setSection('complementos');
                  setDetailId(p.id);
                }}
                className={`${NAV_ROW} ${section === 'complementos' && detailId === p.id ? NAV_ON : NAV_IDLE}`}
              >
                <ProviderIcon providerId={p.id} label={p.label} size={18} />
                <span className="truncate">{p.label}</span>
              </button>
            </li>
          ))}
          {!installed.length && <li className="px-2.5 text-[12px] text-[var(--text-muted)]">Ninguno todavía</li>}
        </ul>
      </aside>

      <div className="relative min-w-0 flex-1">
        <div hidden={section !== 'complementos'} className="h-full">
          <ConnectionsView detailId={detailId} onDetailChange={setDetailId} onProvidersChange={setProviders} />
        </div>
        {section === 'habilidades' && <SkillsView />}
      </div>
    </div>
  );
}
