import { useCallback, useState } from 'react';
import { flowsApi } from '../../api/flowsApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import { SegmentedControl } from '../ui/SegmentedControl';
import FlowEditor from './FlowEditor';
import FlowList from './FlowList';
import RunsView from './RunsView';

type Section = 'flows' | 'runs' | 'connections' | 'providers';

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'flows', label: 'Flujos' },
  { value: 'runs', label: 'Ejecuciones' },
  { value: 'connections', label: 'Conexiones' },
  { value: 'providers', label: 'Proveedores IA' },
];

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
      <p className="max-w-sm text-xs text-[var(--text-secondary)]">
        Disponible en una próxima versión: conexiones OAuth a apps externas y proveedores de
        modelos IA con tus propias claves.
      </p>
    </div>
  );
}

export default function FlowsView() {
  const { addToast } = useToast();
  const [section, setSection] = useState<Section>('flows');
  const [editingFlowId, setEditingFlowId] = useState<string | null>(null);
  const [listRefresh, setListRefresh] = useState(0);

  const openEditor = useCallback((flowId: string) => setEditingFlowId(flowId), []);
  const closeEditor = useCallback(() => {
    setEditingFlowId(null);
    setListRefresh((k) => k + 1);
  }, []);

  const runFlow = useCallback(
    async (flowId: string) => {
      try {
        await flowsApi.flowsRun(flowId);
        addToast({ message: 'Ejecución iniciada', type: 'success' });
        setSection('runs');
      } catch (err) {
        addToast({ message: errorMessage(err, 'No se pudo ejecutar el flujo'), type: 'error' });
      }
    },
    [addToast],
  );

  return (
    <div className="flex h-full flex-col bg-[var(--bg-base)]">
      <header className="flex items-center justify-between border-b border-[var(--border-medium)] px-5 py-3">
        <h1 className="text-base font-semibold text-[var(--text-primary)]">Flujos</h1>
        <SegmentedControl
          options={SECTIONS}
          value={section}
          onChange={(v) => {
            setSection(v);
            if (v !== 'flows') setEditingFlowId(null);
          }}
          aria-label="Secciones de Flujos"
          className="flex w-[420px] gap-0.5 rounded-lg bg-[var(--bg-input)] p-0.5"
        />
      </header>

      <div className="min-h-0 flex-1">
        {section === 'flows' &&
          (editingFlowId ? (
            <FlowEditor
              flowId={editingFlowId}
              onBack={closeEditor}
              onRunStarted={() => setSection('runs')}
            />
          ) : (
            <FlowList onOpen={openEditor} onRun={(id) => void runFlow(id)} refreshKey={listRefresh} />
          ))}
        {section === 'runs' && <RunsView />}
        {section === 'connections' && <ComingSoon title="Conexiones" />}
        {section === 'providers' && <ComingSoon title="Proveedores IA" />}
      </div>
    </div>
  );
}
