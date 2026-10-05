import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ShieldQuestion, Undo2, X } from 'lucide-react';
import { flowsApi } from '../../api/flowsApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import type { PendingApproval, PendingEffect } from './types';

const POLL_MS = 2000;

function describeCall(approval: PendingApproval): string {
  const name = approval.method;
  const text = JSON.stringify(approval.params);
  return text.length > 160 ? `${name} (${text.slice(0, 160)}…)` : text !== '{}' ? `${name} (${text})` : name;
}

export default function PendingPanel() {
  const { addToast } = useToast();
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [effects, setEffects] = useState<PendingEffect[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, e] = await Promise.all([
        flowsApi.flowsApprovalsList(),
        flowsApi.flowsEffectsPending(),
      ]);
      setApprovals(a.approvals);
      setEffects(e.effects);
    } catch {
      // El panel es auxiliar: un fallo de red no debe llenar de toasts la vista.
    }
  }, []);

  useEffect(() => {
    void load();
    timerRef.current = window.setInterval(() => void load(), POLL_MS);
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current);
    };
  }, [load]);

  const decide = async (approval: PendingApproval, decision: 'approved' | 'denied') => {
    setBusy(approval.id);
    try {
      await flowsApi.flowsApprovalDecide({ run_id: approval.run_id, approval_id: approval.id, decision });
      void load();
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo registrar la decisión'), type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const resolve = async (effect: PendingEffect, resolution: 'retry' | 'done') => {
    setBusy(effect.fingerprint);
    try {
      await flowsApi.flowsEffectResolve({ flow_id: effect.flow_id, fingerprint: effect.fingerprint, resolution });
      void load();
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo resolver el efecto'), type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  if (approvals.length === 0 && effects.length === 0) return null;

  return (
    <section className="mb-4 space-y-2" aria-label="Pendientes de tu decisión">
      {approvals.map((a) => (
        <div key={a.id} className="rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-4 py-3">
          <div className="flex items-start gap-3">
            <ShieldQuestion size={16} className="mt-0.5 shrink-0 text-[#f59e0b]" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {a.flow_name || a.flow_id} pide aprobación
              </p>
              <p className="mt-0.5 break-all font-mono text-[11px] text-[var(--text-secondary)]">
                {describeCall(a)}{a.inside_loop ? ' · dentro de un bucle' : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="primary" size="sm" disabled={busy === a.id}
                onClick={() => void decide(a, 'approved')} aria-label="Aprobar">
                <Check size={13} /> Aprobar
              </Button>
              <Button variant="secondary" size="sm" disabled={busy === a.id}
                onClick={() => void decide(a, 'denied')} aria-label="Denegar">
                <X size={13} /> Denegar
              </Button>
            </div>
          </div>
        </div>
      ))}
      {effects.map((e) => (
        <div key={`${e.flow_id}:${e.fingerprint}`} className="rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-4 py-3">
          <div className="flex items-start gap-3">
            <Undo2 size={16} className="mt-0.5 shrink-0 text-[#f59e0b]" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {e.flow_name || e.flow_id}: efecto sin confirmar
              </p>
              <p className="mt-0.5 break-all font-mono text-[11px] text-[var(--text-secondary)]">
                {e.method}{e.node_id ? ` · ${e.node_id}` : ''}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                La app se cerró sin saber si este paso surtió efecto. Reinténtalo o márcalo como hecho.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="secondary" size="sm" disabled={busy === e.fingerprint}
                onClick={() => void resolve(e, 'retry')} aria-label="Reintentar efecto">
                Reintentar
              </Button>
              <Button variant="ghost" size="sm" disabled={busy === e.fingerprint}
                onClick={() => void resolve(e, 'done')} aria-label="Marcar como hecho">
                Ya se hizo
              </Button>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
