import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { agentApi, type AgentProfile, type AgentToolSpec } from '../../api/agentApi';
import { errorMessage } from '../../utils/errors';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';
import Toggle from '../ui/Toggle';
import AgentAvatar from './AgentAvatar';
import { METHOD_LABELS } from './methodLabels';

const FIELD = 'grid grid-cols-[96px_1fr] items-start gap-3 px-3 py-2.5';
const LABEL = 'pt-1.5 text-[13px] text-[var(--text-secondary)]';

export default function AgentEditor({ profile, onClose, onSaved, onDeleted }: {
  profile: AgentProfile | null;
  onClose: () => void;
  onSaved: (profile: AgentProfile) => void;
  onDeleted: (id: string) => void;
}) {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const [name, setName] = useState(profile?.name ?? '');
  const [description, setDescription] = useState(profile?.description ?? '');
  const [instructions, setInstructions] = useState(profile?.instructions ?? '');
  const [starter, setStarter] = useState(profile?.starter ?? '');
  const [allTools, setAllTools] = useState(profile ? profile.tools === null : true);
  const [selected, setSelected] = useState<Set<string>>(new Set(profile?.tools ?? []));
  const [tools, setTools] = useState<AgentToolSpec[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    agentApi.agentToolsList().then((res) => { if (!cancelled) setTools(res.tools); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const groups = useMemo(() => [
    { label: 'Lectura directa', items: tools.filter((t) => !t.gated && t.kind !== 'mcp') },
    { label: 'Con aprobación', items: tools.filter((t) => t.gated && t.kind !== 'mcp') },
    { label: 'MCP', items: tools.filter((t) => t.kind === 'mcp') },
  ].filter((group) => group.items.length > 0), [tools]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await agentApi.agentProfileSave({
        ...(profile ? { id: profile.id } : {}),
        name, description, instructions, starter,
        tools: allTools ? null : [...selected],
      });
      addToast({ message: profile ? 'Agente actualizado' : 'Agente creado', type: 'success' });
      onSaved(res.profile);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo guardar el agente'), type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!profile) return;
    const ok = await confirm({
      title: 'Borrar agente',
      description: `Se borrará «${profile.name}». Sus conversaciones se conservan.`,
      confirmLabel: 'Borrar',
      type: 'destructive',
    });
    if (!ok) return;
    try {
      await agentApi.agentProfileDelete(profile.id);
      onDeleted(profile.id);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo borrar el agente'), type: 'error' });
    }
  };

  return (
    <aside
      role="dialog"
      aria-label={profile ? `Editar agente ${profile.name}` : 'Crear agente'}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      className="absolute inset-y-3 right-3 z-20 flex w-[min(340px,calc(100%-24px))] flex-col rounded-[24px] bg-[var(--bg-surface)] shadow-[0_16px_40px_rgba(0,0,0,0.18),0_0_1px_rgba(0,0,0,0.32)] xl:static xl:order-last xl:w-[300px] xl:shrink-0 xl:shadow-none"
    >
      <header className="relative flex shrink-0 items-center justify-center px-4 pt-4">
        <h2 className="text-[14px] font-medium text-[var(--text-primary)]">{profile ? name || profile.name : 'Nuevo agente'}</h2>
        <button
          type="button"
          className="absolute right-3 top-3 flex size-6 items-center justify-center rounded-full bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          aria-label="Cerrar editor de agente"
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </header>
      <div className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3 pt-4">
        <div className="flex flex-col items-center gap-3 py-5">
          <AgentAvatar seed={profile?.id ?? (name || 'nuevo-agente')} name={name || 'Agente'} size={112} />
        </div>
        <div className="divide-y divide-[var(--border-subtle)] rounded-2xl bg-[var(--bg-base)]">
          <label className={FIELD}>
            <span className={LABEL}>Nombre</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Nombre del agente"
              placeholder="Informe mensual de cortes" className="w-full" />
          </label>
          <label className={FIELD}>
            <span className={LABEL}>Descripción</span>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200}
              aria-label="Descripción del agente" placeholder="Para qué sirve" className="w-full" />
          </label>
          <label className={FIELD}>
            <span className={LABEL}>Indicaciones</span>
            <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={4000} rows={6}
              aria-label="Indicaciones del agente" className="w-full text-[13px]"
              placeholder="Pasos, plantilla, formato y datos que debe pedir cada vez" />
          </label>
          <label className={FIELD}>
            <span className={LABEL}>Mensaje inicial</span>
            <Input value={starter} onChange={(e) => setStarter(e.target.value)} maxLength={500}
              aria-label="Mensaje inicial del agente" placeholder="Opcional: se escribe al abrir el agente" className="w-full" />
          </label>
        </div>
        <div className="rounded-2xl bg-[var(--bg-base)] px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-[var(--text-primary)]">Todas las herramientas</span>
            <Toggle checked={allTools} onChange={setAllTools} aria-label="Usar todas las herramientas" />
          </div>
          {!allTools && (
            <div className="mt-2 space-y-2">
              {groups.map((group) => (
                <div key={group.label}>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{group.label}</p>
                  <ul className="mt-1 max-h-40 space-y-1 overflow-auto">
                    {group.items.map((tool) => (
                      <li key={tool.name} className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]" title={tool.name}>
                        <span className="min-w-0 flex-1 truncate">{METHOD_LABELS[tool.name] ?? tool.name}</span>
                        <Toggle
                          checked={selected.has(tool.name)}
                          aria-label={`Permitir ${tool.name}`}
                          onChange={(on) => setSelected((prev) => {
                            const next = new Set(prev);
                            if (on) next.add(tool.name); else next.delete(tool.name);
                            return next;
                          })}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="px-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
          El agente no se ejecuta solo: lo abres cuando lo necesitas y cada acción que modifica datos te pide aprobación.
        </p>
      </div>
      <footer className="flex shrink-0 items-center gap-2 border-t border-[var(--border-subtle)] p-3">
        {profile && <Button variant="ghost" size="sm" onClick={() => void remove()}>Borrar</Button>}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
        <Button size="sm" disabled={saving || !name.trim() || !instructions.trim()} onClick={() => void save()}>
          {profile ? 'Guardar' : 'Crear agente'}
        </Button>
      </footer>
    </aside>
  );
}
