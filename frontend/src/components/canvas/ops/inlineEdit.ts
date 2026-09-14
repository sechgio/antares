import type { CanvasLayer, LayerCssVars } from '../types';
import { mm, parseMm } from '../types';
import { MM_TO_PX } from './drawHelpers';

export interface InlineSelectionRange {
  start: number;
  end: number;
}

export interface InlineEditStartOpts {
  seed?: string;
  selection?: InlineSelectionRange;
}

export type InlineTextStyle = 'bold' | 'italic' | 'underline';

export function canInlineEditLayer(layer: CanvasLayer | null | undefined): boolean {
  if (!layer) return false;
  if (layer.type !== 'text') return false;
  if (layer.locked) return false;
  if (layer.visible === false) return false;
  return true;
}

export function canFocusFieldBinding(layer: CanvasLayer | null | undefined): boolean {
  if (!layer) return false;
  if (layer.type !== 'field') return false;
  if (layer.locked) return false;
  if (layer.visible === false) return false;
  return true;
}

export function fieldDesignLabel(layer: CanvasLayer): string {
  const key = layer.meta?.key || 'FIELD';
  const fallback = layer.meta?.fallback;
  if (fallback != null && String(fallback).length > 0) return String(fallback);
  return `{{ ${key} }}`;
}

export function justifyContentForTextAlign(
  align: string | undefined,
): 'flex-start' | 'center' | 'flex-end' {
  if (align === 'center') return 'center';
  if (align === 'right') return 'flex-end';
  return 'flex-start';
}

function asHtmlElement(el: EventTarget | null): HTMLElement | null {
  if (!el || typeof el !== 'object') return null;
  return el as HTMLElement;
}

export function isEditableKeyboardTarget(el: EventTarget | null): boolean {
  const node = asHtmlElement(el);
  if (!node) return false;
  const tag = node.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(node.isContentEditable);
}

export function isLayerListKeyboardTarget(el: EventTarget | null): boolean {
  const node = asHtmlElement(el);
  if (!node) return false;
  if (typeof node.closest === 'function') {
    return Boolean(node.closest('[data-testid="canvas-layer-list"]'));
  }
  return node.getAttribute?.('data-testid') === 'canvas-layer-list';
}

export function isButtonLikeKeyboardTarget(el: EventTarget | null): boolean {
  const node = asHtmlElement(el);
  if (!node) return false;
  const tag = node.tagName;
  if (tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'A') return true;
  const role = typeof node.getAttribute === 'function' ? node.getAttribute('role') : null;
  return role === 'button' || role === 'menuitem' || role === 'tab' || role === 'option' || role === 'switch';
}

export function isTypeToEditKey(
  key: string,
  mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
): boolean {
  if (mods.ctrlKey || mods.metaKey || mods.altKey) return false;
  if (key.length !== 1) return false;
  if (key === ' ') return false;
  const code = key.charCodeAt(0);
  if (code < 32) return false;
  return true;
}

export function caretIndexFromPoint(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): number | null {
  const doc = root.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  const pos = doc.caretPositionFromPoint?.(clientX, clientY);
  if (pos) {
    node = pos.offsetNode;
    offset = pos.offset;
  } else {
    const range = doc.caretRangeFromPoint?.(clientX, clientY);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null;
  return offset;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

function caretCharClass(ch: string): number {
  if (WORD_CHAR.test(ch)) return 0;
  return /\s/.test(ch) ? 1 : 2;
}

export function wordRangeAt(text: string, index: number): InlineSelectionRange {
  const len = text.length;
  const i = Math.max(0, Math.min(Math.round(index), len));
  if (i >= len) return { start: len, end: len };
  const cls = caretCharClass(text[i]);
  let start = i;
  let end = i + 1;
  while (start > 0 && caretCharClass(text[start - 1]) === cls) start--;
  while (end < len && caretCharClass(text[end]) === cls) end++;
  return { start, end };
}

export function inlineEditLayerChanged(a: CanvasLayer, b: CanvasLayer): boolean {
  if (a.value !== b.value) return true;
  for (const k of Object.keys(a.cssVars) as (keyof LayerCssVars)[]) {
    if (a.cssVars[k] !== b.cssVars[k]) return true;
  }
  for (const k of Object.keys(b.cssVars) as (keyof LayerCssVars)[]) {
    if (b.cssVars[k] !== a.cssVars[k]) return true;
  }
  return false;
}

export function toggleInlineTextStyle(layer: CanvasLayer, style: InlineTextStyle): CanvasLayer {
  const cssVars = { ...layer.cssVars };
  if (style === 'bold') {
    const weight = Number.parseInt(cssVars['--font-weight'] ?? '400', 10);
    cssVars['--font-weight'] = Number.isFinite(weight) && weight >= 600 ? '400' : '700';
  } else if (style === 'italic') {
    cssVars['--font-style'] = cssVars['--font-style'] === 'italic' ? '' : 'italic';
  } else {
    cssVars['--text-decoration'] = cssVars['--text-decoration'] === 'underline' ? '' : 'underline';
  }
  return { ...layer, cssVars };
}

export function fitTextHeightMm(
  currentHeightMm: number,
  contentHeightPx: number,
  zoom: number,
  minMm = 4,
): number {
  const z = zoom > 0 ? zoom : 1;
  const needed = Math.max(minMm, contentHeightPx / (MM_TO_PX * z));
  return Math.max(currentHeightMm, needed);
}

export function growTextLayerToContent(
  layer: CanvasLayer,
  contentHeightPx: number,
  zoom: number,
): CanvasLayer {
  if (layer.type !== 'text') return layer;
  const base = parseMm(layer.cssVars['--height'], 8);
  const next = fitTextHeightMm(base, contentHeightPx, zoom);
  if (Math.abs(next - base) < 0.05) return layer;
  return {
    ...layer,
    cssVars: { ...layer.cssVars, '--height': mm(next) },
  };
}
