import { ListTodo, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import Button from '../../ui/Button';
import DatePicker from '../../ui/DatePicker';
import Input from '../../ui/Input';
import type { BoardColumn, Tarea, TareaInput, TareaStatus, TeamMember } from '../types';
import ModalShell from './ModalShell';
import StatusPicker from './StatusPicker';

const FIELD_CLASS =
  'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:shadow-[0_0_0_3px_var(--accent-primary-glow)]';

interface TaskFormProps {
  open: boolean;
  members: TeamMember[];
  columns?: BoardColumn[];
  /** When set, form edits this task instead of creating a new one. */
  initial?: Tarea | null;
  /** Prefill start date when creating (e.g. from Gantt day click). */
  defaultStartDate?: string | null;
  /** Prefill due date when creating (e.g. from calendar day click). */
  defaultDueDate?: string | null;
  /** Prefill status when creating (e.g. from board column). */
  defaultStatus?: TareaStatus | null;
  onClose: () => void;
  onSubmit: (input: TareaInput) => Promise<void>;
}

function emptyForm(defaultStatus: TareaStatus = 'todo') {
  return {
    title: '',
    description: '',
    status: defaultStatus,
    assigneeId: '',
    startDate: '',
    dueDate: '',
  };
}

function formFromTarea(tarea: Tarea) {
  return {
    title: tarea.title,
    description: tarea.description ?? '',
    status: tarea.status,
    assigneeId: tarea.assignee_id ?? '',
    startDate: tarea.start_date ?? '',
    dueDate: tarea.due_date ?? '',
  };
}

export default function TaskForm({
  open,
  members,
  columns,
  initial = null,
  defaultStartDate = null,
  defaultDueDate = null,
  defaultStatus = null,
  onClose,
  onSubmit,
}: TaskFormProps) {
  const isEdit = Boolean(initial);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TareaStatus>('todo');
  const [assigneeId, setAssigneeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const next = initial
      ? formFromTarea(initial)
      : {
          ...emptyForm(defaultStatus ?? 'todo'),
          startDate: defaultStartDate ?? '',
          dueDate: defaultDueDate ?? '',
        };
    setTitle(next.title);
    setDescription(next.description);
    setStatus(next.status);
    setAssigneeId(next.assigneeId);
    setStartDate(next.startDate);
    setDueDate(next.dueDate);
    setError(null);
    setSaving(false);
  }, [open, initial, defaultStartDate, defaultDueDate, defaultStatus]);

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const start = startDate || null;
    const due = dueDate || null;
    if (start && due && start > due) {
      setError('La fecha de inicio no puede ser posterior al vencimiento');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || null,
        status,
        assignee_id: assigneeId || null,
        start_date: start,
        due_date: due,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={open}
      title={isEdit ? 'Editar tarea' : 'Nueva tarea'}
      description={
        isEdit
          ? 'Actualiza título, estado, asignado o fechas.'
          : 'Completa los campos esenciales. Puedes ajustar el rango después en el calendario o Gantt.'
      }
      icon={isEdit ? Pencil : ListTodo}
      iconColor={isEdit ? 'var(--accent-primary)' : 'var(--accent-blue)'}
      onClose={handleClose}
      size="md"
      footer={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={handleClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="task-form" size="sm" disabled={saving || !title.trim()}>
            {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear tarea'}
          </Button>
        </>
      }
    >
      <form id="task-form" onSubmit={handleSubmit} noValidate className="space-y-3.5">
        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}

        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Título</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="¿Qué hay que hacer?"
            required
            autoFocus
            disabled={saving}
            className="w-full bg-[var(--bg-input)]"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Descripción</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Detalles opcionales..."
            rows={3}
            disabled={saving}
            className={FIELD_CLASS}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Estado</label>
            <StatusPicker
              value={status}
              columns={columns}
              onChange={setStatus}
              disabled={saving}
              size="md"
              label="Estado"
              className="w-full [&_button]:w-full [&_button]:justify-between"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Asignado</label>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              disabled={saving}
              className={FIELD_CLASS}
              aria-label="Persona asignada"
            >
              <option value="">Sin asignar</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Inicio</label>
            <DatePicker
              value={startDate}
              onChange={setStartDate}
              placeholder="Sin fecha"
              disabled={saving}
              clearable
              size="lg"
              aria-label="Fecha de inicio"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Vencimiento</label>
            <DatePicker
              value={dueDate}
              onChange={setDueDate}
              placeholder="Sin fecha"
              disabled={saving}
              clearable
              size="lg"
              aria-label="Fecha de vencimiento"
            />
          </div>
        </div>
      </form>
    </ModalShell>
  );
}
