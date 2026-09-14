export function normalizeRecordId(recordId: string): string {
  return String(recordId).trim().toLowerCase();
}

export function imageNameCandidates(filename: string): string[] {
  const base = filename.replace(/\.[^.]+$/, '');
  const numbered = base.match(/^(.*)[-_]\d+$/);
  return numbered ? [base, numbered[1]] : [base];
}

export function matchesRecordId(filename: string, recordId: string | number): boolean {
  const id = normalizeRecordId(String(recordId));
  if (!id) return false;
  return imageNameCandidates(filename).some((candidate) => normalizeRecordId(candidate) === id);
}

export function naturalSortByName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function naturalSortFilesByName(a: File, b: File): number {
  const extractSuffix = (name: string): number => {
    const match = name.match(/[-_](\d+)\.[^.]+$/i);
    return match ? parseInt(match[1], 10) : 0;
  };
  const numA = extractSuffix(a.name);
  const numB = extractSuffix(b.name);
  if (numA !== numB) return numA - numB;
  return a.name.localeCompare(b.name);
}

export function buildImagesByRecordId(
  rows: Record<string, string>[],
  idColumn: string,
  images: File[],
): Map<string, File[]> {
  const recordIds = new Set(
    rows.map((row) => normalizeRecordId(row[idColumn] ?? '')).filter(Boolean),
  );
  const index = new Map<string, File[]>();
  if (!idColumn || recordIds.size === 0) return index;

  for (const image of images) {
    const keys = new Set(imageNameCandidates(image.name).map(normalizeRecordId));

    for (const key of keys) {
      if (!recordIds.has(key)) continue;
      const matched = index.get(key);
      if (matched) matched.push(image);
      else index.set(key, [image]);
    }
  }

  for (const matched of index.values()) {
    matched.sort((a, b) => naturalSortByName(a.name, b.name));
  }
  return index;
}
