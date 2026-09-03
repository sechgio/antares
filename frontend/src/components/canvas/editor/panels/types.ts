import type { FC } from 'react';
import type { CanvasLayer } from '../../types';

export interface ZOrderCallbacks {
  onBringFront: () => void;
  onBringForward: () => void;
  onSendBack: () => void;
  onSendBackward: () => void;
}

export interface SectionProps {
  layer: CanvasLayer;
  pageColors: string[];
  layers?: CanvasLayer[];
  selectedIds?: string[];
  onChange: (layer: CanvasLayer) => void;
  onReplaceLayers?: (layers: CanvasLayer[]) => void;
  emitLive: (layer: CanvasLayer) => void;
  mapLive: (fn: (layer: CanvasLayer) => CanvasLayer) => void;
  setVar: (key: string, value: string) => void;
  setVarLive: (key: string, value: string) => void;
  setVars: (patch: Record<string, string>) => void;
  setVarsLive: (patch: Record<string, string>) => void;
  setMeta: (patch: NonNullable<CanvasLayer['meta']>) => void;
  setMetaLive: (patch: NonNullable<CanvasLayer['meta']>) => void;
  onCommitLive?: () => void;
  onAlign: (align: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  logoSideConflict?: boolean;
  zOrder: ZOrderCallbacks;
  onInstantiateComponent?: () => void;
  shape: boolean;
  isLine: boolean;
  showRadius: boolean;
  hasFill: boolean;
  hasStroke: boolean;
  strokeWeightPx: number;
  strokeWeightPct: number;
  setStrokeWeight: (raw: number) => void;
  exportScale: number;
  setExportScale: (n: number) => void;
  exporting: boolean;
  setExporting: (b: boolean) => void;
}

export interface PanelSection {
  test: (layer: CanvasLayer) => boolean;
  Component: FC<SectionProps>;
}
