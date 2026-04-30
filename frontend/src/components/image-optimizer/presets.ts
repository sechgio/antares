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
  },
};

function cloneSettings(settings: BatchSettings): BatchSettings {
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
    accentClassName: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
    settings: cloneSettings(DEFAULT_BATCH_SETTINGS),
  },
  {
    id: 'social',
    label: 'Redes sociales',
    description: 'Formato vertical con limite listo para publicaciones.',
    accentClassName: 'border-sky-500/25 bg-sky-500/10 text-sky-300',
    settings: withPatch(DEFAULT_BATCH_SETTINGS, {
      operations: { cropEnabled: true, resizeEnabled: true, formatEnabled: true, compressionEnabled: true, renameEnabled: false },
      crop: { aspectRatio: '4:5', cropOrigin: 'bottom' },
      resize: { maxWidth: 1080, maxHeight: 1350, noUpscale: true },
      compression: { maxSizeMB: 0.8, quality: 0.82, useWebWorker: true },
      export: { mode: 'zip', zipName: 'social-media' },
    }),
  },
  {
    id: 'rename-only',
    label: 'Solo renombrar',
    description: 'No altera bytes ni dimensiones, solo nombres y exportacion.',
    accentClassName: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
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
      export: { mode: 'zip', zipName: 'imagenes_renombradas' },
    }),
  },
  {
    id: 'webp',
    label: 'Convertir a WEBP',
    description: 'Conversion con compresion para peso minimo.',
    accentClassName: 'border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-300',
    settings: withPatch(DEFAULT_BATCH_SETTINGS, {
      operations: { cropEnabled: false, resizeEnabled: false, formatEnabled: true, compressionEnabled: true, renameEnabled: false },
      format: { outputFormat: 'webp' },
      compression: { maxSizeMB: 0.7, quality: 0.75, useWebWorker: true },
      export: { mode: 'zip', zipName: 'imagenes_webp' },
    }),
  },
  {
    id: 'crop-export',
    label: 'Recorte + exportacion',
    description: 'Recorta y conserva calidad alta para salidas editoriales.',
    accentClassName: 'border-violet-500/25 bg-violet-500/10 text-violet-300',
    settings: withPatch(DEFAULT_BATCH_SETTINGS, {
      operations: { cropEnabled: true, resizeEnabled: false, formatEnabled: false, compressionEnabled: false, renameEnabled: false },
      crop: { aspectRatio: '1:1', cropOrigin: 'bottom' },
      format: { outputFormat: 'original' },
      export: { mode: 'zip', zipName: 'recortes' },
    }),
  },
];

export const PRESET_BY_ID = IMAGE_OPTIMIZER_PRESETS.reduce<Record<string, PresetDefinition>>((acc, preset) => {
  acc[preset.id] = preset;
  return acc;
}, {});

export function cloneBatchSettings(settings: BatchSettings): BatchSettings {
  return cloneSettings(settings);
}
