import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const srcRoot = resolve(__dirname, '../..');

function readSource(path: string) {
  return readFileSync(resolve(srcRoot, path), 'utf8');
}

/** Tailwind palette / black scrims that bypass Appearance CSS vars. */
const FORBIDDEN_HARDCODE =
  /bg-black\/|text-red-\d|bg-red-\d|border-red-\d|hover:text-red-\d|hover:bg-red-\d|text-green-\d|bg-green-\d|text-emerald-|bg-emerald-|border-emerald-|hover:text-emerald-|hover:bg-emerald-|#ef4444\b|#10b981\b|#f59e0b\b/i;

const THEMED_UI_FILES = [
  'components/conversion/OptionsCard.tsx',
  'components/conversion/FileCard.tsx',
  'components/conversion/ConversionPresets.tsx',
  'components/conversion/RenameCard.tsx',
  'components/history/HistoryView.tsx',
  'components/history/RunList.tsx',
  'components/history/RunDetail.tsx',
  'components/layout/TitleBar.tsx',
  'components/layout/TaskNotificationsBell.tsx',
  'components/preview-panel/PreviewPanelView.tsx',
  'components/formatos/FormatosView.tsx',
  'components/formatos/MappingOverlay.tsx',
  'components/formatos/MappingPreviewPanel.tsx',
  'components/image-optimizer/CropEditor.tsx',
  'components/image-optimizer/QueuePanel.tsx',
  'components/image-optimizer/PreviewWorkspace.tsx',
  'components/image-optimizer/ItemOverridesPanel.tsx',
  'components/image-optimizer/ui.tsx',
  'components/image-optimizer/index.tsx',
  'components/Thumbnail.tsx',
  'components/panel-aviso-corte/components/ImageUploader.tsx',
  'components/panel-aviso-corte/components/ExcelImporter.tsx',
  'components/panel-aviso-corte/components/LogoPicker.tsx',
  'components/panel-aviso-corte/components/MatchRuleEditor.tsx',
  'components/panel-aviso-corte/PanelAvisoCorteApp.tsx',
  'components/evidencia-volanteo/components/ImageUploader.tsx',
  'components/evidencia-volanteo/components/DualLogoPicker.tsx',
  'components/evidencia-volanteo/EvidenciaVolanteoApp.tsx',
  'components/sellador/PositionPanel.tsx',
  'components/sellador/SelladorView.tsx',
  'components/fichas-tecnicas/FichasTecnicasApp.tsx',
  'components/espacios/components/views/TableView.tsx',
  'components/espacios/components/views/GanttView.tsx',
  'components/ui/Dialog.tsx',
  'components/ui/Toast.tsx',
  'components/ui/Toggle.tsx',
];

describe('global appearance coverage', () => {
  it('keeps database and conversion chrome on appearance tokens instead of fixed shell colors', () => {
    const files = [
      'components/conversion/OptionsCard.tsx',
      'components/history/HistoryView.tsx',
      'components/history/RunList.tsx',
      'components/history/RunDetail.tsx',
      'components/layout/TitleBar.tsx',
    ];

    for (const file of files) {
      const source = readSource(file);

      expect(source, file).not.toMatch(/#(?:0A0A0A|111111|1A1A1A|222222|333333|555555|666666|A0A0A0|5E6AD2|FFFFFF)\b/i);
      expect(source, file).toMatch(/var\(--(?:bg|text|border|accent)-/);
    }
  });

  it('maps custom module chrome variables to shared appearance tokens', () => {
    const moduleStyles = [
      'components/volantes/styles.css',
      'components/padron/vpad-styles.css',
      'components/reportes-campo/rcampo-styles.css',
    ];

    for (const file of moduleStyles) {
      const source = readSource(file);

      expect(source, file).toMatch(/var\(--bg-base\)/);
      expect(source, file).toMatch(/var\(--bg-surface\)/);
      expect(source, file).toMatch(/var\(--accent-primary\)/);
      expect(source, file).toMatch(/var\(--border-subtle\)/);
    }
  });

  it('keeps feature overlays and semantic UI on appearance tokens', () => {
    for (const file of THEMED_UI_FILES) {
      const source = readSource(file);

      expect(source, file).not.toMatch(FORBIDDEN_HARDCODE);
      expect(source, file).toMatch(/var\(--(?:bg|text|border|accent)-|text-txt-|bg-accent-|text-accent-|border-accent-|bg-dark-|text-dark-/);
    }
  });

  it('does not use fixed black modal scrims in shared dialogs', () => {
    for (const file of [
      'components/ui/Dialog.tsx',
      'components/ui/CommandPalette.tsx',
      'components/espacios/components/ModalShell.tsx',
      'components/settings/SettingsModal.tsx',
    ]) {
      const source = readSource(file);
      expect(source, file).not.toMatch(/bg-black\//);
      expect(source, file).toMatch(/color-mix\(in srgb, var\(--bg-base\)|bg-\[var\(--bg-base\)\]|backgroundColor: 'var\(--bg-base\)'/);
    }

    const dialog = readSource('components/ui/Dialog.tsx');
    expect(dialog).toMatch(/--accent-primary/);
    expect(dialog).toMatch(/backgroundColor: 'var\(--bg-base\)'/);
    expect(dialog).not.toMatch(/shadow-elevated/);
  });
});
