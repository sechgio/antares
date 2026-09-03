export type PageNumberStyle = 'auto' | 'pagina_de' | 'n_de' | 'solo';

export type ResolvedPageNumberStyle = Exclude<PageNumberStyle, 'auto'>;

export type PageNumberSize = 'auto' | 'sm' | 'md' | 'lg' | 'xl';

export type PageNumberFontStyle = 'auto' | 'normal' | 'bold' | 'italic' | 'bold_italic';

export const PAGE_NUMBER_STYLE_OPTIONS: ReadonlyArray<{
  value: PageNumberStyle;
  label: string;
  example: string;
}> = [
  { value: 'auto', label: 'Según plantilla', example: 'Por defecto' },
  { value: 'pagina_de', label: 'Página N de X', example: 'Página 1 de 5' },
  { value: 'n_de', label: 'N de X', example: '1 de 5' },
  { value: 'solo', label: 'Solo número', example: '1' },
];

export const PAGE_NUMBER_SIZE_OPTIONS: ReadonlyArray<{
  value: PageNumberSize;
  label: string;
}> = [
  { value: 'auto', label: 'Según plantilla' },
  { value: 'sm', label: 'Pequeño' },
  { value: 'md', label: 'Mediano' },
  { value: 'lg', label: 'Grande' },
  { value: 'xl', label: 'Extra grande' },
];

export const PAGE_NUMBER_FONT_STYLE_OPTIONS: ReadonlyArray<{
  value: PageNumberFontStyle;
  label: string;
}> = [
  { value: 'auto', label: 'Según plantilla' },
  { value: 'normal', label: 'Normal' },
  { value: 'bold', label: 'Negrita' },
  { value: 'italic', label: 'Cursiva' },
  { value: 'bold_italic', label: 'Negrita cursiva' },
];

export const PAGE_NUMBER_SIZE_PX: Record<Exclude<PageNumberSize, 'auto'>, number> = {
  sm: 8,
  md: 10,
  lg: 14,
  xl: 18,
};

export interface FolioConfig {
  folioStart: number;
  folioEnd: number | null;
  folioInverted: boolean;
  syncedPageCount: number | null;
  pageNumberStyle: PageNumberStyle;
  pageNumberSize: PageNumberSize;
  pageNumberFontStyle: PageNumberFontStyle;
}

export function createDefaultFolioConfig(): FolioConfig {
  return {
    folioStart: 1,
    folioEnd: null,
    folioInverted: false,
    syncedPageCount: null,
    pageNumberStyle: 'auto',
    pageNumberSize: 'auto',
    pageNumberFontStyle: 'auto',
  };
}

export function getPageNumberAppearanceStyle(
  size: PageNumberSize = 'auto',
  fontStyle: PageNumberFontStyle = 'auto',
): { fontSize?: string; fontWeight?: number; fontStyle?: 'normal' | 'italic' } {
  const style: { fontSize?: string; fontWeight?: number; fontStyle?: 'normal' | 'italic' } = {};
  if (size !== 'auto') {
    style.fontSize = `${PAGE_NUMBER_SIZE_PX[size]}px`;
  }
  if (fontStyle !== 'auto') {
    style.fontWeight = fontStyle === 'bold' || fontStyle === 'bold_italic' ? 700 : 400;
    style.fontStyle = fontStyle === 'italic' || fontStyle === 'bold_italic' ? 'italic' : 'normal';
  }
  return style;
}

export function resolvePageNumberStyle(
  style: PageNumberStyle,
  variant?: string | null,
): ResolvedPageNumberStyle {
  if (style !== 'auto') return style;
  if (variant === 'volanteo-lurigancho-v2') return 'solo';
  if (variant === 'volante-lurigancho') return 'n_de';
  return 'pagina_de';
}

export function formatPageNumberLabel(
  style: PageNumberStyle,
  pageNumber: number,
  totalPages: number,
  variant?: string | null,
): string {
  const resolved = resolvePageNumberStyle(style, variant);
  switch (resolved) {
    case 'n_de':
      return `${pageNumber} de ${totalPages}`;
    case 'solo':
      return String(pageNumber);
    case 'pagina_de':
    default:
      return `Página ${pageNumber} de ${totalPages}`;
  }
}

export function expectedFolioEnd(folioStart: number, totalPages: number): number {
  if (totalPages <= 0) return folioStart;
  return folioStart + totalPages - 1;
}

export function resolvePhysicalFolios(
  totalPages: number,
  config: { folioStart: number; folioEnd: number; folioInverted: boolean },
): number[] {
  if (totalPages <= 0) return [];
  const first = config.folioInverted ? config.folioEnd : config.folioStart;
  const direction = config.folioInverted ? -1 : 1;
  return Array.from({ length: totalPages }, (_, i) => first + i * direction);
}

export function getPageFolio(pageIndex: number, folios: number[]): number {
  if (pageIndex >= 0 && pageIndex < folios.length) {
    return folios[pageIndex];
  }
  return pageIndex + 1;
}

function isAutoSyncedEnd(config: FolioConfig): boolean {
  if (config.folioEnd === null) return true;
  if (config.syncedPageCount === null) return false;
  return config.folioEnd === expectedFolioEnd(config.folioStart, config.syncedPageCount);
}

export function syncFolioEndWithPageCount(
  prev: FolioConfig,
  totalPages: number,
): FolioConfig {
  if (!isAutoSyncedEnd(prev)) return prev;
  return {
    ...prev,
    folioEnd: totalPages > 0 ? expectedFolioEnd(prev.folioStart, totalPages) : null,
    syncedPageCount: totalPages > 0 ? totalPages : null,
  };
}

export function isDefaultFolioConfig(
  config: FolioConfig,
  totalPages: number,
): boolean {
  const effectiveEnd = config.folioEnd ?? expectedFolioEnd(config.folioStart, totalPages);
  return (
    config.folioStart === 1 &&
    effectiveEnd === expectedFolioEnd(1, totalPages) &&
    !config.folioInverted &&
    config.pageNumberStyle === 'auto' &&
    config.pageNumberSize === 'auto' &&
    config.pageNumberFontStyle === 'auto'
  );
}

export function formatFolioSummary(
  config: FolioConfig,
  totalPages: number,
): string {
  if (totalPages <= 0) return '';
  const folios = resolvePhysicalFolios(totalPages, {
    folioStart: config.folioStart,
    folioEnd: config.folioEnd ?? expectedFolioEnd(config.folioStart, totalPages),
    folioInverted: config.folioInverted,
  });
  const first = folios[0];
  const last = folios[folios.length - 1];
  return `${first}→${last}`;
}
