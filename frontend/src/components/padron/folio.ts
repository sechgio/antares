export interface FolioConfig {
  folioStart: number;
  folioEnd: number | null;
  folioInverted: boolean;
  /** Tracks the page count folioEnd was last synced against. */
  syncedPageCount: number | null;
}

export function createDefaultFolioConfig(): FolioConfig {
  return {
    folioStart: 1,
    folioEnd: null,
    folioInverted: false,
    syncedPageCount: null,
  };
}

export function resolvePhysicalFolios(
  totalPages: number,
  config: { folioStart: number; folioEnd: number; folioInverted: boolean },
): number[] {
  if (totalPages <= 0) return [];
  const first = config.folioInverted ? config.folioEnd : config.folioStart;
  const last = config.folioInverted ? config.folioStart : config.folioEnd;
  if (totalPages === 1) return [first];
  return Array.from({ length: totalPages }, (_, i) =>
    Math.round(first + (i * (last - first)) / (totalPages - 1)),
  );
}

export function getPageFolio(pageIndex: number, folios: number[]): number {
  if (pageIndex >= 0 && pageIndex < folios.length) {
    return folios[pageIndex];
  }
  return pageIndex + 1;
}

export function syncFolioEndWithPageCount(
  prev: FolioConfig,
  totalPages: number,
): FolioConfig {
  const wasAuto =
    prev.folioEnd === null ||
    (prev.syncedPageCount !== null && prev.folioEnd === prev.syncedPageCount);
  if (!wasAuto) return prev;
  return {
    ...prev,
    folioEnd: totalPages > 0 ? totalPages : null,
    syncedPageCount: totalPages > 0 ? totalPages : null,
  };
}

export function isDefaultFolioConfig(
  config: FolioConfig,
  totalPages: number,
): boolean {
  const effectiveEnd = config.folioEnd ?? totalPages;
  return (
    config.folioStart === 1 &&
    effectiveEnd === totalPages &&
    !config.folioInverted
  );
}

export function formatFolioSummary(
  config: FolioConfig,
  totalPages: number,
): string {
  if (totalPages <= 0) return '';
  const folios = resolvePhysicalFolios(totalPages, {
    folioStart: config.folioStart,
    folioEnd: config.folioEnd ?? totalPages,
    folioInverted: config.folioInverted,
  });
  const first = folios[0];
  const last = folios[folios.length - 1];
  return `${first}→${last}`;
}
