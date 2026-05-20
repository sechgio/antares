import { forwardRef, useEffect, useRef, useState } from 'react';
import { formatDateValue, escapeHtml, normalizePreviewValue, chunkItems } from './utils';
import { TEMPLATE_KEY_MAP } from './constants';

interface PreviewPanelProps {
  data?: Record<string, unknown> | null;
  images?: File[];
  mappings?: Record<string, string>;
  logoLeft?: string | null;
  logoRight?: string | null;
  customTemplate?: { name: string; content: string } | null;
  customColumns?: Array<{ id: string; name: string; mappedTo?: string }>;
  isFocusMode?: boolean;
}

export interface RenderPreviewHtmlOptions {
  data?: Record<string, unknown> | null;
  images?: File[];
  imageUrls?: string[];
  mappings?: Record<string, string>;
  logoLeft?: string | null;
  logoRight?: string | null;
  customTemplate?: { name: string; content: string } | null;
  customColumns?: Array<{ id: string; name: string; mappedTo?: string }>;
}

const EMPTY_PIXEL = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E";

/** Nombres exactos de templates con layout A4 fijo.
 *  Si se agrega un nuevo template que requiera comportamiento especial de preview,
 *  registrarlo aquí en lugar de hardcodear strings dispersos en el componente.
 */
const KNOWN_TEMPLATES = {
  maqBalde: 'maq balde sjl.html',
  maquinaBalde: 'maquina-balde.html',
  reportVolanteo: 'report_volanteo.html',
} as const;

function isMaquinaBaldeTemplate(template?: { name?: string } | null): boolean {
  if (!template) return false;
  const normalized = String(template.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return normalized === KNOWN_TEMPLATES.maquinaBalde || normalized.includes('maquina-balde');
}

function isMaqBaldeTemplate(template?: { name?: string; content?: string } | null): boolean {
  if (!template) return false;
  if (isMaquinaBaldeTemplate(template)) return false;
  const normalized = String(template.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalized === KNOWN_TEMPLATES.maqBalde || normalized.includes('maq balde sjl')) return true;
  const content = String(template.content || '').toLowerCase();
  return content.includes("row.get('titulo'") || content.includes("row.get('direcciones_afectadas'") || content.includes('photo-cell-photo-3');
}

function isFixedA4TemplatePreview(template?: { name?: string } | null): boolean {
  return template?.name === KNOWN_TEMPLATES.reportVolanteo || isMaqBaldeTemplate(template) || isMaquinaBaldeTemplate(template);
}

function normalizePhotoGridTemplate(sourceHtml: string): string {
  if (!sourceHtml || !sourceHtml.includes('photo-cell-wrap')) return sourceHtml;
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

function buildMaqBaldePreviewHtml(
  reportData: Record<string, unknown>,
  imageFiles: File[],
  imageUrls: string[],
  leftLogo: string,
  rightLogo: string
): string {
  const pickValue = (...candidates: Array<unknown>): string => {
    for (const candidate of candidates) {
      const normalized = normalizePreviewValue(candidate, '');
      if (normalized && normalized !== '-') return normalized;
    }
    return '-';
  };

  const title = pickValue(reportData.titulo, reportData.TITULO, 'PANEL FOTOGRAFICO');
  const centro = pickValue(reportData.CENTRO, reportData.cs, reportData.centro_servicio, reportData.centro);
  const fechaTrabajo = pickValue(
    reportData.FECHA_TRABAJO, reportData['FECHA DE TRABAJO'], reportData['Fecha de Trabajo'],
    reportData.fecha, reportData.fecha_trabajo, reportData['FECHA CORTE'],
    reportData.FECHA_CORTE, reportData.fecha_corte, reportData['FECHA-CORTE'],
  );
  const estado = pickValue(reportData.ESTADO, reportData.estado);
  const direcciones = pickValue(
    reportData.DIRECCIONES_AFECTADAS, reportData['DIRECCIONES AFECTADAS'],
    reportData.direcciones, reportData.direccion, reportData.DIRECCION, reportData.ubicacion,
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
      : [...pageImages, ...Array.from({ length: Math.max(0, 4 - pageImages.length) }, () => null as File | null)];

    const gridHtml = slots.map((img, slotIndex) => {
      const extraClass = pageImages.length === 3 && slotIndex === 2 ? ' photo-cell-photo-3' : '';
      if (!img) return `<div class="photo-cell${extraClass}"><div class="photo-placeholder">Sin imagen</div></div>`;
      const idx = imageFiles.indexOf(img);
      const imgUrl = imageUrls[idx] || EMPTY_PIXEL;
      const altText = img.name || `Foto ${slotIndex + 1}`;
      return `<div class="photo-cell${extraClass}"><img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(altText)}"></div>`;
    }).join('');

    return `
    <div class="page">
      <header class="header">
        <div class="header-logo">${leftLogo ? `<img src="${escapeHtml(leftLogo)}" alt="Logo Izquierdo">` : '<span class="header-logo-placeholder"></span>'}</div>
        <div class="header-title"><h1>${escapeHtml(title)}</h1>${pageLabel}</div>
        <div class="header-logo">${rightLogo ? `<img src="${escapeHtml(rightLogo)}" alt="Logo Derecho">` : '<span class="header-logo-placeholder"></span>'}</div>
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
          <tr><td class="loc-label">Actividad:</td><td class="loc-value">${escapeHtml(actividad)}</td><td class="loc-label" style="padding-left:8px">Cuadrilla:</td><td class="loc-value">${escapeHtml(cuadrilla)}</td></tr>
        </table>
      </section>
      <section class="panel-fotografico">
        <div class="section-title">3.0 Panel Fotografico</div>
        <div class="photo-grid">${gridHtml}</div>
      </section>
    </div>`;
  }).join('');

  return getFixedA4Wrapper(escapeHtml(title), pagesHtml);
}

function buildMaquinaBaldePreviewHtml(
  reportData: Record<string, unknown>,
  imageFiles: File[],
  imageUrls: string[],
  leftLogo: string,
  rightLogo: string
): string {
  const pickValue = (...candidates: Array<unknown>): string => {
    for (const candidate of candidates) {
      const normalized = normalizePreviewValue(candidate, '');
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
      : [...pageImages, ...Array.from({ length: Math.max(0, 4 - pageImages.length) }, () => null as File | null)];

    const gridHtml = slots.map((img, slotIndex) => {
      const extraClass = pageImages.length === 3 && slotIndex === 2 ? ' photo-cell-photo-3' : '';
      if (!img) return `<div class="photo-cell${extraClass}"><div class="photo-placeholder">Sin imagen</div></div>`;
      const idx = imageFiles.indexOf(img);
      const imgUrl = imageUrls[idx] || EMPTY_PIXEL;
      const altText = img.name || `Foto ${slotIndex + 1}`;
      return `<div class="photo-cell${extraClass}"><img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(altText)}"></div>`;
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
          <tr><td style="width:50%"><span class="loc-label">Localidad:</span><span class="loc-value">${escapeHtml(localidad)}</span></td><td style="width:50%"><span class="loc-label">Distrito:</span><span class="loc-value">${escapeHtml(distrito)}</span></td></tr>
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

  return getFixedA4Wrapper(escapeHtml(title), pagesHtml);
}

function getFixedA4Wrapper(title: string, pagesHtml: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
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

function processJinja2Template(
  html: string,
  data: Record<string, unknown> | null | undefined,
  images: File[],
  imageUrls: string[],
  logoLeft: string,
  logoRight: string,
  mappings: Record<string, string>,
  customColumns: Array<{ id: string; name: string }>
): string {
  const imageCount = images.length;

  const reportData: Record<string, string> = {};
  if (data && mappings) {
    Object.keys(mappings).forEach(key => {
      let value = String(data[mappings[key]] ?? '-');
      if (['fecha_corte', 'fecha-corte', 'fecha_trabajo', 'fecha-trabajo'].includes(key)) {
        value = formatDateValue(value);
      }
      reportData[key.toUpperCase()] = value;
      reportData[key] = value;
      if (TEMPLATE_KEY_MAP[key]) {
        reportData[TEMPLATE_KEY_MAP[key]] = value;
      }
    });

    customColumns.forEach(col => {
      if (mappings[col.id] !== undefined) {
        let value = String(data[mappings[col.id]] ?? '-');
        if (col.name.toUpperCase().includes('FECHA') || col.name.toUpperCase().includes('DATE')) {
          value = formatDateValue(value);
        }
        reportData[col.name] = value;
        reportData[col.name.toLowerCase()] = value;
      }
    });
  }

  const panelCount = Math.min(images.length, 4);
  html = html.replace(/\{\{\s*panel_count\s*\}\}/g, String(panelCount));
  html = html.replace(/\{%\s*set\s+panel_count\s*=[\s\S]*?%\}/g, '');

  const processIfBlocks = () => {
    const patterns = [
      { regex: /\{%\s*if\s+report\.images\|length\s*==\s*(\d+)\s*%\}((?:(?!\{%\s*else\s*%)[\s\S])*?)\{%\s*endif\s*%\}/g, handler: (_m: string, count: string, content: string) => imageCount === parseInt(count, 10) ? content : '' },
      { regex: /\{%\s*if\s+report\.images\|length\s*!=\s*(\d+)\s+and\s+report\.images\|length\s*!=\s*(\d+)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, handler: (_m: string, c1: string, c2: string, content: string) => (imageCount !== parseInt(c1, 10) && imageCount !== parseInt(c2, 10)) ? content : '' },
      { regex: /\{%\s*if\s+report\.images\|length\s*==\s*(\d+)\s*%\}([\s\S]*?)\{%\s*elif\s+report\.images\|length\s*==\s*(\d+)\s*%\}([\s\S]*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, handler: (_m: string, c1: string, content1: string, c2: string, content2: string, elseContent: string) => { if (imageCount === parseInt(c1, 10)) return content1; if (imageCount === parseInt(c2, 10)) return content2; return elseContent; } },
      { regex: /\{%\s*if\s+report\.images\|length\s*==\s*(\d+)\s*%\}((?:(?!\{%\s*endif\s*%)[\s\S])*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, handler: (_m: string, count: string, ifContent: string, elseContent: string) => imageCount === parseInt(count, 10) ? ifContent : elseContent },
      { regex: /\{%\s*if\s+report\.images\|length\s*>\s*(\d+)\s*%\}([\s\S]*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, handler: (_m: string, count: string, ifContent: string, elseContent: string) => imageCount > parseInt(count, 10) ? ifContent : elseContent },
      { regex: /\{%\s*if\s+report\.images\|length\s*>\s*(\d+)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, handler: (_m: string, count: string, content: string) => imageCount > parseInt(count, 10) ? content : '' },
      { regex: /\{%\s*if\s+report\.images\|length\s*>=\s*(\d+)\s*%\}([\s\S]*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, handler: (_m: string, count: string, ifContent: string, elseContent: string) => imageCount >= parseInt(count, 10) ? ifContent : elseContent },
      { regex: /\{%\s*if\s+report\.images\|length\s*>=\s*(\d+)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, handler: (_m: string, count: string, content: string) => imageCount >= parseInt(count, 10) ? content : '' },
      { regex: /\{%\s*if\s+report\.images\|length\s*<\s*(\d+)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, handler: (_m: string, count: string, content: string) => imageCount < parseInt(count, 10) ? content : '' },
    ];

    patterns.forEach(({ regex, handler }) => {
      html = html.replace(regex, handler as (...args: string[]) => string);
    });
  };
  processIfBlocks();

  html = html.replace(/\{%\s*set\s+img_count\s*=\s*report\.images\|length\s*%\}/g, '');
  const imgCountPatterns = [
    { regex: /\{%\s*if\s+img_count\s*==\s*(\d+)\s*%\}([\s\S]*?)\{%\s*elif\s+img_count\s*==\s*(\d+)\s*%\}([\s\S]*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, handler: (_m: string, c1: string, content1: string, c2: string, content2: string, elseContent: string) => { if (imageCount === parseInt(c1, 10)) return content1; if (imageCount === parseInt(c2, 10)) return content2; return elseContent; } },
    { regex: /\{%\s*if\s+img_count\s*==\s*(\d+)\s*%\}([\s\S]*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, handler: (_m: string, count: string, ifContent: string, elseContent: string) => imageCount === parseInt(count, 10) ? ifContent : elseContent },
    { regex: /\{%\s*if\s+img_count\s*==\s*(\d+)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, handler: (_m: string, count: string, content: string) => imageCount === parseInt(count, 10) ? content : '' },
    { regex: /\{\{\s*img_count\s+if\s+img_count\s+in\s+\[([^\]]+)\]\s+else\s+([^}]+?)\s*\}\}/g, handler: (_m: string, allowedRaw: string, fallbackRaw: string) => { const allowed = allowedRaw.split(',').map(v => parseInt(v.trim(), 10)).filter(Number.isFinite); const fallback = fallbackRaw.trim().replace(/^['"]|['"]$/g, ''); return allowed.includes(imageCount) ? String(imageCount) : fallback; } },
  ];
  imgCountPatterns.forEach(({ regex, handler }) => {
    html = html.replace(regex, handler as (...args: string[]) => string);
  });

  html = html.replace(/\{%\s*if\s+report\.images\s+and\s+report\.images\|length\s*>\s*0\s*%\}([\s\S]*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, (_m, ifContent, elseContent) => imageCount > 0 ? ifContent : elseContent);
  html = html.replace(/\{%\s*if\s+report\.images\s*%\}([\s\S]*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, (_m, ifContent, elseContent) => imageCount > 0 ? ifContent : elseContent);

  html = html.replace(/\{%\s*if\s+logo_left\s*%\}([\s\S]*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, (_m, ifPart, elsePart) => logoLeft ? ifPart : elsePart);
  html = html.replace(/\{%\s*if\s+logo_right\s*%\}([\s\S]*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, (_m, ifPart, elsePart) => logoRight ? ifPart : elsePart);
  html = html.replace(/\{%\s*if\s+logo_left\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, (_m, content) => logoLeft ? content : '');
  html = html.replace(/\{%\s*if\s+logo_right\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, (_m, content) => logoRight ? content : '');

  html = html.split('{{ title }}').join('PANEL FOTOGRÁFICO VOLANTEO');
  html = html.split('{{ logo_left }}').join(logoLeft || EMPTY_PIXEL);
  html = html.split('{{ logo_right }}').join(logoRight || EMPTY_PIXEL);

  let prev = '';
  while (html !== prev) {
    prev = html;
    html = html.replace(/\{\{\s*report\.data\.get\(\s*'([^']+)'\s*,\s*([\s\S]+?)\s*\)\s*\}\}/g, (_m, key, defBlock) => {
      const cleanKey = key.replace(/\s+/g, ' ').trim();
      if (reportData[cleanKey] && reportData[cleanKey] !== '-') return reportData[cleanKey];
      let fallback = defBlock.trim();
      if ((fallback.startsWith("'") && fallback.endsWith("'")) || (fallback.startsWith('"') && fallback.endsWith('"'))) {
        fallback = fallback.slice(1, -1);
      }
      if (fallback.includes('report.data.get')) return `{{ ${fallback} }}`;
      return fallback;
    });
  }

  html = html.replace(/\{\{\s*report\.images\[(\d+)\]\.(path|name)\s*\}\}/g, (_m, idxStr, prop) => {
    const idx = parseInt(idxStr);
    if (images[idx]) {
      if (prop === 'path') return imageUrls[idx] || '';
      if (prop === 'name') return images[idx].name;
    }
    return '';
  });

  const loopRegex = /\{%\s*for\s+img\s+in\s+report\.images.*?\s*%\}([\s\S]*?)\{%\s*endfor\s*%\}/g;
  let loopIdx = 0;
  const matches = [...html.matchAll(loopRegex)];

  for (const match of matches) {
    const fullMatch = match[0];
    const loopContent = match[1];
    const limitMatch = fullMatch.match(/\[:(\d+)\]/);
    const limit = limitMatch ? parseInt(limitMatch[1]) : images.length;
    const suffixMatch = fullMatch.match(/'_(\d+)\.'\s+in\s+img\.name/) || loopContent.match(/'_(\d+)\.'\s+in\s+img\.name/);

    let generated = '';
    let toRender: File[] = [];

    if (suffixMatch) {
      const targetSuffix = `_${suffixMatch[1]}.`;
      const matching = images.find(img => img.name.includes(targetSuffix));
      toRender = matching ? [matching] : loopIdx < images.length ? [images[loopIdx]] : [];
    } else {
      toRender = images.slice(0, limit);
    }

    for (let i = 0; i < toRender.length; i++) {
      const img = toRender[i];
      const imgIdx = images.indexOf(img);
      let item = loopContent;
      item = item.split('{{ img.path }}').join(imageUrls[imgIdx] || '');
      item = item.split('{{ img.name }}').join(img.name);
      item = item.replace(/\{\{\s*img\.date.*\}\}/g, new Date(img.lastModified).toLocaleString());
      item = item.replace(/\{\{\s*img\.coords.*\}\}/g, '');
      item = item.split('{{ loop.index }}').join(String(i + 1));
      item = item.replace(/\{%\s*if\s+loop\.first\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, (_mm, c) => i === 0 ? c : '');
      item = item.replace(/\{%\s*if\s+not\s+ns\.found\s+and\s+'_\d+\.'\s+in\s+img\.name\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, '$1');
      item = item.replace(/\{%\s*set\s+ns\.found\s*=\s*true\s*%\}/g, '');
      generated += item;
    }

    html = html.replace(fullMatch, generated);
    loopIdx++;
  }

  html = html.replace(/\{%\s*for\s+report\s+in\s+.*%\}/g, '');

  html = html.replace(/\{%\s*for\s+i\s+in\s+range\(report\.images\|length,\s*(\d+)\)\s*%\}([\s\S]*?)(?:\{%\s*endfor\s*%\}|$)/g, (_m, max, content) => {
    const remaining = parseInt(max) - images.length;
    return remaining > 0 ? content.repeat(remaining) : '';
  });

  html = html.replace(/\{%\s*[\s\S]*?\s*%\}/g, '');
  html = html.replace(/\{#.*?#\}/g, '');

  if (images.length > 0) {
    html = html.replace(/<div class="photo-placeholder">\s*Sin imagen\s*<\/div>/g, '');
  }

  return html;
}

function renderCustomTemplate(
  template: { name: string; content: string },
  data: Record<string, unknown> | null | undefined,
  images: File[],
  imageUrls: string[],
  logoLeft: string,
  logoRight: string,
  mappings: Record<string, string>,
  customColumns: Array<{ id: string; name: string }>
): string {
  if (isMaquinaBaldeTemplate(template)) {
    return buildMaquinaBaldePreviewHtml(data || {}, images, imageUrls, logoLeft, logoRight);
  }
  if (isMaqBaldeTemplate(template)) {
    return buildMaqBaldePreviewHtml(data || {}, images, imageUrls, logoLeft, logoRight);
  }

  let html = normalizePhotoGridTemplate(template.content);
  html = processJinja2Template(html, data, images, imageUrls, logoLeft, logoRight, mappings, customColumns);
  return html;
}

function renderDefaultPreview(
  data: Record<string, unknown> | null | undefined,
  images: File[],
  imageUrls: string[],
  logoLeft: string,
  logoRight: string,
  mappings: Record<string, string>
): string {
  const getValue = (fieldId: string, isDate = false): string => {
    if (!data || !mappings[fieldId]) return '-';
    const val = data[mappings[fieldId]];
    return isDate ? formatDateValue(val as string | number) : String(val ?? '-');
  };

  const imgCount = images.length;

  let photoGridClass = 'layout-grid';
  if (imgCount === 1) photoGridClass = 'layout-1';
  else if (imgCount === 2) photoGridClass = 'layout-2';
  else if (imgCount === 3) photoGridClass = 'layout-3';
  else if (imgCount === 4) photoGridClass = 'layout-4';
  else if (imgCount === 5) photoGridClass = 'layout-5';
  else if (imgCount === 6) photoGridClass = 'layout-6';

  const photoItems = images.map((img, idx) => {
    return `<div class="photo-item"><img src="${escapeHtml(imageUrls[idx] || '')}" alt="${escapeHtml(img.name)}"></div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
@page { size: A4 portrait; margin: 0; }
html, body { width: 210mm; height: 297mm; margin: 0; padding: 0; overflow: hidden; background: #fff; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 8pt; color: #222; line-height: 1.15; }
.page { width: 210mm; height: 297mm; margin: 0 auto; padding: 8mm; box-sizing: border-box; background: #fff; display: flex; flex-direction: column; page-break-after: always; page-break-inside: avoid; overflow: hidden; }
.header { display: flex; justify-content: space-between; align-items: center; height: 20mm; border-bottom: 1.5px solid #ddd; margin-bottom: 2mm; flex-shrink: 0; }
.logo { width: 55mm; height: 18mm; display: flex; align-items: center; }
.logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
.title { flex: 1; text-align: center; font-size: 13pt; font-weight: 700; text-transform: uppercase; color: #333; }
.info-bar { display: flex; justify-content: space-between; background: #f5f5f5; border: 1px solid #ddd; padding: 1.5mm 3mm; margin-bottom: 2mm; font-size: 7.5pt; flex-shrink: 0; }
.info-item { display: flex; gap: 1mm; }
.info-label { font-weight: 700; color: #555; }
.section-title { font-size: 7.5pt; color: #0056b3; font-weight: 700; text-transform: uppercase; border-bottom: 1px solid #0056b3; padding-bottom: 0.5mm; margin: 1.5mm 0 1mm 0; flex-shrink: 0; }
.grid-6 { display: grid; grid-template-columns: auto 1fr auto 1fr auto 1fr; gap: 1mm 2mm; margin-bottom: 1.5mm; flex-shrink: 0; }
.grid-4 { display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 1mm 2mm; margin-bottom: 1.5mm; flex-shrink: 0; }
.lbl { font-weight: 600; text-align: right; font-size: 6.5pt; color: #555; white-space: nowrap; align-self: center; }
.val { border: 1px dotted #888; background: #fefefe; padding: 0.8mm 1.5mm; font-size: 7pt; min-height: 4mm; display: flex; align-items: center; }
.span3 { grid-column: span 3; }
.photo-section { flex: 1; border: 2px solid #333; padding: 2mm; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.photo-grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 2mm; width: 100%; height: 100%; }
.photo-item { border: 1px solid #ddd; background: #fff; display: flex; align-items: center; justify-content: center; overflow: hidden; height: 7cm; padding: 2mm; }
.photo-item img { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; display: block; }
.layout-1 { grid-template-columns: 1fr; grid-template-rows: 1fr; justify-items: center; align-items: center; }
.layout-1 .photo-item { height: 100%; max-width: 70%; }
.layout-2 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr; align-items: stretch; }
.layout-2 .photo-item { height: 100%; }
.layout-3 { display: flex; flex-direction: column; gap: 2mm; width: 100%; height: 100%; }
.layout-3 .top-row { display: flex; flex-direction: row; gap: 2mm; height: calc(50% - 1mm); }
.layout-3 .top-row .photo-item { flex: 1; height: 100%; }
.layout-3 .bottom-row { display: flex; justify-content: center; height: calc(50% - 1mm); }
.layout-3 .bottom-row .photo-item { width: calc(50% - 1mm); height: 100%; }
.layout-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; align-items: stretch; }
.layout-4 .photo-item { height: 100%; }
.layout-5 { display: flex; flex-direction: column; gap: 2mm; width: 100%; height: 100%; }
.layout-5 .photo-row { display: flex; flex-direction: row; gap: 2mm; height: calc(33.333% - 1.33mm); }
.layout-5 .photo-row .photo-item { flex: 1; height: 100%; }
.layout-5 .photo-row-center { display: flex; justify-content: center; height: calc(33.333% - 1.33mm); }
.layout-5 .photo-row-center .photo-item { width: calc(50% - 1mm); height: 100%; }
.layout-6 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr 1fr; align-items: stretch; }
.layout-6 .photo-item { height: 100%; }
.layout-grid { grid-template-columns: 1fr 1fr; grid-auto-rows: 7cm; }
.no-photos { flex: 1; display: flex; align-items: center; justify-content: center; border: 1px dashed #ccc; color: #999; font-style: italic; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="logo">${logoLeft ? `<img src="${escapeHtml(logoLeft)}" alt="Logo">` : '<svg width="100%" height="100%" viewBox="0 0 200 60"></svg>'}</div>
    <div class="title">PANEL FOTOGRÁFICO</div>
    <div class="logo" style="justify-content:flex-end">${logoRight ? `<img src="${escapeHtml(logoRight)}" alt="Logo">` : '<svg width="100%" height="100%" viewBox="0 0 140 50"></svg>'}</div>
  </div>
  <div class="info-bar">
    <div class="info-item"><span class="info-label">CENTRO DE SERVICIOS:</span> ${escapeHtml(getValue('centro'))}</div>
    <div class="info-item"><span class="info-label">NIS:</span> ${escapeHtml(getValue('nis'))}</div>
    <div class="info-item"><span class="info-label">Nro OT:</span> ${escapeHtml(getValue('ot'))}</div>
  </div>
  <div class="section-title">1.0 LOCALIZACIÓN</div>
  <div class="grid-6">
    <span class="lbl">DIRECCION:</span><div class="val">${escapeHtml(getValue('direccion'))}</div>
    <span class="lbl">LOCALIDAD:</span><div class="val">${escapeHtml(getValue('localidad'))}</div>
    <span class="lbl">DISTRITO:</span><div class="val">${escapeHtml(getValue('distrito'))}</div>
    <span class="lbl">ESTADO:</span><div class="val">${escapeHtml(getValue('estado'))}</div>
    <span class="lbl">TIPO RED:</span><div class="val">${escapeHtml(getValue('tipo-red'))}</div>
    <span class="lbl">SECTOR:</span><div class="val">${escapeHtml(getValue('sector'))}</div>
  </div>
  <div class="section-title">2.0 DETALLES DE ORDEN DE TRABAJO</div>
  <div class="grid-4">
    <span class="lbl">ACTIVIDAD:</span><div class="val">${escapeHtml(getValue('actividad'))}</div>
    <span class="lbl">CONTRATA:</span><div class="val">${escapeHtml(getValue('contrata'))}</div>
    <span class="lbl">SUBACTIVIDAD:</span><div class="val">${escapeHtml(getValue('subactividad'))}</div>
    <span class="lbl">CUADRILLA:</span><div class="val">${escapeHtml(getValue('cuadrilla'))}</div>
    <span class="lbl">OBS. SEDAPAL:</span><div class="val span3">${escapeHtml(getValue('obs-sedapal'))}</div>
    <span class="lbl">OBS. CONTRATA:</span><div class="val span3">${escapeHtml(getValue('obs-contrata'))}</div>
  </div>
  <div class="section-title">3.0 PANEL FOTOGRÁFICO</div>
  <div class="photo-section">
    ${imgCount > 0
      ? (imgCount === 3
        ? `<div class="photo-grid layout-3">
            <div class="top-row">
              <div class="photo-item"><img src="${escapeHtml(imageUrls[0] || '')}" alt="${escapeHtml(images[0]?.name || '')}"></div>
              <div class="photo-item"><img src="${escapeHtml(imageUrls[1] || '')}" alt="${escapeHtml(images[1]?.name || '')}"></div>
            </div>
            <div class="bottom-row">
              <div class="photo-item"><img src="${escapeHtml(imageUrls[2] || '')}" alt="${escapeHtml(images[2]?.name || '')}"></div>
            </div>
           </div>`
        : `<div class="photo-grid ${photoGridClass}">${photoItems}</div>`)
      : '<div class="no-photos">No se encontraron imágenes asociadas a esta orden.</div>'}
  </div>
</div>
</body>
</html>`;
}

export function renderPreviewHtml({
  data,
  images = [],
  imageUrls = [],
  mappings = {},
  logoLeft = null,
  logoRight = null,
  customTemplate = null,
  customColumns = [],
}: RenderPreviewHtmlOptions): string {
  const leftLogo = logoLeft || '';
  const rightLogo = logoRight || '';

  if (customTemplate) {
    return renderCustomTemplate(
      customTemplate, data, images, imageUrls, leftLogo, rightLogo, mappings,
      customColumns.map(c => ({ id: c.id, name: c.name }))
    );
  }

  return renderDefaultPreview(data, images, imageUrls, leftLogo, rightLogo, mappings);
}

const PreviewPanel = forwardRef<HTMLIFrameElement, PreviewPanelProps>(
  ({ data, images = [], mappings = {}, logoLeft = null, logoRight = null, customTemplate = null, customColumns = [], isFocusMode = false }, ref) => {
    const [renderedHtml, setRenderedHtml] = useState('');
    const [imageUrls, setImageUrls] = useState<string[]>([]);
    const templateObjUrlsRef = useRef<string[]>([]);

    useEffect(() => {
      if (!images || images.length === 0) {
        setImageUrls([]);
        return;
      }
      const urls = images.map(img => URL.createObjectURL(img));
      setImageUrls(urls);
      return () => urls.forEach(url => URL.revokeObjectURL(url));
    }, [images]);

    useEffect(() => {
      // Revoke old template object URLs
      templateObjUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      templateObjUrlsRef.current = [];

      const leftLogo = logoLeft || '';
      const rightLogo = logoRight || '';

      setRenderedHtml(renderPreviewHtml({
        data,
        images,
        imageUrls,
        mappings,
        logoLeft: leftLogo,
        logoRight: rightLogo,
        customTemplate,
        customColumns,
      }));

      return () => {
        templateObjUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
        templateObjUrlsRef.current = [];
      };
    }, [customTemplate, data, images, imageUrls, logoLeft, logoRight, mappings, customColumns]);

    const handleIframeLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
      const iframe = e.currentTarget;
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc?.body) {
          if (isFixedA4TemplatePreview(customTemplate)) {
            iframe.style.width = '210mm';
            iframe.style.height = '297mm';
            iframe.style.overflow = 'hidden';
            iframe.setAttribute('scrolling', 'no');
            doc.documentElement.style.overflow = 'hidden';
            doc.body.style.overflow = 'hidden';
            return;
          }
          setTimeout(() => {
            const h = doc.documentElement.scrollHeight || doc.body.scrollHeight;
            iframe.style.height = Math.max(h, 1122) + 'px';
          }, 150);
        }
      } catch {
        // cross-origin
      }
    };

    const bgClass = isFocusMode ? 'bg-[var(--bg-elevated)]' : 'bg-[var(--bg-base)]';

    if (!renderedHtml) {
      return (
        <div className={`flex-1 p-4 overflow-auto flex justify-center items-start ${bgClass}`}>
          <div className="text-[var(--text-muted)] text-sm">Seleccione datos y una plantilla para ver la vista previa</div>
        </div>
      );
    }

    return (
      <div className={`flex-1 p-4 overflow-auto flex justify-center items-start ${bgClass}`}>
        <iframe
          ref={ref}
          srcDoc={renderedHtml}
          sandbox="allow-same-origin"
          title="Vista previa de plantilla"
          className="bg-white text-black shadow-2xl"
          scrolling={isFixedA4TemplatePreview(customTemplate) ? 'no' : undefined}
          onLoad={handleIframeLoad}
          style={{
            width: '210mm',
            height: isFixedA4TemplatePreview(customTemplate) ? '297mm' : 'auto',
            minHeight: '297mm',
            border: 'none',
            display: 'block',
            flexShrink: 0,
            overflow: isFixedA4TemplatePreview(customTemplate) ? 'hidden' : undefined,
          }}
        />
      </div>
    );
  }
);

PreviewPanel.displayName = 'PreviewPanel';

export default PreviewPanel;
