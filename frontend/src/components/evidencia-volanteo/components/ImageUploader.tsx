import { Image as ImageIconSVG } from 'lucide-react';
import { ACCEPTED_IMAGE_TYPES } from '../constants';
import type { LocalImage } from '../types';
import SharedImageUploader from '@/components/ui/ImageUploader';

interface Props {
  images: LocalImage[];
  onAdd: (files: File[]) => string[] | Promise<string[]>;
  onRemove: (index: number) => void;
  onClear: () => void;
}

export default function ImageUploader({ images, onAdd, onRemove, onClear }: Props) {
  return (
    <SharedImageUploader
      images={images}
      onAdd={onAdd}
      onRemove={onRemove}
      onClear={onClear}
      variant="flat"
      accept={ACCEPTED_IMAGE_TYPES.join(',')}
      header={
        <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
          <ImageIconSVG size={14} />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Imágenes de Evidencia</span>
        </div>
      }
      labels={{
        dropzoneTitle: 'Cargar lote de fotos',
        dropzoneSubtitle: 'Formatos PNG/JPG · Orden secuencial',
        dropzoneAriaLabel: 'Cargar lote de fotos',
        dismissErrors: 'Descartar errores',
        galleryTitle: () => 'Galería cargada',
        clearLabel: 'Vaciar galería',
        expandMore: (hiddenCount) => `Mostrar ${hiddenCount} restantes`,
      }}
    />
  );
}
