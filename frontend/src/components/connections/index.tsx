import { useState } from 'react';
import { SegmentedControl } from '../ui/SegmentedControl';
import ConnectionsView from './ConnectionsView';
import ProvidersView from './ProvidersView';

export type ConnectionsSection = 'connections' | 'providers';

const SECTIONS: { value: ConnectionsSection; label: string }[] = [
  { value: 'connections', label: 'Conexiones' },
  { value: 'providers', label: 'Proveedores IA' },
];

export default function ConnectionsHub({
  initialSection,
}: {
  active?: boolean;
  initialSection?: ConnectionsSection;
}) {
  const [section, setSection] = useState<ConnectionsSection>(initialSection ?? 'connections');

  return (
    <div className="flex h-full flex-col bg-[var(--bg-base)]">
      <header className="flex items-center justify-between border-b border-[var(--border-medium)] px-5 py-3">
        <h1 className="text-base font-semibold text-[var(--text-primary)]">Conexiones</h1>
        <SegmentedControl
          options={SECTIONS}
          value={section}
          onChange={setSection}
          aria-label="Secciones de Conexiones"
          className="flex w-[260px] gap-0.5 rounded-lg bg-[var(--bg-input)] p-0.5"
        />
      </header>
      <div className="min-h-0 flex-1">
        {section === 'connections' ? <ConnectionsView /> : <ProvidersView />}
      </div>
    </div>
  );
}
