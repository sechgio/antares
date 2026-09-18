import { Plus } from 'lucide-react';
import Button from '@/components/ui/Button';

interface BlankCanvasCardProps {
  onBlank: () => void;
}

export default function BlankCanvasCard({ onBlank }: BlankCanvasCardProps) {
  return (
    <article className="tpl-card">
      <Button variant="none" size="none"
        className="tpl-thumb tpl-thumb--blank"
        onClick={onBlank}
        aria-label="Crear documento en blanco"
      >
        <span className="tpl-thumb-paper tpl-thumb-paper--blank" aria-hidden="true">
          <Plus className="h-4 w-4" />
        </span>
      </Button>
      <div className="tpl-card-body">
        <h3 className="tpl-card-title">Documento en blanco</h3>
        <p className="tpl-card-sub">Página A4 vacía, lista para diseñar.</p>
      </div>
    </article>
  );
}
