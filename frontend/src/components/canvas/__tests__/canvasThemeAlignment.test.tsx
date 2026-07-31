import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Canvas Theme Alignment', () => {
  const canvasCssPath = resolve(__dirname, '../canvas.css');
  const canvasCss = readFileSync(canvasCssPath, 'utf8');

  it('maps .canvas-app CSS variables to global appearance theme variables', () => {
    expect(canvasCss).toMatch(/--cv-bg:\s*var\(--bg-base,/);
    expect(canvasCss).toMatch(/--cv-panel:\s*var\(--bg-surface,/);
    expect(canvasCss).toMatch(/--cv-panel-elevated:\s*var\(--bg-elevated,/);
    expect(canvasCss).toMatch(/--cv-border:\s*var\(--border-subtle,/);
    expect(canvasCss).toMatch(/--cv-border-strong:\s*var\(--border-medium,/);
    expect(canvasCss).toMatch(/--cv-text:\s*var\(--text-primary,/);
    expect(canvasCss).toMatch(/--cv-text-muted:\s*var\(--text-muted,/);
    expect(canvasCss).toMatch(/--cv-text-secondary:\s*var\(--text-secondary,/);
    expect(canvasCss).toMatch(/--cv-accent:\s*var\(--accent-primary,/);
    expect(canvasCss).toMatch(/--cv-accent-hover:\s*var\(--accent-primary-hover,/);
  });

  it('uses theme variables for context menu, floating toolbars, color picker, and ghosts', () => {
    // Context menu should use --cv-panel-elevated and --cv-text instead of hardcoded #2c2c2c
    expect(canvasCss).toMatch(/\.canvas-context-menu\s*\{[^}]*background:\s*var\(--cv-panel-elevated\)/);
    expect(canvasCss).toMatch(/\.canvas-context-menu\s*\{[^}]*color:\s*var\(--cv-text\)/);

    // Floating toolbar should use --cv-panel-elevated
    expect(canvasCss).toMatch(/\.canvas-toolbar-float\s*\{[^}]*background:\s*var\(--cv-panel-elevated\)/);

    // Color picker should use --cv-panel-elevated
    expect(canvasCss).toMatch(/\.canvas-color-picker\s*\{[^}]*background:\s*var\(--cv-panel-elevated\)/);
  });

  it('keeps topbar and side panels on the same appearance surface', () => {
    expect(canvasCss).toMatch(/\.canvas-topbar\s*\{[^}]*background:\s*var\(--cv-panel\)/);
    expect(canvasCss).toMatch(/\.canvas-panel\s*\{[^}]*background:\s*var\(--cv-panel\)/);
    expect(canvasCss).toMatch(/\.canvas-topbar-trailing--panel\s*\{[^}]*width:\s*272px/);
  });

  it('preserves white paper sheet background on the artboard', () => {
    const artboardTsx = readFileSync(resolve(__dirname, '../editor/Artboard.tsx'), 'utf8');
    expect(artboardTsx).toMatch(/background:\s*['"]#ffffff['"]/);
  });

  it('styles RightPanel with canvas-panel like LeftSidebar', () => {
    const rightPanel = readFileSync(resolve(__dirname, '../editor/RightPanel.tsx'), 'utf8');
    expect(rightPanel).toMatch(/canvas-panel canvas-panel-chrome/);
  });

  it('renders a flat canvas viewport background aligned with appearance theme without dots', () => {
    expect(canvasCss).toMatch(/\.canvas-dot-bg\s*\{[^}]*background-color:\s*var\(--cv-bg-deep\)/);
    expect(canvasCss).not.toMatch(/\.canvas-dot-bg\s*\{[^}]*radial-gradient/);
  });
});
