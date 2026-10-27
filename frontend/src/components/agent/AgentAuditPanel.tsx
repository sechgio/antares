import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import {
  agentApi, type AgentApproval, type AgentApprovalFilterStatus, type AgentGrant, type AgentSession,
} from '../../api/agentApi';
import { formatMoment } from '../../utils/dates';
import { errorMessage } from '../../utils/errors';
import { useDialog } from '../../hooks/useDialog';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { SegmentedControl } from '../ui/SegmentedControl';
import ThemedSelect from '../ui/ThemedSelect';
import { METHOD_LABELS } from './methodLabels';

const STATUS_LABELS: Record<AgentApproval['status'], string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  denied: 'Rechazada',
  expired: 'Expirada',
};

const STATUS_OPTIONS: { value: AgentApprovalFilterStatus; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'approved', label: 'Aprobadas' },
  { value: 'denied', label: 'Rechazadas' },
  { value: 'expired', label: 'Expiradas' },
  { value: 'uncertain', label: 'Inciertas' },
  { value: 'pending', label: 'Pendientes' },
];

function methodLabel(method: string): string {
  return METHOD_LABELS[method] || method;
}

function csvCell(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function download(name: string, content: string, mime: string) {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function AgentAuditPanel({ sessions, sessionId, onClose }: {
  sessions: AgentSession[];
  sessionId?: string;
  onClose: () => void;
}) {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState<AgentApproval[]>([]);
  const [grants, setGrants] = useState<AgentGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState(sessionId || '');
  const [statusFilter, setStatusFilter] = useState<AgentApprovalFilterStatus>('all');
  const [methodFilter, setMethodFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useFocusTrap(dialogRef, true);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      setHistory((await agentApi.agentApprovalsHistory({ limit: 500 })).approvals);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo leer el historial de aprobaciones'), type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    let alive = true;
    if (!sessionFilter) {
      setGrants([]);
      return () => { alive = false; };
    }
    setGrantsLoading(true);
    void agentApi.agentGrantsList(sessionFilter)
      .then((result) => { if (alive) setGrants(result.grants); })
      .catch((err) => {
        if (alive) addToast({ message: errorMessage(err, 'No se pudieron leer los accesos concedidos'), type: 'error' });
      })
      .finally(() => { if (alive) setGrantsLoading(false); });
    return () => { alive = false; };
  }, [sessionFilter, addToast]);

  const sessionOptions = useMemo(() => [
    { value: '', label: 'Todas las conversaciones' },
    ...sessions.map((session) => ({ value: session.id, label: session.title || 'Conversación' })),
  ], [sessions]);

  const visible = useMemo(() => {
    const method = methodFilter.trim().toLowerCase();
    return history.filter((approval) => {
      if (sessionFilter && approval.session_id !== sessionFilter) return false;
      if (method && !approval.method.toLowerCase().includes(method)
        && !methodLabel(approval.method).toLowerCase().includes(method)) return false;
      if (statusFilter === 'uncertain') return approval.dispatch?.status === 'uncertain';
      return statusFilter === 'all' || approval.status === statusFilter;
    });
  }, [history, sessionFilter, statusFilter, methodFilter]);

  const selectedSession = sessions.find((session) => session.id === sessionFilter);

  const exportJson = () => {
    download(`aprobaciones-${Date.now()}.json`, JSON.stringify(visible, null, 2), 'application/json');
  };

  const exportCsv = () => {
    const header = ['ID', 'Llamada', 'Creada', 'Conversación', 'Herramienta', 'Estado', 'Ejecución', 'Decidida', 'Recursos', 'Parámetros'];
    const rows = visible.map((approval) => [
      approval.id,
      approval.call_id,
      formatMoment(approval.created_at),
      sessions.find((session) => session.id === approval.session_id)?.title || approval.session_id,
      methodLabel(approval.method),
      STATUS_LABELS[approval.status],
      approval.dispatch?.status || '',
      formatMoment(approval.decided_at),
      (approval.resources || []).map((resource) => resource.path).join(' | '),
      approval.params,
    ].map(csvCell).join(','));
    download(`aprobaciones-${Date.now()}.csv`, [header.map(csvCell).join(','), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
  };

  const revoke = async (grant?: AgentGrant) => {
    if (!sessionFilter) return;
    const ok = await confirm({
      title: grant ? 'Revocar acceso' : 'Revocar todos los accesos',
      description: grant
        ? `El agente dejará de poder leer ${grant.path} en esta conversación.`
        : `El agente perderá todos los accesos a archivos concedidos en «${selectedSession?.title || sessionFilter}».`,
      confirmLabel: 'Revocar',
      type: 'destructive',
    });
    if (!ok) return;
    setRevoking(grant?.path || '*');
    try {
      const { revoked } = await agentApi.agentGrantsRevoke(sessionFilter, grant?.path);
      setGrants((current) => grant ? current.filter((item) => item.path !== grant.path) : []);
      addToast({ message: `${revoked} acceso${revoked === 1 ? '' : 's'} revocado${revoked === 1 ? '' : 's'}`, type: 'success' });
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo revocar el acceso'), type: 'error' });
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div
      data-testid="agent-audit-overlay"
      className="fixed inset-0 z-[300] flex items-center justify-center bg-[color-mix(in_srgb,var(--bg-base)_88%,transparent)] p-4 backdrop-blur-sm"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Historial de aprobaciones"
        className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-base)] shadow-[0_24px_80px_rgba(0,0,0,0.28)]"
      >
        <header className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="flex size-9 items-center justify-center rounded-lg border border-[var(--accent-primary)] text-[var(--accent-primary)]">
            <ShieldCheck size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Historial de aprobaciones</h2>
            <p className="text-[12px] text-[var(--text-secondary)]">
              Decisiones y ejecuciones registradas. Los parámetros se conservan para auditoría.
            </p>
          </div>
          <Button variant="ghost" size="none" className="flex size-7 items-center justify-center" aria-label="Cerrar historial" onClick={onClose}>
            <X size={15} />
          </Button>
        </header>

        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-5 py-3">
          <div className="w-56"><ThemedSelect aria-label="Filtrar por conversación" value={sessionFilter}
            onChange={setSessionFilter} options={sessionOptions} /></div>
          <div className="w-52"><Input aria-label="Filtrar por herramienta" placeholder="Filtrar por herramienta"
            value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)} /></div>
          <div className="min-w-64 flex-1"><SegmentedControl aria-label="Filtrar por estado" value={statusFilter}
            onChange={setStatusFilter} options={STATUS_OPTIONS} /></div>
          <Button variant="ghost" size="sm" onClick={() => void loadHistory()} disabled={loading} aria-label="Actualizar historial">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Actualizar
          </Button>
        </div>

        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <p className="py-8 text-center text-[13px] text-[var(--text-secondary)]">Cargando historial…</p>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-[var(--text-secondary)]">No hay aprobaciones con estos filtros.</p>
          ) : (
            <ul className="space-y-2" aria-label="Aprobaciones registradas">
              {visible.map((approval) => {
                const uncertain = approval.dispatch?.status === 'uncertain';
                const title = methodLabel(approval.method);
                return (
                  <li key={approval.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        uncertain || approval.status === 'expired' || approval.status === 'denied'
                          ? 'bg-[color-mix(in_srgb,var(--accent-red)_10%,transparent)] text-[var(--accent-red)]'
                          : approval.status === 'approved'
                            ? 'bg-[color-mix(in_srgb,var(--accent-primary)_10%,transparent)] text-[var(--accent-primary)]'
                            : 'bg-[var(--bg-input)] text-[var(--text-secondary)]'
                      }`}>
                        {uncertain ? 'Incierta' : STATUS_LABELS[approval.status]}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text-primary)]">{title}</span>
                      <span className="max-w-48 truncate text-[11px] text-[var(--text-muted)]">
                        {sessions.find((session) => session.id === approval.session_id)?.title || approval.session_id}
                      </span>
                      <span className="text-[11px] text-[var(--text-muted)]">{formatMoment(approval.created_at)}</span>
                      <Button variant="ghost" size="sm" aria-label={`Ver detalle de ${title}`}
                        onClick={() => setExpanded((current) => current === approval.id ? null : approval.id)}>
                        {expanded === approval.id ? 'Ocultar' : 'Detalle'}
                      </Button>
                    </div>
                    {expanded === approval.id && (
                      <div className="space-y-2 border-t border-[var(--border-subtle)] px-3 py-3 text-[12px] text-[var(--text-secondary)]">
                        <p><span className="text-[var(--text-muted)]">Decidida:</span> {formatMoment(approval.decided_at)}</p>
                        <p><span className="text-[var(--text-muted)]">Ejecución:</span> {approval.dispatch?.status || 'Sin registro'}</p>
                        {approval.consumed_by && <p className="break-all"><span className="text-[var(--text-muted)]">Consumida por:</span> {approval.consumed_by}</p>}
                        {!!approval.resources?.length && (
                          <div>
                            <p className="text-[var(--text-muted)]">Recursos</p>
                            <ul className="mt-1 space-y-0.5">{approval.resources.map((resource) => (
                              <li key={resource.path} className="break-all">{resource.path}
                                {resource.sha256 && <span className="block text-[10px] text-[var(--text-muted)]">{resource.sha256}</span>}
                              </li>
                            ))}</ul>
                          </div>
                        )}
                        {approval.context && Object.keys(approval.context).length > 0 && (
                          <div><p className="text-[var(--text-muted)]">Contexto</p>
                            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--bg-base)] p-2">{JSON.stringify(approval.context, null, 2)}</pre></div>
                        )}
                        <div><p className="text-[var(--text-muted)]">Parámetros</p>
                          <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--bg-base)] p-2">{JSON.stringify(approval.params, null, 2)}</pre></div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {sessionFilter && (
            <section className="mt-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3" aria-label="Accesos concedidos">
              <div className="flex items-center gap-2">
                <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--text-primary)]">
                  Accesos a archivos de {selectedSession?.title || 'esta conversación'}
                </h3>
                {grants.length > 0 && (
                  <Button variant="danger" size="sm" onClick={() => void revoke()} disabled={revoking !== null}>Revocar todos los accesos</Button>
                )}
              </div>
              {grantsLoading ? <p className="mt-2 text-[12px] text-[var(--text-secondary)]">Cargando accesos…</p>
                : grants.length === 0 ? <p className="mt-2 text-[12px] text-[var(--text-secondary)]">No hay accesos concedidos.</p>
                  : (
                    <ul className="mt-2 space-y-1">
                      {grants.map((grant) => (
                        <li key={grant.path} className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 break-all text-[12px] text-[var(--text-secondary)]">{grant.path}</span>
                          <Button variant="ghost" size="sm" aria-label={`Revocar acceso a ${grant.path}`}
                            disabled={revoking !== null} onClick={() => void revoke(grant)}>
                            <Trash2 size={12} /> Revocar
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
            </section>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-3">
          <Button variant="secondary" size="sm" onClick={exportJson} disabled={!visible.length}>
            <Download size={13} /> Exportar JSON
          </Button>
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!visible.length}>
            <Download size={13} /> Exportar CSV
          </Button>
        </footer>
      </div>
    </div>
  );
}
