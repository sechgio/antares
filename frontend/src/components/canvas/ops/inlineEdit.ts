import type { CanvasLayer } from '../types';

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
