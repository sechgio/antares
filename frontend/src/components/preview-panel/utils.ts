/**
 * Utilidades para el Generador de Reportes
 */

export function formatDateValue(value: string | number | undefined): string {
  if (!value || value === '-') return '-';
  const text = String(value).trim();
  if (!text) return '-';

  // Patrones comunes de fecha
  const datePatterns = [
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/, // DD/MM/YYYY
    /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/, // YYYY/MM/DD
  ];

  for (const pattern of datePatterns) {
    if (pattern.test(text)) return text;
  }

  const date = new Date(text);
  if (!isNaN(date.getTime())) {
    return date.toLocaleDateString('es-ES');
  }

  return text;
}

export function excelSerialToDate(serial: number): string {
  // Excel serial date base: 30 Dec 1899
  const epoch = new Date(1899, 11, 30);
  const days = Math.floor(serial);
  const msPerDay = 24 * 60 * 60 * 1000;
  const date = new Date(epoch.getTime() + days * msPerDay);

  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = String(date.getFullYear()).slice(-2);
  return `${d}/${m}/${y}`;
}

export function isDateColumn(header: string): boolean {
  const h = header.toLowerCase();
  return h.includes('fecha') || h.includes('date') || h.includes('corte') || h.includes('trabajo');
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function normalizePreviewValue(value: unknown, fallback = '-'): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text ? text : fallback;
}

export function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// Match image name to record ID with exact prefix matching
export function matchesRecordId(imageName: string, recordId: string | number): boolean {
  const id = String(recordId).trim();
  const name = imageName.toLowerCase();
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `^${escapedId}(?:[-_]\\d+)?\\.(jpg|jpeg|png|gif|webp)$`,
    'i'
  );
  return regex.test(name);
}

export function naturalSortByName(a: File, b: File): number {
  const extractSuffix = (name: string): number => {
    const match = name.match(/[-_](\d+)\.[^.]+$/i);
    return match ? parseInt(match[1], 10) : 0;
  };
  const numA = extractSuffix(a.name);
  const numB = extractSuffix(b.name);
  if (numA !== numB) return numA - numB;
  return a.name.localeCompare(b.name);
}

export function validateTemplateStructure(content: string): { valid: boolean; error: string } {
  const validPatterns = [
    '{{ data',
    '{{ images',
    '{{ reports',
    'report.data',
    'report.images',
    'report_list',
  ];
  const hasValidPattern = validPatterns.some(v => content.includes(v));

  if (!hasValidPattern) {
    return {
      valid: false,
      error: 'La plantilla debe contener variables Jinja2 como {{ data }}, {{ images }}, {{ reports }} o report.data/report.images',
    };
  }

  if (!content.includes('<html') && !content.includes('<!DOCTYPE')) {
    return {
      valid: false,
      error: 'La plantilla debe ser un documento HTML válido',
    };
  }

  return { valid: true, error: '' };
}
