export function formatDateValue(value: string | number | undefined): string {
  if (!value || value === '-') return '-';
  const text = String(value).trim();
  if (!text) return '-';

  const datePatterns = [
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/,
    /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/,
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

export function isDateColumn(header: string): boolean {
  const h = header.toLowerCase();
  return h.includes('fecha') || h.includes('date') || h.includes('corte') || h.includes('trabajo');
}

export { escapeHtml } from '../../utils/html';

export function normalizePreviewValue(value: unknown, fallback = '-'): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text ? text : fallback;
}

export { chunkArray as chunkItems } from '../../utils/chunk';

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
