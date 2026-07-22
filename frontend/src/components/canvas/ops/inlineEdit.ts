import type { CanvasLayer } from '../types';
import { mm, parseMm } from '../types';
import { MM_TO_PX } from './drawHelpers';

/** Text layers that can enter on-canvas inline edit (not Excel field bindings). */
export function canInlineEditLayer(layer: CanvasLayer | null | undefined): boolean {
  if (!layer) return false;
  if (layer.type !== 'text') return false;
  if (layer.locked) return false;
  if (layer.visible === false) return false;
  return true;
}

/** Field layers can open the binding editor (RightPanel), not free-form text. */
export function canFocusFieldBinding(layer: CanvasLayer | null | undefined): boolean {
  if (!layer) return false;
  if (layer.type !== 'field') return false;
  if (layer.locked) return false;
  if (layer.visible === false) return false;
  return true;
}

/**
 * Design-time label for Excel field layers.
 * Prefers fallback sample text (WYSIWYG of empty Generar) over the {{ KEY }} token.
 */
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

/** True when global canvas shortcuts must not run (typing / form focus). */
export function isEditableKeyboardTarget(el: EventTarget | null): boolean {
  if (!el || typeof el !== 'object') return false;
  const node = el as unknown as Pick<HTMLElement, 'tagName' | 'isContentEditable'>;
  const tag = node.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(node.isContentEditable);
}

/** True when a key should type-to-edit a selected text layer (Figma-like). */
export function isTypeToEditKey(
  key: string,
  mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
): boolean {
  if (mods.ctrlKey || mods.metaKey || mods.altKey) return false;
  if (key.length !== 1) return false;
  if (key === ' ') return false; // Space stays temporary hand
  const code = key.charCodeAt(0);
  if (code < 32) return false;
  return true;
}


/**
 * Grow-only height (mm) so multiline text fits the measured content box.
 * `contentHeightPx` is scrollHeight of the editor at the current zoom.
 */
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

/** Apply grow-only height from editor scrollHeight; returns same layer if unchanged. */
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
