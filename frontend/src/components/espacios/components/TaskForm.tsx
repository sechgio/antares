import { ListTodo } from 'lucide-react';
import { useState } from 'react';
import Button from '../../ui/Button';
import DatePicker from '../../ui/DatePicker';
import Input from '../../ui/Input';
import type { TareaInput, TareaStatus, TeamMember } from '../types';
import ModalShell from './ModalShell';
import StatusPicker from './StatusPicker';

const FIELD_CLASS =
  'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:shadow-[0_0_0_3px_var(--accent-primary-glow)]';

interface TaskFormProps {
  open: boolean;
  members: TeamMember[];
  onClose: () => void;
  onSubmit: (input: TareaInput) => Promise<void>;
}

export default function TaskForm({ open, members, onClose, onSubmit }: TaskFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TareaStatus>('todo');
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle('');
    setDescription('');
    setStatus('todo');
    setAssigneeId('');
    setDueDate('');
    setError(null);
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || null,
        status,
        assignee_id: assigneeId || null,
        due_date: dueDate || null,
      });
      reset();
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
      title="Nueva tarea"
      description="Completa los campos esenciales. Puedes ajustar fechas después en el calendario o Gantt."
      icon={ListTodo}
      iconColor="var(--accent-blue)"
      onClose={handleClose}
      size="md"
      footer={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={handleClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="task-form" size="sm" disabled={saving || !title.trim()}>
            {saving ? 'Guardando...' : 'Crear tarea'}
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
              onChange={setStatus}
              disabled={saving}
              size="md"
              label="Estado inicial"
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
                <option key={m.user_id} value={m.user_id}>{m.display_name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Vencimiento</label>
          <DatePicker
            value={dueDate}
            onChange={setDueDate}
            placeholder="Seleccionar fecha"
            disabled={saving}
            clearable
            size="lg"
            aria-label="Fecha de vencimiento"
          />
        </div>
      </form>
    </ModalShell>
  );
}