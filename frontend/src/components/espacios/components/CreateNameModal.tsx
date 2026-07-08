import { FolderKanban, Layers } from 'lucide-react';
import { useState } from 'react';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import ModalShell from './ModalShell';

export type CreateNameModalVariant = 'espacio' | 'proyecto';

const VARIANT_CONFIG = {
  espacio: {
    icon: Layers,
    iconColor: 'var(--accent-primary)',
    description: 'Agrupa proyectos y tareas de tu equipo en un solo lugar.',
    label: 'Nombre del espacio',
    submitLabel: 'Crear espacio',
    savingLabel: 'Creando...',
  },
  proyecto: {
    icon: FolderKanban,
    iconColor: 'var(--accent-secondary)',
    description: 'Organiza tareas e iniciativas dentro del espacio seleccionado.',
    label: 'Nombre del proyecto',
    submitLabel: 'Crear proyecto',
    savingLabel: 'Creando...',
  },
} as const;

interface CreateNameModalProps {
  open: boolean;
  variant: CreateNameModalVariant;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}

export default function CreateNameModal({ open, variant, onClose, onSubmit }: CreateNameModalProps) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const config = VARIANT_CONFIG[variant];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      setName('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (saving) return;
    setName('');
    setError(null);
    onClose();
  };

  return (
    <ModalShell
      open={open}
      title={variant === 'espacio' ? 'Nuevo espacio' : 'Nuevo proyecto'}
      description={config.description}
      icon={config.icon}
      iconColor={config.iconColor}
      onClose={handleClose}
      footer={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={handleClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="create-name-form"
            size="sm"
            disabled={saving || !name.trim()}
          >
            {saving ? config.savingLabel : config.submitLabel}
          </Button>
        </>
      }
    >
      <form id="create-name-form" onSubmit={handleSubmit} noValidate>
        <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
          {config.label}
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`Ej. ${variant === 'espacio' ? 'Marketing 2026' : 'Lanzamiento Q3'}`}
          autoFocus
          disabled={saving}
          className="w-full bg-[var(--bg-input)]"
        />
        {error && (
          <p className="mt-2.5 text-xs text-[var(--accent-red)]">{error}</p>
        )}
      </form>
    </ModalShell>
  );
}