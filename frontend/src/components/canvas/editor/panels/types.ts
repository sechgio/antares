import type { FC } from 'react';
import type { CanvasLayer } from '../../types';

export interface ZOrderCallbacks {
  onBringFront: () => void;
  onBringForward: () => void;
  onSendBack: () => void;
  onSendBackward: () => void;
}

/** Flat prop bag passed to every panel section.
 *
 * The mutators are closures built by the orchestrator (RightPanel) bound to
 * the current `layer`; sections just call them. Derived single-selection flags
 * are computed once by the orchestrator so sections don't recompute them. */
export interface SectionProps {
  layer: CanvasLayer;
  pageColors: string[];
  // Mutators.
  onChange: (layer: CanvasLayer) => void;
  emitLive: (layer: CanvasLayer) => void;
  /** Apply a transform to the latest live layer (survives rapid multi-field edits). */
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
  // Derived single-selection flags.
  shape: boolean;
  isLine: boolean;
  showRadius: boolean;
  hasFill: boolean;
  hasStroke: boolean;
  strokeWeightPx: number;
  strokeWeightPct: number;
  setStrokeWeight: (raw: number) => void;
  // Export state (shared with the multi-select export button in the orchestrator).
  exportScale: number;
  setExportScale: (n: number) => void;
  exporting: boolean;
  setExporting: (b: boolean) => void;
}

/** Registry entry: a type-specific tail section rendered after the common inspectors. */
export interface PanelSection {
  test: (layer: CanvasLayer) => boolean;
  Component: FC<SectionProps>;
}
