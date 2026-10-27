import { useState } from 'react';
import { Loader2, ShieldCheck, Undo2 } from 'lucide-react';
import type { AgentToolCall } from '../../api/agentApi';
import Button from '../ui/Button';
import { channelLabel } from './channels';
import { METHOD_LABELS } from './methodLabels';

function receiptState(call: AgentToolCall): string {
  if (call.recovered) return 'Recuperado';
  const deniedText = call.status === 'denied' ? call.result ?? '' : '';
  if (/bloqueó el canal/i.test(deniedText)) return 'Bloqueado por regla';
  if (/rechazó esta acción/i.test(deniedText)) return 'Rechazado por ti';
  if (call.status === 'denied') return 'Rechazado';
  if (call.status === 'failed') return 'Falló';
  if (call.status === 'interrupted') return 'Interrumpido';
  if (call.status === 'submitted') return 'Enviado';
  if (call.status === 'running' || call.status === 'queued') return 'En curso';
  if (call.approval_source === 'rule') return 'Permitido por regla';
  if (call.approval_source === 'web') return 'Permitido por regla web';
  if (call.approval_source === 'full') return 'Permitido por acceso completo';
  if (call.approval_source === 'manual') return 'Permitido por ti';
  if (call.approval_source === 'cancel') return 'Cancelado';
  return 'Ejecutado';
}

export default function BrokerReceipt({ call, onUndo }: {
  call: AgentToolCall;
  onUndo?: (callId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  if (call.status === 'pending' || call.status === 'running' || call.status === 'queued') return null;
  if (!call.gated && !call.approval_source && !call.undo) return null;
  const channel = channelLabel(call.channel);
  const undone = !!call.undo?.undone_at;
  const canUndo = call.status === 'done' && call.undo?.available === true && !undone && !!onUndo;
  const undo = async () => {
    if (!onUndo || busy) return;
    setBusy(true);
    try {
      await onUndo(call.dispatch_id || call.id);
    } catch {
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="group" aria-label="Recibo de la acción"
      className="ml-[6.5px] border-l border-[var(--border-subtle)] pb-1 pl-[15px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-[var(--text-muted)]">
        <ShieldCheck size={11} className="shrink-0" aria-hidden="true" />
        {channel && <span>{channel}</span>}
        <span aria-hidden="true">·</span>
        <span>{receiptState(call)}</span>
        {undone && <span className="text-[var(--accent-green)]">· Deshecho</span>}
        {canUndo && (
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" disabled={busy}
            aria-label={`Deshacer ${METHOD_LABELS[call.name] ?? call.name}`} onClick={() => void undo()}>
            {busy ? <Loader2 size={11} className="animate-spin" aria-hidden="true" /> : <Undo2 size={11} aria-hidden="true" />}
            Deshacer
          </Button>
        )}
        {call.status === 'done' && !undone && !call.undo?.available && (
          <span title={call.undo?.reason || undefined}>· No reversible</span>
        )}
      </div>
    </div>
  );
}
