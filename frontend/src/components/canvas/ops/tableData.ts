export function parseTableData(
  raw: string | undefined,
): { cells: string[][]; fieldKeys?: (string | null)[][] } {
  if (!raw) return { cells: [['', '']] };
  try {
    const parsed = JSON.parse(raw) as { cells?: string[][]; fieldKeys?: (string | null)[][] };
    if (Array.isArray(parsed.cells)) {
      return { cells: parsed.cells, fieldKeys: parsed.fieldKeys };
    }
  } catch {
  }
  return { cells: [['', '']] };
}
