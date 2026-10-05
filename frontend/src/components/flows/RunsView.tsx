import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Play, RefreshCw, Square } from 'lucide-react';
import { flowsApi } from '../../api/flowsApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import { useDialog } from '../../hooks/useDialog';
import Button from '../ui/Button';
import ThemedSelect from '../ui/ThemedSelect';
import { FlowStatusBadge } from './FlowList';
import FlowRunGraph from './FlowRunGraph';
import { NODE_KIND_DEFS } from './nodeDefs';
import type { FlowMeta, FlowNodeKind, FlowRun, FlowRunStatus } from './types';

const POLL_MS = 1500;

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es');
}

export function StepOutput({ value }: { value: unknown }) {
  if (value == null) return null;
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text.length > 4000) text = `${text.slice(0, 4000)}…`;
  const data = typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const readable = typeof value === 'string' ? value : typeof data?.text === 'string' ? data.text : null;
  const formats = Array.isArray(data?.formats) ? data.formats.filter((item): item is string => typeof item === 'string') : null;
  return (
    <div className="mt-2 space-y-2 text-xs text-[var(--text-secondary)]">
      {readable != null ? <p className="max-h-48 overflow-auto whitespace-pre-wrap">{readable}</p>
        : formats ? <p>Formatos disponibles: {formats.join(', ') || 'ninguno'}.</p>
        : <p>{Array.isArray(value) ? `${value.length} elementos recibidos.` : 'Paso completado. Puedes consultar los datos recibidos.'}</p>}
      <details>
        <summary className="cursor-pointer">Ver datos técnicos</summary>
        <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-[var(--border-medium)] bg-[var(--bg-base)] p-2 text-[11px] leading-snug text-[var(--text-secondary)]">
          {text}
        </pre>
      </details>
    </div>
  );
}

const STATUS_OPTIONS: { value: '' | FlowRunStatus; label: string }[] = [
  { value: '', label: 'Todos los estados' },
  { value: 'running', label: 'Ejecutando' },
  { value: 'queued', label: 'En cola' },
  { value: 'success', label: 'Éxito' },
  { value: 'error', label: 'Error' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'skipped', label: 'Omitida' },
];

export default function RunsView({ flowId }: { flowId?: string }) {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [flows, setFlows] = useState<FlowMeta[]>([]);
  const [filterFlow, setFilterFlow] = useState<string>(flowId ?? '');
  const [filterStatus, setFilterStatus] = useState<'' | FlowRunStatus>('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const requestRevision = useRef(0);
  const appliedRevision = useRef(0);

  useEffect(() => {
    let alive = true;
    flowsApi
      .flowsList()
      .then((res) => {
        if (alive) setFlows(res.flows);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(
    async (silent = false) => {
      const revision = ++requestRevision.current;
      if (!silent) setLoading(true);
      try {
        const effectiveFlow = flowId ?? (filterFlow || undefined);
        const res = await flowsApi.flowsRunsList({
          ...(effectiveFlow ? { flow_id: effectiveFlow } : {}),
          limit: 50,
        });
        if (revision > appliedRevision.current) {
          appliedRevision.current = revision;
          setRuns(res.runs);
          setLoading(false);
        }
      } catch (err) {
        if (revision > appliedRevision.current) {
          appliedRevision.current = revision;
          setLoading(false);
          if (!silent) addToast({ message: errorMessage(err, 'No se pudieron cargar las ejecuciones'), type: 'error' });
        }
      }
    },
    [flowId, filterFlow, addToast],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (timerRef.current == null) {
      timerRef.current = window.setInterval(() => {
        void load(true);
      }, POLL_MS);
    }
    return () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      appliedRevision.current = ++requestRevision.current;
    };
  }, [load]);

  const visibleRuns = filterStatus
    ? runs.filter((r) => r.status === filterStatus)
    : runs;

  const cancel = async (runId: string) => {
    try {
      await flowsApi.flowsRunCancel(runId);
      void load(true);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo cancelar'), type: 'error' });
    }
  };

  const rerun = async (run: FlowRun) => {
    let acknowledge = false;
    if (run.steps.some((step) => step.error?.includes('resultado incierto'))) {
      acknowledge = await confirm({
        title: 'Acción con resultado incierto',
        description: 'La ejecución anterior quedó interrumpida tras una acción y no se sabe si llegó a completarse. Reintentar con los mismos datos puede repetir su efecto (p. ej. una impresión o una conversión). Comprueba el resultado antes de continuar.',
        confirmLabel: 'Reintentar',
        type: 'destructive',
      });
      if (!acknowledge) return;
    }
    try {
      await flowsApi.flowsRun(run.flow_id, undefined, acknowledge);
      addToast({ message: 'Ejecución iniciada', type: 'success' });
      void load(true);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo ejecutar'), type: 'error' });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border-medium)] px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Ejecuciones</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            Historial de ejecuciones con el resultado de cada paso.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!flowId && (
            <div className="w-44">
              <ThemedSelect
                value={filterFlow}
                onChange={setFilterFlow}
                options={[
                  { value: '', label: 'Todos los flujos' },
                  ...flows.map((f) => ({ value: f.id, label: f.name })),
                ]}
              />
            </div>
          )}
          <div className="w-40">
            <ThemedSelect
              value={filterStatus}
              onChange={(v) => setFilterStatus(v as '' | FlowRunStatus)}
              options={STATUS_OPTIONS}
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()} aria-label="Recargar">
            <RefreshCw size={15} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <p className="text-sm text-[var(--text-secondary)]">Cargando…</p>
        ) : visibleRuns.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">
            {runs.length === 0
              ? 'Sin ejecuciones todavía. Ejecuta un flujo desde el editor o desde la lista.'
              : 'Ninguna ejecución coincide con los filtros.'}
          </p>
        ) : (
          <div className="space-y-2">
            {visibleRuns.map((run) => {
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
                    {run.status !== 'queued' && run.status !== 'running' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void rerun(run)}
                        aria-label="Ejecutar de nuevo"
                        title="Ejecutar de nuevo"
                      >
                        <Play size={13} />
                      </Button>
                    )}
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
                        <details className="mb-2 rounded-md border border-[var(--border-medium)] bg-[var(--bg-base)] p-2 text-xs text-[var(--accent-red,#ef4444)]">
                          <summary className="cursor-pointer">La ejecución no se completó. Revisa el paso que falló. Ver detalle.</summary>
                          <p className="mt-1">{run.error}</p>
                        </details>
                      )}
                      {run.graph && run.graph.nodes.length > 0 && (
                        <div className="mb-3">
                          <FlowRunGraph graph={run.graph} steps={run.steps} />
                        </div>
                      )}
                      {run.trigger_payload && Object.keys(run.trigger_payload).length > 0 && (
                        <details className="mb-2 text-[11px] text-[var(--text-secondary)]">
                          <summary className="cursor-pointer">Ver datos de inicio</summary>
                          <span className="font-medium">Origen:</span>{' '}
                          <code>{JSON.stringify(run.trigger_payload)}</code>
                        </details>
                      )}
                      {run.steps.length === 0 ? (
                        <p className="text-xs text-[var(--text-secondary)]">Sin pasos registrados.</p>
                      ) : (
                        <ol className="space-y-1.5">
                          {run.steps.map((step, i) => {
                            const stepDef = NODE_KIND_DEFS[step.kind as FlowNodeKind];
                            const StepIcon = stepDef?.icon;
                            return (
                            <li
                              key={`${step.node_id}-${i}`}
                              className="rounded-md border border-[var(--border-medium)] bg-[var(--bg-base)] px-3 py-2"
                            >
                              <div className="flex items-center gap-2 text-xs">
                                {stepDef && StepIcon && (
                                  <span
                                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                                    style={{
                                      background: `color-mix(in srgb, ${stepDef.accent} 16%, transparent)`,
                                      color: stepDef.accent,
                                    }}
                                  >
                                    <StepIcon size={11} />
                                  </span>
                                )}
                                <span className="font-medium text-[var(--text-primary)]">
                                  {step.name}
                                </span>
                                <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                                  {stepDef?.label ?? step.kind}
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
                                  {({ success: 'Completado', error: 'Falló', running: 'En curso', skipped: 'No se ejecutó', cancelled: 'Cancelado', queued: 'En cola' } as Record<string, string>)[step.status] ?? step.status}
                                </span>
                                <span className="flex-1" />
                                {step.attempts != null && step.attempts > 1 && (
                                  <span className="text-[10px] text-[var(--text-secondary)]">
                                    {step.attempts} intentos
                                  </span>
                                )}
                                {step.duration_ms != null && (
                                  <span className="text-[10px] text-[var(--text-secondary)]">
                                    {step.duration_ms} ms
                                  </span>
                                )}
                              </div>
                              {step.error && (
                                <details className="mt-1 text-[11px] text-[var(--accent-red,#ef4444)]">
                                  <summary className="cursor-pointer">No se pudo completar este paso. Revisa su configuración. Ver detalle.</summary>
                                  <p className="mt-1">{step.error}</p>
                                </details>
                              )}
                              <StepOutput value={step.output} />
                            </li>
                            );
                          })}
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
