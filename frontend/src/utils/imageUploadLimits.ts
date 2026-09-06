export const MAX_LOGO_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
export const ACCEPTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

export const MSG_LOGO_TOO_LARGE = 'El logo supera el tamaño máximo de 5 MB';
export const MSG_LOGO_INVALID = 'Archivo de logo inválido';
export const MSG_IMAGE_TOO_LARGE = (name: string) => `La imagen ${name} excede el tamaño máximo de 15 MB`;
