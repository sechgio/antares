import { useCallback, useState } from 'react';
import { flowsApi } from '../../api/flowsApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import { SegmentedControl } from '../ui/SegmentedControl';
import ConnectionsView from './ConnectionsView';
import ProvidersView from './ProvidersView';
import FlowEditor from './FlowEditor';
import FlowList from './FlowList';
import RunsView from './RunsView';

export type FlowsSection = 'flows' | 'runs' | 'connections' | 'providers';

const SECTIONS: { value: FlowsSection; label: string }[] = [
  { value: 'flows', label: 'Flujos' },
  { value: 'runs', label: 'Ejecuciones' },
  { value: 'connections', label: 'Conexiones' },
  { value: 'providers', label: 'Proveedores IA' },
];

export default function FlowsView({
  registerLeaveGuard,
  initialSection,
  onAskAgent,
}: {
  active?: boolean;
  registerLeaveGuard?: (guard: (() => Promise<boolean>) | null) => void;
  initialSection?: FlowsSection;
  onAskAgent?: (flowName: string) => void;
}) {
  const { addToast } = useToast();
  const [section, setSection] = useState<FlowsSection>(initialSection ?? 'flows');
  const [editingFlowId, setEditingFlowId] = useState<string | null>(null);
  const [runsFlowId, setRunsFlowId] = useState<string | undefined>(undefined);
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
        setRunsFlowId(undefined);
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
          onChange={setSection}
          aria-label="Secciones de Flujos"
          className="flex w-[460px] gap-0.5 rounded-lg bg-[var(--bg-input)] p-0.5"
        />
      </header>

      <div className="min-h-0 flex-1">
        {editingFlowId ? (
          <div className={`h-full ${section === 'flows' ? '' : 'hidden'}`} inert={section !== 'flows'}>
            <FlowEditor
              active={section === 'flows'}
              registerLeaveGuard={registerLeaveGuard}
              flowId={editingFlowId}
              onBack={closeEditor}
              onRunStarted={() => setSection('runs')}
              onAskAgent={onAskAgent}
            />
          </div>
          ) : section === 'flows' && (
            <FlowList
              onOpen={openEditor}
              onRun={(id) => void runFlow(id)}
              onShowRuns={(id) => {
                setRunsFlowId(id);
                setSection('runs');
              }}
              refreshKey={listRefresh}
            />
          )}
        {section === 'runs' && <RunsView flowId={runsFlowId} />}
        {section === 'connections' && <ConnectionsView />}
        {section === 'providers' && <ProvidersView />}
      </div>
    </div>
  );
}
