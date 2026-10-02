import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, Square } from 'lucide-react';
import { flowsApi } from '../../api/flowsApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import { FlowStatusBadge } from './FlowList';
import type { FlowRun } from './types';

const POLL_MS = 1500;

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es');
}

function StepOutput({ value }: { value: unknown }) {
  if (value == null) return null;
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text.length > 4000) text = `${text.slice(0, 4000)}…`;
  return (
    <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-[var(--border-medium)] bg-[var(--bg-base)] p-2 text-[11px] leading-snug text-[var(--text-secondary)]">
      {text}
    </pre>
  );
}

export default function RunsView({ flowId }: { flowId?: string }) {
  const { addToast } = useToast();
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await flowsApi.flowsRunsList({ ...(flowId ? { flow_id: flowId } : {}), limit: 50 });
        setRuns(res.runs);
      } catch (err) {
        if (!silent) {
          addToast({ message: errorMessage(err, 'No se pudieron cargar las ejecuciones'), type: 'error' });
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [flowId, addToast],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const active = runs.some((r) => r.status === 'queued' || r.status === 'running');
    if (active && timerRef.current == null) {
      timerRef.current = window.setInterval(() => {
        void load(true);
      }, POLL_MS);
    }
    if (!active && timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [runs, load]);

  const cancel = async (runId: string) => {
    try {
      await flowsApi.flowsRunCancel(runId);
      void load(true);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo cancelar'), type: 'error' });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border-medium)] px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Ejecuciones</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            Historial de runs con el resultado de cada nodo.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} aria-label="Recargar">
          <RefreshCw size={15} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <p className="text-sm text-[var(--text-secondary)]">Cargando…</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">
            Sin ejecuciones todavía. Ejecuta un flujo desde el editor o desde la lista.
          </p>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => {
              const open = expanded === run.id;
              return (
                <div
                  key={run.id}
                  className="rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)]"
                >
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <button
                      className="flex items-center gap-1 text-[var(--text-secondary)]"
                      onClick={() => setExpanded(open ? null : run.id)}
                      aria-label={open ? 'Contraer' : 'Expandir'}
                    >
                      {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setExpanded(open ? null : run.id)}
                    >
                      <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {run.flow_name || run.flow_id}
                      </span>
                      <span className="ml-2 text-[11px] text-[var(--text-secondary)]">
                        {fmtDate(run.created_at)}
                      </span>
                    </button>
                    <FlowStatusBadge status={run.status} />
                    {(run.status === 'queued' || run.status === 'running') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void cancel(run.id)}
                        aria-label="Cancelar"
                        title="Cancelar ejecución"
                      >
                        <Square size={13} />
                      </Button>
                    )}
                  </div>

                  {open && (
                    <div className="border-t border-[var(--border-medium)] px-4 py-3">
                      {run.error && (
                        <p className="mb-2 rounded-md border border-[var(--border-medium)] bg-[var(--bg-base)] p-2 text-xs text-[var(--accent-red,#ef4444)]">
                          {run.error}
                        </p>
                      )}
                      {run.steps.length === 0 ? (
                        <p className="text-xs text-[var(--text-secondary)]">Sin pasos registrados.</p>
                      ) : (
                        <ol className="space-y-1.5">
                          {run.steps.map((step, i) => (
                            <li
                              key={`${step.node_id}-${i}`}
                              className="rounded-md border border-[var(--border-medium)] bg-[var(--bg-base)] px-3 py-2"
                            >
                              <div className="flex items-center gap-2 text-xs">
                                <span className="font-medium text-[var(--text-primary)]">
                                  {step.name}
                                </span>
                                <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                                  {step.kind}
                                </span>
                                <span
                                  className="text-[10px] uppercase tracking-wide"
                                  style={{
                                    color:
                                      step.status === 'success'
                                        ? '#34d399'
                                        : step.status === 'error'
                                          ? 'var(--accent-red,#ef4444)'
                                          : 'var(--text-secondary)',
                                  }}
                                >
                                  {step.status === 'skipped' ? 'omitido' : step.status}
                                </span>
                                <span className="flex-1" />
                                {step.duration_ms != null && (
                                  <span className="text-[10px] text-[var(--text-secondary)]">
                                    {step.duration_ms} ms
                                  </span>
                                )}
                              </div>
                              {step.error && (
                                <p className="mt-1 text-[11px] text-[var(--accent-red,#ef4444)]">
                                  {step.error}
                                </p>
                              )}
                              <StepOutput value={step.output} />
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
