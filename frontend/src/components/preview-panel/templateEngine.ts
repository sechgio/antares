/**
 * Motor de renderizado Jinja2-lite para plantillas HTML de preview.
 * Basado en la lógica del PreviewPanel original de FEATURES.
 */

export interface TemplateData {
  [key: string]: string | number | undefined;
}

export interface PreviewImage {
  file: File;
  url: string;
}

export interface RenderContext {
  data: TemplateData;
  images: PreviewImage[];
  logoLeft?: string;
  logoRight?: string;
  customColumns?: Array<{ id: string; name: string }>;
}

const EMPTY_PIXEL = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E";

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeValue(value: unknown, fallback = '-'): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text ? text : fallback;
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function formatDateValue(value: string | number | undefined): string {
  if (!value || value === '-') return '-';
  const text = String(value).trim();
  if (!text) return '-';

  // Intentar detectar formatos comunes de fecha
  const datePatterns = [
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/, // DD/MM/YYYY o similar
    /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/, // YYYY/MM/DD
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      return text; // Devolver como está si coincide con patrón conocido
    }
  }

  // Intentar parsear como fecha ISO o timestamp
  const date = new Date(text);
  if (!isNaN(date.getTime())) {
    return date.toLocaleDateString('es-ES');
  }

  return text;
}

export function isMaqBaldeTemplate(templateName: string): boolean {
  const normalized = templateName.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalized === 'maq balde sjl.html' || normalized.includes('maq balde sjl');
}

export function isMaquinaBaldeTemplate(templateName: string): boolean {
  const normalized = templateName.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalized === 'maquina-balde.html' || normalized.includes('maquina-balde');
}

export function isFixedA4Template(templateName: string): boolean {
  return templateName === 'report_volanteo.html' || isMaqBaldeTemplate(templateName) || isMaquinaBaldeTemplate(templateName);
}

function buildMaqBaldePreviewHtml(
  reportData: TemplateData,
  imageFiles: PreviewImage[],
  leftLogo: string,
  rightLogo: string
): string {
  const pickValue = (...candidates: Array<string | number | undefined>): string => {
    for (const candidate of candidates) {
      const normalized = normalizeValue(candidate, '');
      if (normalized && normalized !== '-') return normalized;
    }
    return '-';
  };

  const title = pickValue(reportData.titulo, reportData.TITULO, 'PANEL FOTOGRAFICO');
  const centro = pickValue(reportData.CENTRO, reportData.cs, reportData.centro_servicio, reportData.centro);
  const fechaTrabajo = pickValue(
    reportData.FECHA_TRABAJO,
    reportData['FECHA DE TRABAJO'],
    reportData['Fecha de Trabajo'],
    reportData.fecha,
    reportData.fecha_trabajo,
    reportData['FECHA CORTE'],
    reportData.FECHA_CORTE,
    reportData.fecha_corte,
    reportData['FECHA-CORTE'],
  );
  const estado = pickValue(reportData.ESTADO, reportData.estado);
  const direcciones = pickValue(
    reportData.DIRECCIONES_AFECTADAS,
    reportData['DIRECCIONES AFECTADAS'],
    reportData.direcciones,
    reportData.direccion,
    reportData.DIRECCION,
    reportData.ubicacion,
  );
  const distrito = pickValue(reportData.DISTRITO, reportData.distrito);
  const actividad = pickValue(reportData.ACTIVIDAD, reportData.actividad);
  const cuadrilla = pickValue(reportData.CUADRILLA, reportData.cuadrilla);

  const pageChunks = imageFiles.length > 0 ? chunkItems(imageFiles, 4) : [[]];
  const totalPages = pageChunks.length;

  const pagesHtml = pageChunks.map((pageImages, pageIndex) => {
    const pageLabel = totalPages > 1 ? `<div class="page-label">Hoja ${pageIndex + 1}/${totalPages}</div>` : '';
    const slots = pageImages.length === 3
      ? pageImages
      : [...pageImages, ...Array.from({ length: Math.max(0, 4 - pageImages.length) }, () => null as PreviewImage | null)];

    const gridHtml = slots.map((img, slotIndex) => {
      const extraClass = pageImages.length === 3 && slotIndex === 2 ? ' photo-cell-photo-3' : '';
      if (!img) return `<div class="photo-cell${extraClass}"><div class="photo-placeholder">Sin imagen</div></div>`;

      const altText = img.file.name || `Foto ${slotIndex + 1}`;
      return `
      <div class="photo-cell${extraClass}">
        <img src="${escapeHtml(img.url)}" alt="${escapeHtml(altText)}">
      </div>`;
    }).join('');

    return `
    <div class="page">
      <header class="header">
        <div class="header-logo">
          ${leftLogo ? `<img src="${escapeHtml(leftLogo)}" alt="Logo Izquierdo">` : '<span class="header-logo-placeholder"></span>'}
        </div>
        <div class="header-title">
          <h1>${escapeHtml(title)}</h1>
          ${pageLabel}
        </div>
        <div class="header-logo">
          ${rightLogo ? `<img src="${escapeHtml(rightLogo)}" alt="Logo Derecho">` : '<span class="header-logo-placeholder"></span>'}
        </div>
      </header>

      <div class="info-bar">
        <div class="info-item"><span class="info-label">Centro de Servicios:</span><span class="info-value">${escapeHtml(centro)}</span></div>
        <div class="info-item"><span class="info-label">Fecha de Trabajo:</span><span class="info-value">${escapeHtml(fechaTrabajo)}</span></div>
        <div class="info-item"><span class="info-label">Estado:</span><span class="info-value">${escapeHtml(estado)}</span></div>
      </div>

      <section class="localizacion">
        <div class="section-title">1.0 Localizacion</div>
        <table class="loc-table">
          <tr><td class="loc-label">Direcciones Afectadas:</td><td class="loc-value" colspan="3">${escapeHtml(direcciones)}</td></tr>
          <tr><td class="loc-label">Distrito:</td><td class="loc-value" colspan="3">${escapeHtml(distrito)}</td></tr>
        </table>
      </section>

      <section class="localizacion">
        <div class="section-title">2.0 Detalles de Orden de Trabajo</div>
        <table class="loc-table">
          <tr>
            <td class="loc-label">Actividad:</td><td class="loc-value">${escapeHtml(actividad)}</td>
            <td class="loc-label" style="padding-left:8px">Cuadrilla:</td><td class="loc-value">${escapeHtml(cuadrilla)}</td>
          </tr>
        </table>
      </section>

      <section class="panel-fotografico">
        <div class="section-title">3.0 Panel Fotografico</div>
        <div class="photo-grid">${gridHtml}</div>
      </section>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { size: A4 portrait; margin: 0; background: #ffffff; }
    html, body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; font-size: 10px; line-height: 1.3; color: #222; background: #ffffff; width: 210mm; height: 297mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { width: 210mm; height: 297mm; max-height: 297mm; margin: 0 auto; padding: 8mm; background: #ffffff; display: flex; flex-direction: column; page-break-after: always; page-break-inside: avoid; box-sizing: border-box; overflow: hidden; }
    .page:last-child { page-break-after: auto; }
    .header { display: flex; justify-content: space-between; align-items: center; height: 20mm; padding-bottom: 4mm; border-bottom: 2px solid #333; margin-bottom: 3mm; flex-shrink: 0; }
    .header-logo { width: 55mm; height: 18mm; display: flex; align-items: center; justify-content: center; }
    .header-logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .header-logo-placeholder { font-size: 14px; font-weight: bold; color: #666; }
    .header-title { flex: 1; text-align: center; }
    .header-title h1 { font-size: 16px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #000; }
    .header-title .page-label { font-size: 9px; color: #777; margin-top: 2px; }
    .info-bar { display: flex; border: 1px solid #ccc; background: #ffffff; margin-bottom: 2mm; flex-shrink: 0; }
    .info-item { flex: 1; display: flex; align-items: center; padding: 1.5mm 2mm; border-right: 1px solid #ccc; gap: 1mm; white-space: nowrap; }
    .info-item:last-child { border-right: none; }
    .info-label { font-size: 9pt; font-weight: bold; text-transform: uppercase; color: #000; }
    .info-value { font-size: 9pt; font-weight: normal; color: #000; }
    .section-title { font-size: 10pt; font-weight: bold; color: #0066cc; text-transform: uppercase; margin-bottom: 3mm; padding-bottom: 3px; border-bottom: 1px solid #0066cc; flex-shrink: 0; }
    .localizacion { margin-bottom: 3mm; flex-shrink: 0; }
    .loc-table { width: 100%; border-collapse: collapse; }
    .loc-table td { padding: 1.5px 0; vertical-align: baseline; }
    .loc-label { font-size: 9pt; font-weight: bold; text-transform: uppercase; color: #000; white-space: nowrap; padding-right: 6px; }
    .loc-value { font-size: 9pt; color: #000; word-break: break-word; }
    .panel-fotografico { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    .photo-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 2mm; width: 100%; height: 100%; border: 1px solid #0066cc; padding: 2mm; flex: 1; min-height: 0; overflow: hidden; box-sizing: border-box; background: #ffffff; }
    .photo-cell { background: #ffffff; border: 1px solid #ddd; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; box-sizing: border-box; }
    .photo-cell img { max-width: 100%; max-height: 100%; object-fit: contain; object-position: center; display: block; }
    .photo-cell-photo-3 { grid-column: span 2; justify-self: center; width: calc(50% - 1mm); }
    .photo-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #999; font-size: 10px; font-style: italic; background: #ffffff; }
  </style>
</head>
<body>${pagesHtml}</body>
</html>`;
}

function buildMaquinaBaldePreviewHtml(
  reportData: TemplateData,
  imageFiles: PreviewImage[],
  leftLogo: string,
  rightLogo: string
): string {
  const pickValue = (...candidates: Array<string | number | undefined>): string => {
    for (const candidate of candidates) {
      const normalized = normalizeValue(candidate, '');
      if (normalized && normalized !== '-') return normalized;
    }
    return '-';
  };

  const title = pickValue(reportData.titulo, reportData.TITULO, 'Maquina de Balde');
  const fechaTrabajo = pickValue(reportData.FECHA_TRABAJO, reportData['FECHA DE TRABAJO'], reportData.fecha_trabajo);
  const nis = pickValue(reportData.NIS, reportData.nis);
  const sgio = pickValue(reportData.SGIO, reportData.sgio);
  const direccion = pickValue(reportData.DIRECCION, reportData.direccion, reportData.DIRECCIONES);
  const localidad = pickValue(reportData.LOCALIDAD, reportData.localidad);
  const distrito = pickValue(reportData.DISTRITO, reportData.distrito);
  const actividad = pickValue(reportData.ACTIVIDAD, reportData.actividad);

  const pageChunks = imageFiles.length > 0 ? chunkItems(imageFiles, 4) : [[]];
  const totalPages = pageChunks.length;

  const pagesHtml = pageChunks.map((pageImages, pageIndex) => {
    const pageLabel = totalPages > 1 ? `<div class="page-label">Pagina ${pageIndex + 1}/${totalPages}</div>` : '';
    const slots = pageImages.length === 3
      ? pageImages
      : [...pageImages, ...Array.from({ length: Math.max(0, 4 - pageImages.length) }, () => null as PreviewImage | null)];

    const gridHtml = slots.map((img, slotIndex) => {
      const extraClass = pageImages.length === 3 && slotIndex === 2 ? ' photo-cell-photo-3' : '';
      if (!img) return `<div class="photo-cell${extraClass}"><div class="photo-placeholder">Sin imagen</div></div>`;
      const altText = img.file.name || `Foto ${slotIndex + 1}`;
      return `<div class="photo-cell${extraClass}"><img src="${escapeHtml(img.url)}" alt="${escapeHtml(altText)}"></div>`;
    }).join('');

    return `
    <div class="page">
      <header class="header">
        <div class="header-logo">${leftLogo ? `<img src="${escapeHtml(leftLogo)}" alt="Logo Izquierdo">` : '<span class="header-logo-placeholder"></span>'}</div>
        <div class="header-title"><h1>${escapeHtml(title)}</h1>${pageLabel}</div>
        <div class="header-logo">${rightLogo ? `<img src="${escapeHtml(rightLogo)}" alt="Logo Derecho">` : '<span class="header-logo-placeholder"></span>'}</div>
      </header>
      <div class="info-bar">
        <div class="info-item"><span class="info-label">Fecha de Trabajo:</span><span class="info-value">${escapeHtml(fechaTrabajo)}</span></div>
        <div class="info-item"><span class="info-label">NIS:</span><span class="info-value">${escapeHtml(nis)}</span></div>
        <div class="info-item"><span class="info-label">SGIO:</span><span class="info-value">${escapeHtml(sgio)}</span></div>
      </div>
      <section class="localizacion">
        <div class="section-title">1.0 Localizacion</div>
        <table class="loc-table">
          <tr><td class="loc-label">Direccion:</td><td class="loc-value" colspan="3">${escapeHtml(direccion)}</td></tr>
          <tr>
            <td style="width:50%"><span class="loc-label">Localidad:</span><span class="loc-value">${escapeHtml(localidad)}</span></td>
            <td style="width:50%"><span class="loc-label">Distrito:</span><span class="loc-value">${escapeHtml(distrito)}</span></td>
          </tr>
        </table>
      </section>
      <section class="actividad-section">
        <div class="section-title">2.0 Detalles de Orden de Trabajo</div>
        <table class="actividad-table"><tr><td class="loc-label">Actividad:</td><td class="loc-value" colspan="3">${escapeHtml(actividad)}</td></tr></table>
      </section>
      <section class="panel-fotografico">
        <div class="section-title">3.0 Panel Fotografico</div>
        <div class="photo-grid">${gridHtml}</div>
      </section>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { size: A4 portrait; margin: 0; background: #ffffff; }
    html, body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; font-size: 10px; line-height: 1.3; color: #222; background: #ffffff; width: 210mm; height: 297mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { width: 210mm; height: 297mm; max-height: 297mm; margin: 0 auto; padding: 8mm; background: #ffffff; display: flex; flex-direction: column; page-break-after: always; page-break-inside: avoid; box-sizing: border-box; overflow: hidden; }
    .page:last-child { page-break-after: auto; }
    .header { display: flex; justify-content: space-between; align-items: center; height: 20mm; padding-bottom: 4mm; border-bottom: 2px solid #333; margin-bottom: 3mm; flex-shrink: 0; }
    .header-logo { width: 55mm; height: 18mm; display: flex; align-items: center; justify-content: center; }
    .header-logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .header-logo-placeholder { font-size: 14px; font-weight: bold; color: #666; }
    .header-title { flex: 1; text-align: center; }
    .header-title h1 { font-size: 16px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #000; }
    .header-title .page-label { font-size: 9px; color: #777; margin-top: 2px; }
    .info-bar { display: flex; border: 1px solid #ccc; background: #f5f5f5; margin-bottom: 2mm; flex-shrink: 0; }
    .info-item { flex: 1; display: flex; align-items: center; padding: 1.5mm 2mm; border-right: 1px solid #ccc; gap: 1mm; white-space: nowrap; }
    .info-item:last-child { border-right: none; }
    .info-label { font-size: 9pt; font-weight: bold; text-transform: uppercase; color: #000; }
    .info-value { font-size: 9pt; font-weight: normal; color: #000; }
    .section-title { font-size: 10pt; font-weight: bold; color: #0066cc; text-transform: uppercase; margin-bottom: 3mm; padding-bottom: 3px; border-bottom: 1px solid #0066cc; flex-shrink: 0; }
    .localizacion { margin-bottom: 3mm; flex-shrink: 0; }
    .actividad-section { margin-bottom: 3mm; flex-shrink: 0; }
    .loc-table { width: 100%; border-collapse: collapse; }
    .loc-table td { padding: 1.5px 0; vertical-align: baseline; }
    .loc-label { font-size: 9pt; font-weight: bold; text-transform: uppercase; color: #000; white-space: nowrap; padding-right: 6px; }
    .loc-value { font-size: 9pt; color: #000; word-break: break-word; }
    .actividad-table { width: 100%; border-collapse: collapse; }
    .actividad-table td { padding: 1.5px 0; vertical-align: baseline; }
    .panel-fotografico { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    .photo-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 2mm; width: 100%; height: 100%; border: 1px solid #0066cc; padding: 2mm; flex: 1; min-height: 0; overflow: hidden; box-sizing: border-box; background: #ffffff; }
    .photo-cell { background: #ffffff; border: 1px solid #ddd; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; box-sizing: border-box; }
    .photo-cell img { max-width: 100%; max-height: 100%; object-fit: contain; object-position: center; display: block; }
    .photo-cell-photo-3 { grid-column: span 2; justify-self: center; width: calc(50% - 1mm); }
    .photo-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #999; font-size: 10px; font-style: italic; background: #ffffff; }
  </style>
</head>
<body>${pagesHtml}</body>
</html>`;
}

function normalizePhotoGridTemplate(sourceHtml: string): string {
  if (!sourceHtml || typeof sourceHtml !== 'string') return sourceHtml;
  if (!sourceHtml.includes('photo-cell-wrap')) return sourceHtml;
  if (sourceHtml.includes('photo-grid-compat-fix')) return sourceHtml;

  const compatCss = `
<style id="photo-grid-compat-fix">
  .photo-cell-wrap { display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; width: 100%; height: 100%; min-height: 0; padding: 1mm; box-sizing: border-box; overflow: hidden; }
  .photo-media { flex: 1 1 auto; min-height: 0; min-width: 0; width: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .photo-cell-wrap, .photo-media { position: relative; overflow: hidden; }
  .photo-media > img { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: contain; object-position: center; display: block; }
  .photo-cell-wrap > img { flex: 1 1 auto; min-height: 0; width: 100% !important; height: auto !important; max-height: 100%; object-fit: contain !important; object-position: center !important; display: block; }
  .photo-cell img { max-width: 100%; max-height: 100%; object-fit: contain; object-position: center; display: block; }
  .photo-label { flex-shrink: 0; font-weight: 700; font-size: 7.5pt; text-transform: uppercase; margin-top: 1mm; text-align: center; }
</style>`;

  if (/<\/head>/i.test(sourceHtml)) {
    return sourceHtml.replace(/<\/head>/i, `${compatCss}</head>`);
  }
  return `${compatCss}${sourceHtml}`;
}

function processJinja2Template(html: string, context: RenderContext): string {
  const { data, images, logoLeft, logoRight, customColumns = [] } = context;
  const imageCount = images.length;

  // Preparar reportData con mapeos estándar
  const reportData: TemplateData = {};
  const dateFieldKeys = ['fecha_corte', 'fecha-corte', 'fecha_trabajo', 'fecha-trabajo'];

  if (data) {
    Object.keys(data).forEach(key => {
      let value = data[key] || '-';
      if (dateFieldKeys.includes(key.toLowerCase())) {
        value = formatDateValue(value);
      }
      reportData[key.toUpperCase()] = value;
      reportData[key.toLowerCase()] = value;
      reportData[key] = value;

      const standardKeys: Record<string, string> = {
        centro: 'CENTRO', nis: 'NIS', ot: 'Nro OT',
        direccion: 'DIRECCION', localidad: 'LOCALIDAD', distrito: 'DISTRITO',
        estado: 'ESTADO', 'tipo-red': 'TIPO RED', sector: 'SECTOR',
        actividad: 'ACTIVIDAD', contrata: 'CONTRATA',
        subactividad: 'SUBACTIVIDAD', cuadrilla: 'CUADRILLA',
        'obs-sedapal': 'OBSERVACION SEDAPAL', 'obs-contrata': 'OBSERVACION CONTRATA',
        fecha_corte: 'FECHA CORTE', 'fecha-corte': 'FECHA CORTE',
        fecha_trabajo: 'FECHA_TRABAJO', 'fecha-trabajo': 'FECHA_TRABAJO',
        direcciones_afectadas: 'DIRECCIONES AFECTADAS', 'direcciones-afectadas': 'DIRECCIONES AFECTADAS',
        medidas_diametro: 'DIAMETRO', 'medidas-diametro': 'DIAMETRO',
        medidas_diametro_interno: 'DIAMETRO INTERNO', 'medidas-diametro-interno': 'DIAMETRO INTERNO',
        medidas_altura_util: 'ALTURA UTIL', 'medidas-altura-util': 'ALTURA UTIL',
        medidas_altura_total: 'ALTURA TOTAL', 'medidas-altura-total': 'ALTURA TOTAL',
      };
      if (standardKeys[key.toLowerCase()]) {
        reportData[standardKeys[key.toLowerCase()]] = value;
      }
    });

    customColumns.forEach(col => {
      if (data[col.id] !== undefined) {
        let value = data[col.id] || '-';
        const colNameUpper = col.name.toUpperCase();
        if (colNameUpper.includes('FECHA') || colNameUpper.includes('DATE')) {
          value = formatDateValue(value);
        }
        reportData[col.name] = value;
        reportData[col.name.toLowerCase()] = value;
      }
    });
  }

  // Reemplazar {{ panel_count }}
  const panelCount = Math.min(images.length, 4);
  html = html.replace(/\{\{\s*panel_count\s*\}\}/g, String(panelCount));
  html = html.replace(/\{%\s*set\s+panel_count\s*=[\s\S]*?%\}/g, '');

  // Procesar bloques if basados en conteo de imágenes (sin else primero)
  const imageCountIfOnlyRegex = /\{%\s*if\s+report\.images\|length\s*==\s*(\d+)\s*%\}((?:(?!\{%\s*else\s*%)\[\s\S\])*?)\{%\s*endif\s*%\}/g;
  html = html.replace(imageCountIfOnlyRegex, (match, count, content) =>
    imageCount === parseInt(count, 10) ? content : ''
  );

  const imageCountNotAndRegex = /\{%\s*if\s+report\.images\|length\s*!=\s*(\d+)\s+and\s+report\.images\|length\s*!=\s*(\d+)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
  html = html.replace(imageCountNotAndRegex, (match, count1, count2, content) =>
    (imageCount !== parseInt(count1, 10) && imageCount !== parseInt(count2, 10)) ? content : ''
  );

  // Procesar bloques if/elif/else
  const imageCountIfElifRegex = /\{%\s*if\s+report\.images\|length\s*==\s*(\d+)\s*%\}([\s\S]*?)\{%\s*elif\s+report\.images\|length\s*==\s*(\d+)\s*%\}([\s\S]*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
  html = html.replace(imageCountIfElifRegex, (match, count1, content1, count2, content2, elseContent) => {
    if (imageCount === parseInt(count1, 10)) return content1;
    if (imageCount === parseInt(count2, 10)) return content2;
    return elseContent;
  });

  const imageCountIfElseRegex = /\{%\s*if\s+report\.images\|length\s*==\s*(\d+)\s*%\}((?:(?!\{%\s*endif\s*%)\[\s\S\])*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
  html = html.replace(imageCountIfElseRegex, (match, count, ifContent, elseContent) =>
    imageCount === parseInt(count, 10) ? ifContent : elseContent
  );

  const imageCountGtElseRegex = /\{%\s*if\s+report\.images\|length\s*>\s*(\d+)\s*%\}([\s\S]*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
  html = html.replace(imageCountGtElseRegex, (match, count, ifContent, elseContent) =>
    imageCount > parseInt(count, 10) ? ifContent : elseContent
  );

  const imageCountGtRegex = /\{%\s*if\s+report\.images\|length\s*>\s*(\d+)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
  html = html.replace(imageCountGtRegex, (match, count, content) =>
    imageCount > parseInt(count, 10) ? content : ''
  );

  const imageCountGteElseRegex = /\{%\s*if\s+report\.images\|length\s*>=\s*(\d+)\s*%\}([\s\S]*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
  html = html.replace(imageCountGteElseRegex, (match, count, ifContent, elseContent) =>
    imageCount >= parseInt(count, 10) ? ifContent : elseContent
  );

  const imageCountGteRegex = /\{%\s*if\s+report\.images\|length\s*>=\s*(\d+)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
  html = html.replace(imageCountGteRegex, (match, count, content) =>
    imageCount >= parseInt(count, 10) ? content : ''
  );

  const imageCountLtRegex = /\{%\s*if\s+report\.images\|length\s*<\s*(\d+)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
  html = html.replace(imageCountLtRegex, (match, count, content) =>
    imageCount < parseInt(count, 10) ? content : ''
  );

  // img_count variable
  html = html.replace(/\{%\s*set\s+img_count\s*=\s*report\.images\|length\s*%\}/g, '');

  const imageCountVarIfElifRegex = /\{%\s*if\s+img_count\s*==\s*(\d+)\s*%\}([\s\S]*?)\{%\s*elif\s+img_count\s*==\s*(\d+)\s*%\}([\s\S]*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
  html = html.replace(imageCountVarIfElifRegex, (match, count1, content1, count2, content2, elseContent) => {
    if (imageCount === parseInt(count1, 10)) return content1;
    if (imageCount === parseInt(count2, 10)) return content2;
    return elseContent;
  });

  const imageCountVarIfElseRegex = /\{%\s*if\s+img_count\s*==\s*(\d+)\s*%\}([\s\S]*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
  html = html.replace(imageCountVarIfElseRegex, (match, count, ifContent, elseContent) =>
    imageCount === parseInt(count, 10) ? ifContent : elseContent
  );

  const imageCountVarIfOnlyRegex = /\{%\s*if\s+img_count\s*==\s*(\d+)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
  html = html.replace(imageCountVarIfOnlyRegex, (match, count, content) =>
    imageCount === parseInt(count, 10) ? content : ''
  );

  const imageCountInlineExprRegex = /\{\{\s*img_count\s+if\s+img_count\s+in\s+\[([^\]]+)\]\s+else\s+([^}]+?)\s*\}\}/g;
  html = html.replace(imageCountInlineExprRegex, (match, allowedRaw, fallbackRaw) => {
    const allowed = String(allowedRaw).split(',').map(v => parseInt(v.trim(), 10)).filter(v => Number.isFinite(v));
    const fallback = String(fallbackRaw).trim().replace(/^['"]|['"]$/g, '');
    return allowed.includes(imageCount) ? String(imageCount) : fallback;
  });

  // Procesar bloques de presencia de imágenes
  const photosIfRegex = /\{%\s*if\s+report\.images\s+and\s+report\.images\|length\s*>\s*0\s*%\}([\s\S]*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
  html = html.replace(photosIfRegex, (match, ifContent, elseContent) => imageCount > 0 ? ifContent : elseContent);

  const reportImagesIfElseRegex = /\{%\s*if\s+report\.images\s*%\}([\s\S]*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
  html = html.replace(reportImagesIfElseRegex, (match, ifContent, elseContent) => imageCount > 0 ? ifContent : elseContent);

  // Logos
  const logoLeftRegex = /\{%\s*if\s+logo_left\s*%\}([\s\S]*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
  html = html.replace(logoLeftRegex, (match, ifPart, elsePart) => logoLeft ? ifPart : elsePart);

  const logoRightRegex = /\{%\s*if\s+logo_right\s*%\}([\s\S]*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
  html = html.replace(logoRightRegex, (match, ifPart, elsePart) => logoRight ? ifPart : elsePart);

  const logoLeftNoElseRegex = /\{%\s*if\s+logo_left\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
  html = html.replace(logoLeftNoElseRegex, (match, content) => logoLeft ? content : '');

  const logoRightNoElseRegex = /\{%\s*if\s+logo_right\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
  html = html.replace(logoRightNoElseRegex, (match, content) => logoRight ? content : '');

  // Reemplazos simples
  const replacements: Record<string, string> = {
    '{{ title }}': 'PANEL FOTOGRÁFICO VOLANTEO',
    '{{ logo_left }}': logoLeft || EMPTY_PIXEL,
    '{{ logo_right }}': logoRight || EMPTY_PIXEL,
  };

  Object.keys(replacements).forEach(key => {
    html = html.replaceAll(key, replacements[key]);
  });

  // Reemplazar {{ report.data.get(...) }}
  let previousHtml = '';
  while (html !== previousHtml) {
    previousHtml = html;
    html = html.replace(/\{\{\s*report\.data\.get\(\s*'([^']+)'\s*,\s*([\s\S]+?)\s*\)\s*\}\}/g, (match, key, defBlock) => {
      const cleanKey = key.replace(/\s+/g, ' ').trim();
      if (reportData[cleanKey] && reportData[cleanKey] !== '-') {
        return String(reportData[cleanKey]);
      }
      let fallback = defBlock.trim();
      if ((fallback.startsWith("'") && fallback.endsWith("'")) || (fallback.startsWith('"') && fallback.endsWith('"'))) {
        fallback = fallback.substring(1, fallback.length - 1);
      }
      if (fallback.includes('report.data.get')) {
        return `{{ ${fallback} }}`;
      }
      return fallback;
    });
  }

  // Imágenes por índice directo
  const directImageRegex = /\{\{\s*report\.images\[(\d+)\]\.(path|name)\s*\}\}/g;
  html = html.replace(directImageRegex, (match, indexStr, property) => {
    const index = parseInt(indexStr);
    if (images && images[index]) {
      if (property === 'path') return images[index].url;
      if (property === 'name') return images[index].file.name;
    }
    return '';
  });

  // Loops de imágenes
  const loopRegex = /\{%\s*for\s+img\s+in\s+report\.images.*?\s*%\}([\s\S]*?)\{%\s*endfor\s*%\}/g;
  let loopIndex = 0;
  const matches = [...html.matchAll(loopRegex)];

  for (const match of matches) {
    const fullMatch = match[0];
    const loopContent = match[1];
    const limitMatch = match[0].match(/\[:(\d+)\]/);
    const limit = limitMatch ? parseInt(limitMatch[1]) : images.length;

    const suffixMatch = fullMatch.match(/'_(\d+)\.'\s+in\s+img\.name/) || loopContent.match(/'_(\d+)\.'\s+in\s+img\.name/);

    let generatedLoopHtml = '';
    let imagesToRender: PreviewImage[] = [];

    if (suffixMatch) {
      const targetSuffix = `_${suffixMatch[1]}.`;
      const matchingImage = images.find(img => img.file.name.includes(targetSuffix));
      if (matchingImage) {
        imagesToRender = [matchingImage];
      } else if (loopIndex < images.length) {
        imagesToRender = [images[loopIndex]];
      }
    } else {
      imagesToRender = images.slice(0, limit);
    }

    for (let i = 0; i < imagesToRender.length; i++) {
      const img = imagesToRender[i];
      let itemHtml = loopContent;
      itemHtml = itemHtml.replaceAll('{{ img.path }}', img.url);
      itemHtml = itemHtml.replaceAll('{{ img.name }}', img.file.name);
      const dateStr = new Date(img.file.lastModified).toLocaleString();
      itemHtml = itemHtml.replace(/\{\{\s*img\.date.*\}\}/g, dateStr);
      itemHtml = itemHtml.replace(/\{\{\s*img\.coords.*\}\}/g, '');
      itemHtml = itemHtml.replaceAll('{{ loop.index }}', String(i + 1));
      itemHtml = itemHtml.replace(/\{%\s*if\s+loop\.first\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, (m, c) => i === 0 ? c : '');
      itemHtml = itemHtml.replace(/\{%\s*if\s+not\s+ns\.found\s+and\s+'_\d+\.'\s+in\s+img\.name\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, '$1');
      itemHtml = itemHtml.replace(/\{%\s*set\s+ns\.found\s*=\s*true\s*%\}/g, '');
      generatedLoopHtml += itemHtml;
    }

    html = html.replace(fullMatch, generatedLoopHtml);
    loopIndex++;
  }

  // Remover loops externos (report_list)
  html = html.replace(/\{%\s*for\s+report\s+in\s+.*%\}/g, '');

  // Range loops
  const rangeRegex = /\{%\s*for\s+i\s+in\s+range\(report\.images\|length,\s*(\d+)\)\s*%\}([\s\S]*?)(?:\{%\s*endfor\s*%\}|$)/g;
  html = html.replace(rangeRegex, (match, max, content) => {
    const remaining = parseInt(max) - images.length;
    if (remaining <= 0) return '';
    return content.repeat(remaining);
  });

  // Limpiar tags Jinja2 restantes
  html = html.replace(/\{%\s*[\s\S]*?\s*%\}/g, '');
  html = html.replace(/\{#.*?#\}/g, '');

  // Remover placeholders "Sin imagen" cuando hay imágenes
  if (images.length > 0) {
    html = html.replace(/<div class="photo-placeholder">Sin imagen<\/div>/g, '');
    html = html.replace(/<div class="photo-placeholder">\s*Sin imagen\s*<\/div>/g, '');
  }

  return html;
}

export function renderTemplate(
  templateName: string,
  templateContent: string,
  context: RenderContext
): string {
  if (isMaquinaBaldeTemplate(templateName)) {
    return buildMaquinaBaldePreviewHtml(context.data, context.images, context.logoLeft || '', context.logoRight || '');
  }

  if (isMaqBaldeTemplate(templateName)) {
    return buildMaqBaldePreviewHtml(context.data, context.images, context.logoLeft || '', context.logoRight || '');
  }

  let html = normalizePhotoGridTemplate(templateContent);
  html = processJinja2Template(html, context);
  return html;
}
