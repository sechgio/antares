export interface CropOffset {
  x: number;
  y: number;
}

export type OutputFormat = 'original' | 'jpeg' | 'png' | 'webp' | 'avif' | 'bmp';

export type AspectRatio = 'original' | '1:1' | '4:3' | '4:5' | '3:2' | '16:9' | '9:16' | '3:4' | '2:3';

export type CropOrigin = 'top' | 'bottom';

export type ExportMode = 'zip' | 'individual';

export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'error';

export type PreviewTab = 'original' | 'crop' | 'result' | 'compare';

export type PresetId = 'web' | 'social' | 'rename-only' | 'webp' | 'crop-export';

export interface AspectRatioOption {
  value: AspectRatio;
  label: string;
  ratio: number | null;
}

export interface OperationToggles {
  cropEnabled: boolean;
  resizeEnabled: boolean;
  formatEnabled: boolean;
  compressionEnabled: boolean;
  renameEnabled: boolean;
}

export interface CropSettings {
  aspectRatio: AspectRatio;
  cropOrigin: CropOrigin;
}

export interface ResizeSettings {
  maxWidth: number;
  maxHeight: number;
  noUpscale: boolean;
}

export interface FormatSettings {
  outputFormat: OutputFormat;
}

export interface CompressionSettings {
  maxSizeMB: number;
  quality: number;
  useWebWorker: boolean;
}

export interface RenameSettings {
  prefix: string;
  startAt: number;
}

export interface ExportSettings {
  mode: ExportMode;
  zipName: string;
}

export interface BatchSettings {
  operations: OperationToggles;
  crop: CropSettings;
  resize: ResizeSettings;
  format: FormatSettings;
  compression: CompressionSettings;
  rename: RenameSettings;
  export: ExportSettings;
}

export interface ImageOverrides {
  skipCompression: boolean;
  customFilename: string;
  customCropOffset?: CropOffset;
  excluded: boolean;
  presetId?: PresetId | null;
}

export interface ImageItem {
  id: string;
  sourceFile: File;
  preview: string;
  originalName: string;
  originalSize: number;
  sourceWidth?: number;
  sourceHeight?: number;
  resultBlob?: Blob;
  resultPreview?: string;
  resultSize?: number;
  finalWidth?: number;
  finalHeight?: number;
  status: ProcessingStatus;
  error?: string;
  stale: boolean;
  selected: boolean;
  excluded: boolean;
  overrides: ImageOverrides;
  processedSignature?: string;
  processedAt?: number;
}

export interface ImageStats {
  totalCount: number;
  selectedCount: number;
  includedCount: number;
  processedCount: number;
  staleCount: number;
  errorCount: number;
  pendingCount: number;
  readyCount: number;
  totalOriginalSize: number;
  totalResultSize: number;
  savedBytes: number;
  savedPercentage: number;
}

export interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

export interface PresetDefinition {
  id: PresetId;
  label: string;
  description: string;
  accentClassName: string;
  settings: BatchSettings;
}

export interface ResizeDimensions {
  width: number;
  height: number;
  scale: number;
}

export interface CropRectangle {
  cropType: 'horizontal' | 'vertical' | 'none';
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  maxOffsetX: number;
  maxOffsetY: number;
}

export interface ProcessedArtifact {
  blob: Blob;
  width: number;
  height: number;
  signature: string;
}

export interface ProcessingPlan {
  usesSourceDirectly: boolean;
  shouldCrop: boolean;
  shouldResize: boolean;
  shouldConvertFormat: boolean;
  shouldCompress: boolean;
  targetFormat: OutputFormat;
  targetMimeType: string;
  targetExtension: string;
}

export const ASPECT_RATIO_OPTIONS: AspectRatioOption[] = [
  { value: 'original', label: 'Original', ratio: null },
  { value: '1:1', label: '1:1 (Cuadrado)', ratio: 1 },
  { value: '4:3', label: '4:3 (Foto)', ratio: 4 / 3 },
  { value: '4:5', label: '4:5 (Instagram)', ratio: 4 / 5 },
  { value: '3:2', label: '3:2 (DSLR)', ratio: 3 / 2 },
  { value: '16:9', label: '16:9 (Video)', ratio: 16 / 9 },
  { value: '9:16', label: '9:16 (Story)', ratio: 9 / 16 },
  { value: '3:4', label: '3:4 (Retrato)', ratio: 3 / 4 },
  { value: '2:3', label: '2:3 (Pinterest)', ratio: 2 / 3 },
];
