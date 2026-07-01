export const MAX_LOGO_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const IMAGES_PER_PAGE = 6;
export const GRID_COLUMNS = 3;
export const GRID_ROWS = 2;

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
export const ACCEPTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

export const DEFAULT_TITLE =
  'EVIDENCIAS FOTOGRÁFICAS DEL VOLANTEO\nCORTE DE SERVICIO';

export const MSG_LOGO_TOO_LARGE = 'El logo supera el tamaño máximo de 5 MB';
export const MSG_LOGO_INVALID = 'Archivo de logo inválido';
export const MSG_IMAGE_TOO_LARGE = (name: string) => `La imagen ${name} excede el tamaño máximo de 15 MB`;
export const MSG_NO_IMAGES = 'No hay imágenes para exportar';
export const MSG_TITLE_REQUIRED = 'El título es obligatorio';

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}