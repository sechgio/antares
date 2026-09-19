import { BatchSettings, PresetDefinition } from './types';

export const DEFAULT_BATCH_SETTINGS: BatchSettings = {
  operations: {
    cropEnabled: false,
    resizeEnabled: true,
    formatEnabled: true,
    compressionEnabled: true,
    renameEnabled: false,
  },
  crop: {
    aspectRatio: 'original',
    cropOrigin: 'bottom',
  },
  resize: {
    maxWidth: 1920,
    maxHeight: 1080,
    noUpscale: true,
  },
  format: {
    outputFormat: 'jpeg',
  },
  compression: {
    maxSizeMB: 1,
    quality: 0.7,
    useWebWorker: true,
  },
  rename: {
    prefix: 'foto',
    startAt: 1,
  },
  export: {
    mode: 'zip',
    zipName: 'imagenes_optimizadas',
    outputFolder: '',
  },
};

export function cloneSettings(settings: BatchSettings): BatchSettings {
  return {
    operations: { ...settings.operations },
    crop: { ...settings.crop },
    resize: { ...settings.resize },
    format: { ...settings.format },
    compression: { ...settings.compression },
    rename: { ...settings.rename },
    export: { ...settings.export },
  };
}

function withPatch(base: BatchSettings, patch: Partial<BatchSettings>): BatchSettings {
  const next = cloneSettings(base);
  if (patch.operations) next.operations = { ...next.operations, ...patch.operations };
  if (patch.crop) next.crop = { ...next.crop, ...patch.crop };
  if (patch.resize) next.resize = { ...next.resize, ...patch.resize };
  if (patch.format) next.format = { ...next.format, ...patch.format };
  if (patch.compression) next.compression = { ...next.compression, ...patch.compression };
  if (patch.rename) next.rename = { ...next.rename, ...patch.rename };
  if (patch.export) next.export = { ...next.export, ...patch.export };
  return next;
}

export const IMAGE_OPTIMIZER_PRESETS: PresetDefinition[] = [
  {
    id: 'web',
    label: 'Optimizar web',
    description: 'JPEG ligero para sitios y catalogos.',
    accentClassName: 'border-[color:color-mix(in_srgb,var(--accent-green)_25%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-green)_10%,transparent)] text-[var(--accent-green)]',
    settings: cloneSettings(DEFAULT_BATCH_SETTINGS),
  },
  {
    id: 'social',
    label: 'Redes sociales',
    description: 'Formato vertical con limite listo para publicaciones.',
    accentClassName: 'border-[color:color-mix(in_srgb,var(--accent-blue)_25%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-blue)_10%,transparent)] text-[var(--accent-blue)]',
    settings: withPatch(DEFAULT_BATCH_SETTINGS, {
      operations: { cropEnabled: true, resizeEnabled: true, formatEnabled: true, compressionEnabled: true, renameEnabled: false },
      crop: { aspectRatio: '4:5', cropOrigin: 'bottom' },
      resize: { maxWidth: 1080, maxHeight: 1350, noUpscale: true },
      compression: { maxSizeMB: 0.8, quality: 0.82, useWebWorker: true },
      export: { mode: 'zip', zipName: 'social-media', outputFolder: '' },
    }),
  },
  {
    id: 'rename-only',
    label: 'Solo renombrar',
    description: 'No altera bytes ni dimensiones, solo nombres y exportacion.',
    accentClassName: 'border-[color:color-mix(in_srgb,var(--accent-yellow)_25%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-yellow)_10%,transparent)] text-[var(--accent-yellow)]',
    settings: withPatch(DEFAULT_BATCH_SETTINGS, {
      operations: {
        cropEnabled: false,
        resizeEnabled: false,
        formatEnabled: false,
        compressionEnabled: false,
        renameEnabled: true,
      },
      crop: { aspectRatio: 'original', cropOrigin: 'bottom' },
      format: { outputFormat: 'original' },
      export: { mode: 'zip', zipName: 'imagenes_renombradas', outputFolder: '' },
    }),
  },
  {
    id: 'webp',
    label: 'Convertir a WEBP',
    description: 'Conversion con compresion para peso minimo.',
    accentClassName: 'border-[color:color-mix(in_srgb,var(--accent-primary)_25%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,transparent)] text-[var(--accent-primary)]',
    settings: withPatch(DEFAULT_BATCH_SETTINGS, {
      operations: { cropEnabled: false, resizeEnabled: false, formatEnabled: true, compressionEnabled: true, renameEnabled: false },
      format: { outputFormat: 'webp' },
      compression: { maxSizeMB: 0.7, quality: 0.75, useWebWorker: true },
      export: { mode: 'zip', zipName: 'imagenes_webp', outputFolder: '' },
    }),
  },
  {
    id: 'crop-export',
    label: 'Recorte + exportacion',
    description: 'Recorta y conserva calidad alta para salidas editoriales.',
    accentClassName: 'border-[color:color-mix(in_srgb,var(--accent-primary)_25%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,transparent)] text-[var(--accent-primary)]',
    settings: withPatch(DEFAULT_BATCH_SETTINGS, {
      operations: { cropEnabled: true, resizeEnabled: false, formatEnabled: false, compressionEnabled: false, renameEnabled: false },
      crop: { aspectRatio: '1:1', cropOrigin: 'bottom' },
      format: { outputFormat: 'original' },
      export: { mode: 'zip', zipName: 'recortes', outputFolder: '' },
    }),
  },
];

export const PRESET_BY_ID = IMAGE_OPTIMIZER_PRESETS.reduce<Record<string, PresetDefinition>>((acc, preset) => {
  acc[preset.id] = preset;
  return acc;
}, {});

