import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { agentApi, type AgentMemoryScope, type AgentProfile, type AgentRole, type AgentToolSpec } from '../../api/agentApi';
import { errorMessage } from '../../utils/errors';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { SegmentedControl } from '../ui/SegmentedControl';
import Textarea from '../ui/Textarea';
import Toggle from '../ui/Toggle';
import AgentAvatar, { AGENT_AVATAR_COLORS } from './AgentAvatar';
import { METHOD_LABELS } from './methodLabels';

const FIELD = 'grid grid-cols-[96px_1fr] items-start gap-3 px-3 py-2.5';
const LABEL = 'pt-1.5 text-[13px] text-[var(--text-secondary)]';

const ROLE_HINT: Record<AgentRole, string> = {
  explorer: 'Solo lee datos; investiga y reúne evidencia.',
  reviewer: 'Solo lee datos; revisa, contrasta y emite un veredicto.',
  worker: 'Puede ejecutar efectos; cada acción pedirá tu aprobación en la conversación que delega.',
};

const MEMORY_HINT: Record<AgentMemoryScope, string> = {
  'shared-read': 'Lee la memoria general y la suya; lo que aprende queda solo para este agente.',
  own: 'Solo lee y guarda su propia memoria; no ve la memoria general.',
  none: 'No recibe recuerdos ni puede guardarlos.',
};

export default function AgentEditor({ profile, canStartChat = true, onClose, onSaved, onDeleted }: {
  profile: AgentProfile | null;
  canStartChat?: boolean;
  onClose: () => void;
  onSaved: (profile: AgentProfile) => void;
  onDeleted: (id: string) => void;
}) {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const [name, setName] = useState(profile?.name ?? '');
  const [color, setColor] = useState(profile?.color ?? '');
  const [description, setDescription] = useState(profile?.description ?? '');
  const [role, setRole] = useState<AgentRole>(profile?.role ?? 'explorer');
  const [memoryScope, setMemoryScope] = useState<AgentMemoryScope>(profile?.memory_scope ?? 'shared-read');
  const [instructions, setInstructions] = useState(profile?.instructions ?? '');
  const [starter, setStarter] = useState(profile?.starter ?? '');
  const [allTools, setAllTools] = useState(profile ? profile.tools === null : true);
  const [selected, setSelected] = useState<Set<string>>(new Set(profile?.tools ?? []));
  const [denied, setDenied] = useState<Set<string>>(new Set(profile?.tools_deny ?? []));
  const [tools, setTools] = useState<AgentToolSpec[]>([]);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

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
    if (savingRef.current || !name.trim() || !instructions.trim()) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const res = await agentApi.agentProfileSave({
        ...(profile ? { id: profile.id } : {}),
        name, color, description, role, memory_scope: memoryScope, instructions, starter,
        tools: allTools ? null : [...selected],
        tools_deny: allTools ? [...denied] : [],
      });
      addToast({ message: profile ? 'Agente actualizado. Los cambios se aplicarán a conversaciones nuevas.' : 'Agente creado', type: 'success' });
      onSaved(res.profile);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo guardar el agente'), type: 'error' });
    } finally {
      savingRef.current = false;
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
    <form
      role="dialog"
      aria-label={profile ? `Editar agente ${profile.name}` : 'Crear agente'}
      aria-busy={saving}
      onSubmit={(e) => { e.preventDefault(); void save(); }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !savingRef.current) {
          e.stopPropagation();
          onClose();
        }
      }}
      className="absolute inset-0 z-20 m-auto flex h-fit max-h-[calc(100%-32px)] w-[min(480px,calc(100%-32px))] flex-col rounded-[24px] bg-[var(--bg-surface)] shadow-[0_16px_40px_rgba(0,0,0,0.18),0_0_1px_rgba(0,0,0,0.32)]"
    >
      <header className="relative shrink-0 px-6 pb-2 pt-6">
        <h2 className="pr-6 text-[18px] font-semibold text-[var(--text-primary)]">{profile ? 'Editar agente' : 'Conoce a tu agente'}</h2>
        <p className="mt-1.5 text-[13px] leading-5 text-[var(--text-secondary)]">
          Dale un nombre y cuéntale cómo quieres que trabaje. Podrás cambiarlo después.
        </p>
        <button
          type="button"
          className="absolute right-3 top-3 flex size-6 items-center justify-center rounded-full bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          aria-label="Cerrar editor de agente"
          disabled={saving}
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </header>
      <fieldset disabled={saving} className="custom-scrollbar min-h-0 min-w-0 space-y-4 overflow-y-auto px-6 pb-2 pt-4">
        <div className="flex items-center gap-4">
          <AgentAvatar seed={profile?.id ?? (name || 'nuevo-agente')} color={color} name={name || 'Agente'} size={64} className="shrink-0" />
          <label className="min-w-0 flex-1 space-y-2">
            <span className="block text-xs font-medium text-[var(--text-secondary)]">Nombre del agente</span>
            <Input autoFocus required value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Nombre del agente"
              placeholder="Por ejemplo, Revisor de informes" className="w-full" />
          </label>
        </div>
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-[var(--text-secondary)]">Color</legend>
          <div className="grid max-w-[280px] grid-cols-7 gap-1">
            {[{ from: '', name: 'Automático' }, ...AGENT_AVATAR_COLORS].map((item) => (
              <label key={item.from} title={item.name} className="flex min-h-9 cursor-pointer items-center justify-center">
                <input type="radio" name="agent-color" aria-label={`Color ${item.name}`} value={item.from}
                  checked={color === item.from} onChange={() => setColor(item.from)} className="peer sr-only" />
                <span style={{ backgroundColor: item.from || 'var(--bg-input)' }}
                  className="flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-[var(--bg-surface)] peer-checked:ring-2 peer-checked:ring-[var(--text-primary)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-[var(--accent-primary)]">
                  {color === item.from && <Check size={14} aria-hidden="true" className={item.from ? 'text-white' : 'text-[var(--text-primary)]'} />}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block space-y-2">
          <span className="block text-xs font-medium text-[var(--text-secondary)]">Una instrucción permanente</span>
          <Textarea required value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={4000} rows={2}
            aria-label="Indicaciones del agente" className="w-full text-[13px]"
            placeholder="Responde de forma breve y muestra tu trabajo." />
        </label>
        <details open={Boolean(profile)} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg py-1 text-[13px] text-[var(--text-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)]">
            Opciones avanzadas <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3 divide-y divide-[var(--border-subtle)] rounded-2xl bg-[var(--bg-base)]">
          <label className={FIELD}>
            <span className={LABEL}>Descripción</span>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200}
              aria-label="Descripción del agente" placeholder="Para qué sirve" className="w-full" />
          </label>
          <div className={FIELD}>
            <span className={LABEL}>Rol</span>
            <div className="space-y-1.5">
              <SegmentedControl<AgentRole>
                aria-label="Rol del agente"
                value={role}
                onChange={setRole}
                options={[
                  { value: 'explorer', label: 'Explorador' },
                  { value: 'reviewer', label: 'Revisor' },
                  { value: 'worker', label: 'Worker' },
                ]}
              />
              <span className={`block text-[11px] leading-relaxed ${role === 'worker' ? 'text-[var(--accent-yellow)]' : 'text-[var(--text-muted)]'}`}>
                {ROLE_HINT[role]}
              </span>
            </div>
          </div>
          <div className={FIELD}>
            <span className={LABEL}>Memoria</span>
            <div className="space-y-1.5">
              <SegmentedControl<AgentMemoryScope>
                aria-label="Memoria del agente"
                value={memoryScope}
                onChange={setMemoryScope}
                options={[
                  { value: 'shared-read', label: 'Compartida' },
                  { value: 'own', label: 'Propia' },
                  { value: 'none', label: 'Ninguna' },
                ]}
              />
              <span className="block text-[11px] leading-relaxed text-[var(--text-muted)]">{MEMORY_HINT[memoryScope]}</span>
            </div>
          </div>
          <label className={FIELD}>
            <span className={LABEL}>Mensaje inicial</span>
            <Input value={starter} onChange={(e) => setStarter(e.target.value)} maxLength={500}
              aria-label="Mensaje inicial del agente" placeholder="Opcional: se escribe al abrir el agente" className="w-full" />
          </label>
        </div>
        <div className="mt-3 rounded-2xl bg-[var(--bg-base)] px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-[var(--text-primary)]">Todas las herramientas</span>
            <Toggle checked={allTools} onChange={setAllTools} aria-label="Usar todas las herramientas" />
          </div>
          {allTools && (
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
              Bloquea las que el agente nunca debe usar, también las que se añadan después.
            </p>
          )}
          <div className="mt-2 space-y-2">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{group.label}</p>
                <ul className="mt-1 max-h-40 space-y-1 overflow-auto">
                  {group.items.map((tool) => (
                    <li key={tool.name} className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]" title={tool.name}>
                      <span className="min-w-0 flex-1 truncate">{METHOD_LABELS[tool.name] ?? tool.name}</span>
                      <Toggle
                        checked={allTools ? denied.has(tool.name) : selected.has(tool.name)}
                        aria-label={`${allTools ? 'Bloquear' : 'Permitir'} ${tool.name}`}
                        onChange={(on) => (allTools ? setDenied : setSelected)((prev) => {
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
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
          Tu pedido actual tiene prioridad sobre estas indicaciones; estas prevalecen sobre las preferencias de memoria.
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
          Estas indicaciones se copian al crear una conversación. Las conversaciones existentes conservan las indicaciones con las que se crearon.
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
          El agente no se ejecuta solo: lo abres cuando lo necesitas y sus acciones siguen el modo de permisos de la conversación.
        </p>
        </details>
      </fieldset>
      <footer className="flex shrink-0 flex-wrap items-center gap-2 px-6 pb-6 pt-4">
        <Button type="submit" className="h-11 w-full rounded-xl" disabled={saving || !name.trim() || !instructions.trim()}>
          {saving ? 'Guardando…' : profile ? 'Guardar' : canStartChat ? 'Crear y chatear' : 'Crear agente'}
        </Button>
        {profile && <Button variant="ghost" size="sm" disabled={saving} onClick={() => void remove()}>Borrar</Button>}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" disabled={saving} onClick={onClose}>Cancelar</Button>
      </footer>
    </form>
  );
}
