const EXCEL_EPOCH_LOCAL = new Date(1899, 11, 30);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function excelSerialToDate(serial: number): Date {
  return new Date(EXCEL_EPOCH_LOCAL.getTime() + serial * MS_PER_DAY);
}

export function formatExcelSerialDMY(serial: number): string {
  const date = excelSerialToDate(Math.floor(serial));
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = String(date.getFullYear()).slice(-2);
  return `${d}/${m}/${y}`;
}
