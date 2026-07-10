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

/** Last folio when numbering `totalPages` sheets starting at `folioStart`. */
export function expectedFolioEnd(folioStart: number, totalPages: number): number {
  if (totalPages <= 0) return folioStart;
  return folioStart + totalPages - 1;
}

/**
 * One unique consecutive folio per sheet.
 * Non-inverted: folioStart, folioStart+1, … (totalPages values).
 * Inverted: folioEnd, folioEnd-1, … down for totalPages values.
 */
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
    folioEnd: config.folioEnd ?? expectedFolioEnd(config.folioStart, totalPages),
    folioInverted: config.folioInverted,
  });
  const first = folios[0];
  const last = folios[folios.length - 1];
  return `${first}→${last}`;
}
