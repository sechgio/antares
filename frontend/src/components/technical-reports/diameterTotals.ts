export function sumDiameterColumns(
  rows: Array<Record<string, number>>,
  diameters: string[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const diameter of diameters) {
    let sum = 0;
    for (const row of rows) {
      sum += Number(row[diameter]) || 0;
    }
    totals[diameter] = sum;
  }
  return totals;
}

/** Sum all diameter values in a single row (horizontal total for OPER.) */
export function sumDiameterRow(
  row: Record<string, number>,
  diameters: string[],
): number {
  let sum = 0;
  for (const d of diameters) {
    sum += Number(row[d]) || 0;
  }
  return sum;
}
