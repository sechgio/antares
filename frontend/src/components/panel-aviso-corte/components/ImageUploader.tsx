import { ImageIcon } from 'lucide-react';
import { ARIA_LABELS, ACCEPTED_IMAGE_TYPES } from '../constants';
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
      variant="dashed"
      accept={ACCEPTED_IMAGE_TYPES.join(',')}
      acceptFile={(file) => ACCEPTED_IMAGE_TYPES.includes(file.type)}
      labels={{
        dropzoneTitle: 'Arrastra imágenes o haz clic',
        dropzoneSubtitle: 'PNG, JPG, WebP · admite lotes grandes',
        dropzoneAriaLabel: ARIA_LABELS.imageUploader,
        dismissErrors: 'Descartar',
        galleryTitle: (count) => (
          <>
            <ImageIcon size={11} />
            {count} imagen{count !== 1 && 'es'}
          </>
        ),
        clearLabel: 'Limpiar',
        expandMore: (hiddenCount) => `Ver más · ${hiddenCount} más`,
      }}
    />
  );
}
