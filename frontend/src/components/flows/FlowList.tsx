import { useCallback, useEffect, useState } from 'react';
import { Copy, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { flowsApi } from '../../api/flowsApi';
import { errorMessage } from '../../utils/errors';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import type { FlowMeta, FlowRunStatus } from './types';

const STATUS_LABELS: Record<FlowRunStatus, string> = {
  queued: 'En cola',
  running: 'Ejecutando',
  success: 'Éxito',
  error: 'Error',
  cancelled: 'Cancelado',
};

const STATUS_COLORS: Record<FlowRunStatus, string> = {
  queued: 'var(--text-secondary)',
  running: '#38bdf8',
  success: '#34d399',
  error: 'var(--accent-red, #ef4444)',
  cancelled: 'var(--text-secondary)',
};

export function FlowStatusBadge({ status }: { status: FlowRunStatus }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-medium)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLORS[status] }} />
      {STATUS_LABELS[status]}
    </span>
  );
}

interface Props {
  onOpen: (flowId: string) => void;
  onRun: (flowId: string) => void;
  refreshKey: number;
}

export default function FlowList({ onOpen, onRun, refreshKey }: Props) {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const [flows, setFlows] = useState<FlowMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await flowsApi.flowsList();
      setFlows(res.flows);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudieron cargar los flujos'), type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const createFlow = async () => {
    try {
      const res = await flowsApi.flowsCreate({ name: 'Nuevo flujo' });
      addToast({ message: 'Flujo creado', type: 'success' });
      onOpen(res.flow.id);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo crear el flujo'), type: 'error' });
    }
  };

  const duplicateFlow = async (id: string) => {
    try {
      await flowsApi.flowsDuplicate(id);
      addToast({ message: 'Flujo duplicado', type: 'success' });
      void load();
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo duplicar'), type: 'error' });
    }
  };

  const deleteFlow = async (flow: FlowMeta) => {
    const ok = await confirm({
      title: 'Eliminar flujo',
      description: `Se eliminará "${flow.name}" y su historial de ejecuciones. Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      type: 'destructive',
    });
    if (!ok) return;
    try {
      await flowsApi.flowsDelete(flow.id);
      addToast({ message: 'Flujo eliminado', type: 'success' });
      void load();
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo eliminar'), type: 'error' });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border-medium)] px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Mis flujos</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            Automatizaciones sobre las herramientas de la app.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void load()} aria-label="Recargar">
            <RefreshCw size={15} />
          </Button>
          <Button variant="primary" size="sm" onClick={() => void createFlow()}>
            <Plus size={15} className="mr-1" />
            Nuevo flujo
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <p className="text-sm text-[var(--text-secondary)]">Cargando…</p>
        ) : flows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-[var(--text-secondary)]">
              Todavía no hay flujos. Crea el primero para encadenar acciones de la app.
            </p>
            <Button variant="primary" size="sm" onClick={() => void createFlow()}>
              <Plus size={15} className="mr-1" />
              Crear flujo
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {flows.map((flow) => (
              <div
                key={flow.id}
                className="group flex flex-col rounded-xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-4 transition-colors hover:border-[var(--accent-primary)]"
              >
                <button
                  className="text-left"
                  onClick={() => onOpen(flow.id)}
                  title="Abrir editor"
                >
                  <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                    {flow.name}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
                    {flow.description || 'Sin descripción'}
                  </div>
                </button>
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {flow.last_run_status ? (
                      <FlowStatusBadge status={flow.last_run_status} />
                    ) : (
                      <span className="text-[11px] text-[var(--text-secondary)]">Sin ejecuciones</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRun(flow.id)}
                      aria-label="Ejecutar"
                      title="Ejecutar ahora"
                    >
                      <Play size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void duplicateFlow(flow.id)}
                      aria-label="Duplicar"
                      title="Duplicar"
                    >
                      <Copy size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void deleteFlow(flow)}
                      aria-label="Eliminar"
                      title="Eliminar"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-[var(--text-secondary)]">
                  Actualizado {new Date(flow.updated_at).toLocaleString('es')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
