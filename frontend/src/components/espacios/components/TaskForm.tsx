import { ListTodo, Pencil } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import Button from '../../ui/Button';
import DatePicker from '../../ui/DatePicker';
import Input from '../../ui/Input';
import ThemedSelect from '../../ui/ThemedSelect';
import type { BoardColumn, Tarea, TareaInput, TareaPriority, TareaStatus, TeamMember } from '../types';
import { isTareaPriority, PRIORITY_OPTIONS, tareaPriority } from '../utils/priority';
import ModalShell from './ModalShell';
import StatusPicker from './StatusPicker';
import TaskActivityFeed from './TaskActivityFeed';
import SelectPicker from './filters/SelectPicker';
import { errorMessage } from '@/utils/errors';

const FIELD_CLASS =
  'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:shadow-[0_0_0_3px_var(--accent-primary-glow)]';

interface TaskFormProps {
  open: boolean;
  members: TeamMember[];
  columns?: BoardColumn[];
  initial?: Tarea | null;
  defaultStartDate?: string | null;
  defaultDueDate?: string | null;
  defaultStatus?: TareaStatus | null;
  currentUserId?: string;
  onClose: () => void;
  onSubmit: (input: TareaInput) => Promise<void>;
}

function emptyForm(defaultStatus: TareaStatus = 'todo') {
  return {
    title: '', description: '', status: defaultStatus,
    priority: 'normal' as TareaPriority, assigneeId: '', startDate: '', dueDate: '',
  };
}

function formFromTarea(tarea: Tarea) {
  return {
    title: tarea.title,
    description: tarea.description ?? '',
    status: tarea.status,
    priority: tareaPriority(tarea),
    assigneeId: tarea.assignee_id ?? '',
    startDate: tarea.start_date ?? '',
    dueDate: tarea.due_date ?? '',
  };
}

// A session belongs to a task, not to the identity of a realtime snapshot.
// Closing or selecting a different task resets the editor, never the project view.
export default function TaskForm({ open, ...props }: TaskFormProps) {
  if (!open) return null;
  const key = props.initial
    ? `edit:${props.initial.id}`
    : `new:${JSON.stringify([props.defaultStatus, props.defaultStartDate, props.defaultDueDate])}`;
  return <TaskEditor key={key} {...props} />;
}

function TaskEditor({
  members,
  columns,
  initial = null,
  defaultStartDate = null,
  defaultDueDate = null,
  defaultStatus = null,
  currentUserId,
  onClose,
  onSubmit,
}: Omit<TaskFormProps, 'open'>) {
  const isEdit = Boolean(initial);
  const [baseline] = useState(() => initial ? formFromTarea(initial) : {
    ...emptyForm(defaultStatus ?? 'todo'),
    startDate: defaultStartDate ?? '',
    dueDate: defaultDueDate ?? '',
  });
  const [draft, setDraft] = useState(baseline);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discardRequested, setDiscardRequested] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const discardRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const submittingRef = useRef(false);
  const formId = useId();
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const disabled = saving || discardRequested;
  const { title, description, status, priority, assigneeId, startDate, dueDate } = draft;
  const change = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));
  const assigneeOptions = useMemo(
    () => [
      { value: '', label: 'Sin asignar' },
      ...members.map((member) => ({ value: member.user_id, label: member.display_name })),
    ],
    [members],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (discardRequested) discardRef.current?.querySelector('button')?.focus({ preventScroll: true });
  }, [discardRequested]);

  const handleClose = () => {
    if (submittingRef.current) return;
    if (dirty) setDiscardRequested(true);
    else onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || discardRequested || !title.trim()) return;
    const start = startDate || null;
    const due = dueDate || null;
    if (start && due && start > due) {
      setError('La fecha de inicio no puede ser posterior al vencimiento');
      return;
    }

    submittingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(), description: description.trim() || null,
        status, priority, assignee_id: assigneeId || null,
        start_date: start, due_date: due,
      });
      if (mountedRef.current) onClose();
    } catch (err) {
      if (mountedRef.current) setError(errorMessage(err, 'Error al guardar'));
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <ModalShell
      open
      placement={isEdit ? 'right' : 'center'}
      title={isEdit ? 'Detalle de tarea' : 'Nueva tarea'}
      description={isEdit
        ? 'Edita la tarea sin salir del proyecto. Los cambios se aplican al guardar.'
        : 'Completa los campos esenciales. Puedes ajustar el rango después en el calendario o Gantt.'}
      icon={isEdit ? Pencil : ListTodo}
      iconColor={isEdit ? 'var(--accent-primary)' : 'var(--accent-blue)'}
      initialFocusRef={titleRef}
      onClose={handleClose}
      closeDisabled={saving}
      size="md"
      footer={discardRequested ? (
        <div ref={discardRef} className="w-full" role="alert">
          <p className="mb-3 text-sm text-[var(--text-primary)]">Tienes cambios sin guardar. ¿Descartarlos?</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => {
              setDiscardRequested(false);
              requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
            }}>Seguir editando</Button>
            <Button type="button" size="sm" onClick={onClose}>Descartar cambios</Button>
          </div>
        </div>
      ) : (
        <>
          {dirty && <span className="mr-auto text-xs text-[var(--text-muted)]">Cambios sin guardar</span>}
          <Button type="button" variant="ghost" size="sm" onClick={handleClose} disabled={saving}>
            {isEdit ? 'Cerrar' : 'Cancelar'}
          </Button>
          <Button type="submit" form={formId} size="sm" disabled={saving || !title.trim()}>
            {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear tarea'}
          </Button>
        </>
      )}
    >
      <form id={formId} onSubmit={handleSubmit} noValidate aria-busy={saving} className="space-y-3.5">
        {error && <p role="alert" className="text-xs text-[var(--accent-red)]">{error}</p>}
        <div>
          <label htmlFor={`${formId}-title`} className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Título</label>
          <Input
            ref={titleRef}
            id={`${formId}-title`}
            value={title}
            onChange={(e) => change({ title: e.target.value })}
            placeholder="¿Qué hay que hacer?"
            required
            disabled={disabled}
            className="w-full bg-[var(--bg-input)]"
          />
        </div>
        <div>
          <label htmlFor={`${formId}-description`} className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Descripción</label>
          <textarea
            id={`${formId}-description`}
            value={description}
            onChange={(e) => change({ description: e.target.value })}
            placeholder="Detalles opcionales..."
            rows={isEdit ? 6 : 3}
            disabled={disabled}
            className={FIELD_CLASS}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">Estado</p>
            <StatusPicker
              value={status}
              columns={columns}
              onChange={(value) => change({ status: value })}
              disabled={disabled}
              size="md"
              label="Estado"
              className="w-full [&_button]:w-full [&_button]:justify-between"
            />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">Asignado</p>
            <SelectPicker
              value={assigneeId}
              options={assigneeOptions}
              onChange={(value) => change({ assigneeId: value })}
              disabled={disabled}
              aria-label="Persona asignada"
              size="md"
              className="w-full [&_button]:w-full [&_button]:justify-between"
            />
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">Prioridad</p>
          <ThemedSelect
            value={priority}
            options={PRIORITY_OPTIONS}
            onChange={(value) => { if (isTareaPriority(value)) change({ priority: value }); }}
            disabled={disabled}
            aria-label="Prioridad de la tarea"
          />
          {status === 'urgent' && (
            <p className="mt-1.5 text-xs text-[var(--text-muted)]">
              El estado «Urgente» se conserva por compatibilidad. La prioridad se gestiona por separado; cambiarla no mueve la tarea de columna.
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">Inicio</p>
            <DatePicker
              value={startDate}
              onChange={(value) => change({ startDate: value })}
              placeholder="Sin fecha"
              disabled={disabled}
              clearable
              size="lg"
              aria-label="Fecha de inicio"
            />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">Vencimiento</p>
            <DatePicker
              value={dueDate}
              onChange={(value) => change({ dueDate: value })}
              placeholder="Sin fecha"
              disabled={disabled}
              clearable
              size="lg"
              aria-label="Fecha de vencimiento"
            />
          </div>
        </div>
      </form>
      {initial && currentUserId && (
        <TaskActivityFeed
          tareaId={initial.id}
          userId={currentUserId}
          members={members}
          columns={columns ?? []}
        />
      )}
    </ModalShell>
  );
}
