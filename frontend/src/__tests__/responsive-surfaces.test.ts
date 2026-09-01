import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.resolve(__dirname, '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_DIR, relativePath), 'utf-8');
}

describe('responsive surface contracts', () => {
  const indexCss = readSource('index.css');
  const volantesCss = readSource('components/volantes/styles.css');
  const reportesCampoCss = readSource('components/reportes-campo/rcampo-styles.css');
  const evidenciaCss = readSource('components/evidencia-volanteo/evidencia-volanteo.css');

  it('scopes responsive rules to the dense feature surfaces', () => {
    for (const surface of ['formatos', 'ubicaciones', 'image-optimizer']) {
      expect(indexCss).toContain(`[data-surface="${surface}"]`);
    }

    expect(reportesCampoCss).toContain('@media (max-width: 900px)');
    expect(reportesCampoCss).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(reportesCampoCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(evidenciaCss).toContain('@media (max-width: 900px)');
    expect(evidenciaCss).toContain('.ev-sidebar {');
    expect(evidenciaCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(indexCss).toContain('[data-surface="autoimg"] *');
    expect(indexCss).toContain('transition-delay: 0ms !important');

    const panelCss = readSource('components/panel-aviso-corte/panel-styles.css');
    expect(panelCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(panelCss).toContain('.pac-app *::before');

    expect(indexCss).toContain('@media (max-width: 980px)');
    expect(indexCss).toContain('@media (max-width: 1279px) and (min-width: 900px)');
    expect(indexCss).toContain('@media (max-width: 899px)');
  });

  it('keeps surface parts addressable without depending on fragile utility order', () => {
    const formatos = readSource('components/formatos/FormatosView.tsx');
    const ubicaciones = readSource('components/UbicacionesView.tsx');
    const optimizer = readSource('components/image-optimizer/index.tsx');
    const autoimg = readSource('components/autoimg/AutoIMGApp.tsx');
    const technicalReports = readSource('components/technical-reports/TechnicalReportsApp.tsx');
    const reportesCampo = readSource('components/reportes-campo/ReportesCampoApp.tsx');
    const reportesHeader = readSource('components/reportes-campo/components/HeaderForm.tsx');
    const reportesPhotos = readSource('components/reportes-campo/components/PhotoManager.tsx');
    const evidencia = readSource('components/evidencia-volanteo/EvidenciaVolanteoApp.tsx');
    const fichas = readSource('components/fichas-tecnicas/FichasTecnicasApp.tsx');
    const fichasPreview = readSource('components/fichas-tecnicas/PreviewPanel.tsx');
    const panelImages = readSource('components/panel-aviso-corte/components/ImageUploader.tsx');
    const evidenciaImages = readSource('components/evidencia-volanteo/components/ImageUploader.tsx');

    expect(formatos).toContain('data-surface="formatos"');
    expect(formatos).toContain('data-surface-part="preview"');
    expect(formatos).toContain('data-surface-part="sidebar"');
    expect(ubicaciones).toContain('data-surface="ubicaciones"');
    expect(ubicaciones).toContain('data-surface-part="workspace"');
    expect(optimizer).toContain('data-surface="image-optimizer"');
    expect(optimizer).toContain('data-surface-part="workspace"');
    expect(autoimg).toContain('data-surface="autoimg"');
    expect(technicalReports).toContain('data-surface="technical-reports"');
    expect(technicalReports).toContain('role="tablist"');
    expect(technicalReports).toContain('aria-selected={mobileTab ===');
    expect(reportesCampo).toContain('data-surface="reportes-campo"');
    expect(reportesCampo).toContain('useReducedMotion');
    expect(reportesHeader).toContain('useReducedMotion');
    expect(reportesPhotos).toContain('useReducedMotion');
    expect(evidencia).toContain('data-surface="evidencia-volanteo"');
    expect(fichas).toContain('data-surface="fichas-tecnicas"');
    expect(fichas).toContain('data-mobile-tab={mobileTab}');
    expect(fichas).toContain('role="tablist"');
    expect(fichasPreview).toContain('tr-preview-wrap');
    expect(reportesPhotos).toContain('role="button"');
    expect(reportesPhotos).toContain('inputRef.current?.click()');
    expect(panelImages).toContain('role="button"');
    expect(evidenciaImages).toContain('role="button"');
  });

  it('uses theme tokens for Volantes responsive controls', () => {
    const volantes = readSource('components/volantes/VolantesView.tsx');

    expect(volantes).toContain('data-surface="volantes"');
    expect(volantesCss).toContain('--vgen-on-danger: var(--text-on-danger)');
    expect(volantesCss).toContain('background: var(--vgen-danger)');
    expect(volantesCss).toContain('@media (max-width: 800px)');
  });
});
