export {
  ACCEPTED_IMAGE_EXTENSIONS,
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_LOGO_BYTES,
  MSG_IMAGE_TOO_LARGE,
  MSG_LOGO_INVALID,
  MSG_LOGO_TOO_LARGE,
} from '@/utils/imageUploadLimits';

export const IMAGES_PER_PAGE = 6;
export const GRID_COLUMNS = 3;
export const GRID_ROWS = 2;
export const MAX_TOTAL_IMAGE_BYTES = 64 * 1024 * 1024;
export const MSG_IMAGE_TOTAL_TOO_LARGE = 'El peso total de las imágenes no puede superar 64 MB';

export const DEFAULT_TITLE =
  'EVIDENCIAS FOTOGRÁFICAS DEL VOLANTEO\nCORTE DE SERVICIO';

export const DEFAULT_CUADRANTE_LABEL = 'CUADRANTE AFECTADO:';
export const MSG_NO_IMAGES = 'No hay imágenes para exportar';
export const MSG_TITLE_REQUIRED = 'El título es obligatorio';

export { chunkArray } from '@/utils/chunk';
