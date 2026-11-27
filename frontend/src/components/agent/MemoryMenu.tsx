import { Fragment, useState } from 'react';
import { createPortal } from 'react-dom';
import { Brain } from 'lucide-react';
import { agentApi, type AgentMemoryItem, type AgentProfile } from '../../api/agentApi';
import { errorMessage } from '../../utils/errors';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';
import { METHOD_LABELS } from './methodLabels';

const KIND_LABELS: Record<AgentMemoryItem['kind'], string> = {
  preference: 'Preferencia',
  fact: 'Hecho',
  journal: 'Diario',
  procedure: 'Procedimiento',
};

function isPendingConfirmation(item: AgentMemoryItem): boolean {
  return item.confidence === 'inferred' && item.status === 'active' && (item.kind === 'fact' || item.kind === 'preference');
}

function sortMemoryItems(items: AgentMemoryItem[]): AgentMemoryItem[] {
  return [...items].sort((a, b) => Number(isPendingConfirmation(b)) - Number(isPendingConfirmation(a)));
}

function sourceText(item: AgentMemoryItem): string {
  if (item.source.kind === 'user') {
    return item.source.reverted_to ? `Restaurado a la versión ${item.source.reverted_to}` : 'Corregido por ti';
  }
  if (item.source.via === 'dreaming') return 'Inferido por la consolidación nocturna';
  if (item.source.via === 'compaction') return 'Inferido al compactar una conversación';
  const receipts = item.source.op_ids?.length ?? 0;
  return receipts ? `Aprendido de ${receipts} comprobante${receipts === 1 ? '' : 's'}` : 'Indicado en una conversación';
}

export default function MemoryMenu({ profiles = [], sessionId, onTrialQueued }: {
  profiles?: AgentProfile[]; sessionId?: string; onTrialQueued?: () => void;
}) {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const [items, setItems] = useState<AgentMemoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string; date?: string } | null>(null);
  const [sharing, setSharing] = useState<{ id: string; profileIds: string[] } | null>(null);
  const [savingShare, setSavingShare] = useState(false);
  const [trial, setTrial] = useState<{ id: string; sample: string } | null>(null);
  const [startingTrial, setStartingTrial] = useState(false);
  const menu = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    align: 'end',
    estimatedWidth: 340,
    estimatedHeight: 360,
    maxHeightCap: 480,
    stopEscapePropagation: true,
  });

  const load = async () => {
    setLoading(true);
    try {
      setItems(sortMemoryItems((await agentApi.agentMemoryList()).items));
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo leer la memoria del agente'), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    if (!menu.isOpen) void load();
    menu.toggle();
  };

  const apply = async (params: Parameters<typeof agentApi.agentMemoryUpdate>[0]) => {
    try {
      const { item } = await agentApi.agentMemoryUpdate(params);
      setItems((prev) => sortMemoryItems(prev.map((i) => (i.id === item.id ? item : i))));
      setEditing(null);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo actualizar el recuerdo'), type: 'error' });
    }
  };

  const remove = async (item: AgentMemoryItem) => {
    const ok = await confirm({
      title: 'Borrar recuerdo',
      description: `Se borrará «${item.title}» con todas sus versiones. El agente dejará de usarlo.`,
      confirmLabel: 'Borrar',
      type: 'destructive',
    });
    if (!ok) return;
    try {
      await agentApi.agentMemoryDelete(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo borrar el recuerdo'), type: 'error' });
    }
  };

  const saveSharing = async (item: AgentMemoryItem, profileIds: string[]) => {
    setSavingShare(true);
    try {
      const result = await agentApi.agentMemoryShare(item.id, item.version, profileIds);
      setItems((prev) => prev.map((entry) => entry.id === item.id ? result.item : entry));
      setSharing(null);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo compartir el recuerdo'), type: 'error' });
    } finally {
      setSavingShare(false);
    }
  };

  const queueTrial = async (item: AgentMemoryItem, sample: string) => {
    if (!sessionId || !sample.trim()) return;
    setStartingTrial(true);
    try {
      await agentApi.agentTasksSave({
        session_id: sessionId, kind: 'queue', procedure_id: item.id, procedure_version: item.version, content: sample.trim(),
      });
      setTrial(null);
      menu.close();
      onTrialQueued?.();
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo iniciar la prueba'), type: 'error' });
    } finally {
      setStartingTrial(false);
    }
  };

  return (
    <>
      <Button
        ref={menu.triggerRef}
        variant="none"
        size="none"
        aria-label="Memoria del agente"
        aria-haspopup="dialog"
        aria-expanded={menu.isOpen}
        title="Memoria del agente"
        onClick={toggle}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
      >
        <Brain size={14} />
      </Button>
      {menu.isOpen && createPortal(
        <div
          ref={menu.popupRef}
          role="dialog"
          aria-label="Memoria del agente"
          className="fixed z-[300] flex flex-col gap-2 rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-3 shadow-[0_16px_40px_rgba(0,0,0,0.22),0_2px_6px_rgba(0,0,0,0.08)]"
          style={{
            top: menu.position?.top ?? -9999,
            left: menu.position?.left ?? -9999,
            width: 340,
            maxHeight: menu.position?.maxHeight ?? 480,
            visibility: menu.position ? 'visible' : 'hidden',
          }}
        >
          <p className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Memoria del agente</p>
          <p className="shrink-0 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            La memoria es local. Cada perfil conserva sus propios recuerdos; los recuerdos globales anteriores siguen disponibles.
            {' '}Tu pedido actual tiene prioridad; después, las indicaciones del agente y, por último, las preferencias de memoria.
          </p>
          <ul className="custom-scrollbar min-h-0 space-y-2 overflow-y-auto">
            {items.map((item, index) => {
              const pending = isPendingConfirmation(item);
              const previousPending = index > 0 && isPendingConfirmation(items[index - 1]);
              const text = item.kind === 'procedure' ? item.when ?? '' : item.content ?? '';
              const older = item.versions.filter((v) => v.version < item.version);
              const previous = older[older.length - 1];
              const targets = profiles.filter((profile) =>
                profile.id !== item.profile_id && (!profile.memory_scope || profile.memory_scope === 'shared-read'));
              const shared = item.shared_with_profiles ?? [];
              const canShare = !!item.profile_id && (item.kind === 'preference' || item.kind === 'fact') &&
                (shared.length > 0 || (item.status === 'active' && !pending && targets.length > 0));
              return (
                <Fragment key={item.id}>
                {index === 0 && pending && (
                  <li key="pending-heading" className="px-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-[var(--accent-yellow)]">
                    Pendientes de confirmar
                  </li>
                )}
                {index > 0 && !pending && previousPending && (
                  <li key="rest-heading" className="px-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                    Confirmados y diario
                  </li>
                )}
                <li key={item.id} className="space-y-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-2 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[var(--text-muted)]">{KIND_LABELS[item.kind]}</span>
                    {!!item.essential && <span className="rounded bg-[var(--bg-input)] px-1 text-[9px] uppercase tracking-wide text-[var(--text-secondary)]" title="Se inyecta en cada conversación aunque no mencione el tema">Fijado</span>}
                    <span className="min-w-0 flex-1 truncate font-medium text-[var(--text-primary)]">{item.title}</span>
                    <span className="tabular-nums text-[var(--text-muted)]">v{item.version}</span>
                  </div>
                  {item.status !== 'active' && (
                    <p className="text-[var(--accent-yellow)]">
                      {item.status === 'disabled' ? 'Desactivado' : item.status === 'superseded' ? `Reemplazado: ${item.reason ?? 'hay una versión más reciente'}` : `Suspendido: ${item.reason ?? 'revísalo antes de reutilizarlo'}`}
                    </p>
                  )}
                  {item.kind === 'journal' && item.date && (
                    <p className="tabular-nums text-[10px] text-[var(--text-muted)]">{item.date}</p>
                  )}
                  {editing?.id === item.id ? (
                    <>
                      <Textarea
                        aria-label={`Corregir ${item.title}`}
                        className="w-full text-[11px]"
                        rows={3}
                        value={editing.text}
                        onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                      />
                      {item.kind === 'journal' && (
                        <Input
                          type="date"
                          className="w-full"
                          aria-label={`Fecha de ${item.title}`}
                          value={editing.date ?? ''}
                          onChange={(e) => setEditing({ ...editing, date: e.target.value })}
                        />
                      )}
                    </>
                  ) : (
                    <p className="whitespace-pre-wrap text-[var(--text-secondary)]">{text}</p>
                  )}
                  {item.kind === 'procedure' && (
                    <ol className="list-decimal space-y-0.5 pl-4 text-[var(--text-secondary)]">
                      {(item.steps ?? []).map((step, index) => (
                        <li key={`${step.tool}-${index}`}>{METHOD_LABELS[step.tool] ?? step.tool}: {step.purpose}</li>
                      ))}
                    </ol>
                  )}
                  {pending && <p className="text-[10px] text-[var(--accent-yellow)]">Inferido: confírmalo, corrígelo o descártalo.</p>}
                  <p className="text-[10px] text-[var(--text-muted)]">{sourceText(item)}</p>
                  {shared.length > 0 && <p className="text-[10px] text-[var(--text-secondary)]">
                    Compartido con {shared.map((id) => profiles.find((profile) => profile.id === id)?.name ?? 'perfil no disponible').join(', ')}
                  </p>}
                  {sharing?.id === item.id && (
                    <fieldset className="space-y-1" disabled={savingShare}>
                      <legend className="text-[var(--text-secondary)]">Perfiles que podrán usar este recuerdo</legend>
                      {targets.map((profile) => (
                        <label key={profile.id} className="flex items-center gap-2">
                          <input type="checkbox" checked={sharing.profileIds.includes(profile.id)}
                            onChange={(event) => setSharing({ id: item.id, profileIds: event.target.checked
                              ? [...sharing.profileIds, profile.id] : sharing.profileIds.filter((id) => id !== profile.id) })} />
                          {profile.name}
                        </label>
                      ))}
                      <Button size="sm" variant="secondary" onClick={() => void saveSharing(item, sharing.profileIds)}>Guardar acceso</Button>
                      <Button size="sm" variant="ghost" onClick={() => setSharing(null)}>Cancelar</Button>
                    </fieldset>
                  )}
                  {trial?.id === item.id && (
                    <div className="space-y-1">
                      <Textarea aria-label="Caso de prueba" rows={2} value={trial.sample} maxLength={4000}
                        placeholder="Ejemplo con el que quieres probar el procedimiento"
                        onChange={(event) => setTrial({ id: item.id, sample: event.target.value })} />
                      <Button size="sm" variant="secondary" disabled={startingTrial || !trial.sample.trim()}
                        onClick={() => void queueTrial(item, trial.sample)}>Probar con lecturas</Button>
                      <Button size="sm" variant="ghost" disabled={startingTrial} onClick={() => setTrial(null)}>Cancelar</Button>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {editing?.id === item.id ? (
                      <>
                        <Button size="sm" variant="secondary" disabled={!editing.text.trim()}
                          onClick={() => void apply({
                            id: item.id,
                            action: 'edit',
                            ...(item.kind === 'procedure' ? { when: editing.text } : { content: editing.text }),
                            ...(item.kind === 'journal' && editing.date ? { date: editing.date } : {}),
                          })}>
                          Guardar corrección
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
                      </>
                    ) : (
                      <>
                        {pending && (
                          <>
                            <Button size="sm" variant="secondary" onClick={() => void apply({ id: item.id, action: 'confirm' })}>Confirmar</Button>
                            <Button size="sm" variant="ghost" onClick={() => void apply({ id: item.id, action: 'discard' })}>Descartar</Button>
                          </>
                        )}
                        {canShare && sharing?.id !== item.id && (
                          <Button size="sm" variant="ghost" onClick={() => setSharing({
                            id: item.id, profileIds: targets.filter((profile) => shared.includes(profile.id)).map((profile) => profile.id),
                          })}>Compartir</Button>
                        )}
                        {sessionId && item.kind === 'procedure' && item.status === 'active' && trial?.id !== item.id && (
                          <Button size="sm" variant="ghost" onClick={() => setTrial({ id: item.id, sample: '' })}>
                            Probar procedimiento
                          </Button>
                        )}
                        {(item.kind === 'fact' || item.kind === 'preference') && (
                          <Button size="sm" variant="ghost" aria-pressed={!!item.essential}
                            onClick={() => void apply({ id: item.id, action: item.essential ? 'unpin' : 'pin' })}>
                            {item.essential ? 'Desfijar' : 'Fijar'}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ id: item.id, text, ...(item.kind === 'journal' ? { date: item.date } : {}) })}>Corregir</Button>
                        <Button size="sm" variant="ghost" onClick={() => void apply({ id: item.id, action: item.status === 'active' ? 'disable' : 'enable' })}>
                          {item.status === 'active' ? 'Desactivar' : 'Activar'}
                        </Button>
                        {previous && (
                          <Button size="sm" variant="ghost" onClick={() => void apply({ id: item.id, action: 'revert', version: previous.version })}>
                            Volver a v{previous.version}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => void remove(item)}>Borrar</Button>
                      </>
                    )}
                  </div>
                </li>
                </Fragment>
              );
            })}
          </ul>
          {items.length === 0 && (
            <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
              {loading
                ? 'Cargando memoria…'
                : 'El agente aún no ha guardado preferencias, hechos, procedimientos ni entradas del diario.'}
            </p>
          )}
          <p className="shrink-0 text-[10px] leading-relaxed text-[var(--text-muted)]">
            Los recuerdos orientan al agente; no conceden permisos y cada acción sigue el modo de permisos de la conversación.
          </p>
        </div>,
        document.body,
      )}
    </>
  );
}
