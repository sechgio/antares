import type { CanvasFieldDef, CanvasLayer, CanvasSharedStyle } from '../types';
import type { PdfImportLimits } from './pdfImportLimits';

export type PdfUnsupportedReason =
  | 'complex-path'
  | 'unsupported-operator'
  | 'font-outline'
  | 'transparency'
  | 'clipping'
  | 'scanned-page'
  | 'mixed-page-size'
  | 'limit-exceeded';

export interface PdfBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface PdfPathPoint {
  x: number;
  y: number;
}

export interface PdfImageAsset {
  key: string;
  bytes: Uint8Array;
  mimeType: string;
  widthPx: number;
  heightPx: number;
}

export type PdfPrimitive =
  | {
      kind: 'text';
      box: PdfBox;
      transform: PdfMatrix;
      text: string;
      fontFamily?: string;
      fontSizePt: number;
      color?: string;
      fontWeight?: string;
      fontStyle?: string;
      textAlign?: string;
    }
  | {
      kind: 'rect' | 'ellipse';
      box: PdfBox;
      fill?: string;
      stroke?: string;
      strokeWidthPt?: number;
      rotationDeg?: number;
    }
  | {
      kind: 'line';
      box: PdfBox;
      points: PdfPathPoint[];
      stroke?: string;
      strokeWidthPt?: number;
    }
  | {
      kind: 'image';
      box: PdfBox;
      asset: PdfImageAsset;
      rotationDeg?: number;
    }
  | {
      kind: 'checkbox';
      box: PdfBox;
      checked: boolean;
      label?: string;
    }
  | {
      kind: 'unsupported';
      box?: PdfBox;
      reason: PdfUnsupportedReason;
      sourceOpCount: number;
    };

export interface PdfImportIssue {
  pageNumber: number;
  reason: PdfUnsupportedReason;
  message: string;
  count: number;
}

export interface PdfPageExtraction {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  operators: number;
  primitives: PdfPrimitive[];
  warnings: string[];
  issues?: PdfImportIssue[];
}

export interface PdfDocumentExtraction {
  pages: PdfPageExtraction[];
  manifestBytes?: Uint8Array;
}

export interface PdfImportProgress {
  stage: 'loading' | 'extracting' | 'mapping' | 'persisting';
  page: number;
  totalPages: number;
  layers: number;
  skipped: number;
}

export interface PdfImportReport {
  importedCount: number;
  skippedCount: number;
  pagesProcessed: number;
  issues: PdfImportIssue[];
  warnings: string[];
}

export interface PdfCanvasFragment {
  pages: Array<{ id: string; name: string }>;
  layers: CanvasLayer[];
  fields: CanvasFieldDef[];
  styles?: CanvasSharedStyle[];
  firstPageIndex: number;
  importedLayerIds: string[];
  report: PdfImportReport;
}

export interface PdfImportResult {
  sourceName: string;
  fragment: PdfCanvasFragment;
  report: PdfImportReport;
}

export interface PdfImportPreflight {
  pageCount: number;
  pageSizes: Array<{ widthPt: number; heightPt: number }>;
  hasMixedPageSizes: boolean;
}

export interface PdfImportOptionsValue {
  pageStart: number;
  pageEnd: number;
  mixedPagePolicy: 'reject' | 'scale-to-first';
}

export interface PdfImportOptions {
  pageStart?: number;
  pageEnd?: number;
  mixedPagePolicy?: 'reject' | 'scale-to-first';
  limits?: Partial<PdfImportLimits>;
  signal?: AbortSignal;
  onProgress?: (progress: PdfImportProgress) => void;
  /** Optional coordinator hook; true skips heuristic extraction after a valid manifest. */
  onManifest?: (bytes: Uint8Array) => boolean | Promise<boolean>;
}
