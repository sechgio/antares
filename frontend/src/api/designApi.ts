import { _invoke } from './core';

export type DesignPagePreset = 'a4' | 'a4-landscape' | '16x9' | '16x10' | '4x3';

export type DesignLayout = 'title' | 'section' | 'bullets' | 'twoColumn' | 'stat' | 'quote' | 'blank';

export interface DesignPage {
  preset: DesignPagePreset;
  widthMm: number;
  heightMm: number;
}

export interface DesignTheme {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accentAlt: string;
  headFont: string;
  bodyFont: string;
}

export interface DesignSlide {
  id: string;
  layout: DesignLayout;
  title: string;
  subtitle: string;
  body: string;
  bullets: string[];
  left: string[];
  right: string[];
  statValue: string;
  statLabel: string;
  quoteText: string;
  quoteAuthor: string;
  notes: string;
}

export interface DesignDocument {
  version: number;
  id: string;
  name: string;
  prompt: string;
  updatedAt: string;
  page: DesignPage;
  theme: DesignTheme;
  slides: DesignSlide[];
}

export interface DesignListItem {
  id: string;
  name: string;
  updatedAt: string;
  slideCount: number;
  page: Partial<DesignPage>;
}

export interface DesignMemoryResponse {
  memory: DesignMemory;
  noteCount?: number;
}

export interface DesignFinding {
  kind: 'overflow' | 'collision' | 'tiny-text' | 'empty-slide' | 'contrast';
  severity: 'error' | 'warning';
  slide: number;
  message: string;
  detail: Record<string, unknown>;
}

export interface DesignPreflight {
  ok: boolean;
  slideCount: number;
  findings: DesignFinding[];
  errorCount: number;
  warningCount: number;
}

export interface DesignNote {
  id: string;
  text: string;
  createdAt: string;
}

export interface DesignMemory {
  version: number;
  notes: DesignNote[];
}

export const designApi = {
  designList: () => _invoke<{ designs: DesignListItem[] }>('design_list'),

  designGet: (id: string) => _invoke<{ document: DesignDocument }>('design_get', { id }),

  designCreateEmpty: (name?: string) => _invoke<{ document: DesignDocument }>('design_create_empty', { name }),

  designDelete: (id: string) => _invoke<{ deleted: boolean; id: string }>('design_delete', { id }),

  designGenerate: (body: { prompt: string; provider: string; model?: string; page_preset?: DesignPagePreset }) =>
    _invoke<{ document: DesignDocument }>('design_generate', body),

  designRenderHtml: (body: { id?: string; document?: DesignDocument }) =>
    _invoke<{ html: string; slideCount: number; page: DesignPage }>('design_render_html', body),

  designPreflight: (body: { id?: string; document?: DesignDocument }) =>
    _invoke<DesignPreflight>('design_preflight', body),

  designMemoryGet: () => _invoke<DesignMemoryResponse>('design_memory_get'),

  designMemoryAdd: (text: string) => _invoke<DesignMemoryResponse>('design_memory_add', { text }),

  designMemoryDelete: (id: string) => _invoke<DesignMemoryResponse>('design_memory_delete', { id }),

  designMemoryClear: () => _invoke<DesignMemoryResponse>('design_memory_clear'),

  designExportPdf: (body: { id?: string; document?: DesignDocument; outputPath?: string; overwrite?: boolean }) =>
    _invoke<
      | { pdf_base64: string; filename: string; saved_path?: undefined }
      | { pdf_base64?: undefined; filename: string; saved_path: string }
    >('design_export_pdf', body),
};