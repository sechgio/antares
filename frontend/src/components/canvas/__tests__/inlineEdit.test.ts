import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import {
  canFocusFieldBinding,
  canInlineEditLayer,
  caretIndexFromPoint,
  fieldDesignLabel,
  fitTextHeightMm,
  growTextLayerToContent,
  inlineEditLayerChanged,
  isButtonLikeKeyboardTarget,
  isEditableKeyboardTarget,
  isLayerListKeyboardTarget,
  isTypeToEditKey,
  justifyContentForTextAlign,
  toggleInlineTextStyle,
  wordRangeAt,
} from '../ops/inlineEdit';
import { parseMm } from '../types';

describe('canInlineEditLayer', () => {
  it('allows unlocked visible text layers', () => {
    expect(canInlineEditLayer(createLayer('text'))).toBe(true);
  });

  it('rejects field, locked, and hidden layers', () => {
    expect(canInlineEditLayer(createLayer('field'))).toBe(false);
    expect(canInlineEditLayer(createLayer('text', { locked: true }))).toBe(false);
    expect(canInlineEditLayer(createLayer('text', { visible: false }))).toBe(false);
    expect(canInlineEditLayer(createLayer('rect'))).toBe(false);
  });
});

describe('canFocusFieldBinding', () => {
  it('allows unlocked field layers only', () => {
    expect(canFocusFieldBinding(createLayer('field'))).toBe(true);
    expect(canFocusFieldBinding(createLayer('field', { locked: true }))).toBe(false);
    expect(canFocusFieldBinding(createLayer('text'))).toBe(false);
  });
});

describe('fieldDesignLabel', () => {
  it('prefers fallback sample text over binding token', () => {
    const withFallback = createLayer('field', { meta: { key: 'NIS', fallback: '12345' } });
    expect(fieldDesignLabel(withFallback)).toBe('12345');
    const emptyFallback = createLayer('field', { meta: { key: 'NIS', fallback: '' } });
    expect(fieldDesignLabel(emptyFallback)).toBe('{{ NIS }}');
    const noMeta = createLayer('field', { meta: undefined });
    expect(fieldDesignLabel(noMeta)).toBe('{{ FIELD }}');
  });
});

describe('justifyContentForTextAlign', () => {
  it('maps left / center / right to flex justification', () => {
    expect(justifyContentForTextAlign('left')).toBe('flex-start');
    expect(justifyContentForTextAlign('center')).toBe('center');
    expect(justifyContentForTextAlign('right')).toBe('flex-end');
    expect(justifyContentForTextAlign(undefined)).toBe('flex-start');
  });
});

describe('isTypeToEditKey', () => {
  it('accepts printable characters without modifiers', () => {
    expect(isTypeToEditKey('a')).toBe(true);
    expect(isTypeToEditKey('T')).toBe(true);
    expect(isTypeToEditKey('1')).toBe(true);
    expect(isTypeToEditKey('.')).toBe(true);
    expect(isTypeToEditKey('e')).toBe(true);
  });

  it('rejects space, modifiers, and non-character keys', () => {
    expect(isTypeToEditKey(' ')).toBe(false);
    expect(isTypeToEditKey('a', { ctrlKey: true })).toBe(false);
    expect(isTypeToEditKey('e', { ctrlKey: true })).toBe(false);
    expect(isTypeToEditKey('Enter')).toBe(false);
    expect(isTypeToEditKey('Backspace')).toBe(false);
  });
});

describe('isEditableKeyboardTarget', () => {
  it('detects input, textarea, select, and contentEditable', () => {
    expect(isEditableKeyboardTarget({ tagName: 'INPUT' } as HTMLElement)).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: 'TEXTAREA' } as HTMLElement)).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: 'SELECT' } as HTMLElement)).toBe(true);
    expect(
      isEditableKeyboardTarget({ tagName: 'DIV', isContentEditable: true } as HTMLElement),
    ).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: 'DIV', isContentEditable: false } as HTMLElement)).toBe(
      false,
    );
    expect(isEditableKeyboardTarget(null)).toBe(false);
  });
});

describe('canvas chrome keyboard targets', () => {
  it('detects the layer list so arrow keys can navigate rows instead of nudging', () => {
    const list = document.createElement('ul');
    list.setAttribute('data-testid', 'canvas-layer-list');
    const row = document.createElement('button');
    list.appendChild(row);
    expect(isLayerListKeyboardTarget(list)).toBe(true);
    expect(isLayerListKeyboardTarget(row)).toBe(true);
    expect(isLayerListKeyboardTarget(document.createElement('div'))).toBe(false);
  });

  it('detects buttons so Space activates them instead of switching to the hand tool', () => {
    const button = document.createElement('button');
    const roleButton = document.createElement('div');
    roleButton.setAttribute('role', 'button');
    expect(isButtonLikeKeyboardTarget(button)).toBe(true);
    expect(isButtonLikeKeyboardTarget(roleButton)).toBe(true);
    expect(isButtonLikeKeyboardTarget(document.createElement('div'))).toBe(false);
  });
});

describe('wordRangeAt', () => {
  it('selects the whole word around the caret', () => {
    expect(wordRangeAt('hola mundo', 7)).toEqual({ start: 5, end: 10 });
    expect(wordRangeAt('hola mundo', 5)).toEqual({ start: 5, end: 10 });
    expect(wordRangeAt('hola mundo', 0)).toEqual({ start: 0, end: 4 });
  });

  it('selects runs of spaces or punctuation as their own token', () => {
    expect(wordRangeAt('hola  mundo', 4)).toEqual({ start: 4, end: 6 });
    expect(wordRangeAt('a-b', 1)).toEqual({ start: 1, end: 2 });
  });

  it('treats accented letters as word characters', () => {
    expect(wordRangeAt('señor lópez', 2)).toEqual({ start: 0, end: 5 });
  });

  it('collapses to a caret at the end or on empty text', () => {
    expect(wordRangeAt('hola', 4)).toEqual({ start: 4, end: 4 });
    expect(wordRangeAt('hola', 99)).toEqual({ start: 4, end: 4 });
    expect(wordRangeAt('', 0)).toEqual({ start: 0, end: 0 });
    expect(wordRangeAt('hola', -3)).toEqual({ start: 0, end: 4 });
  });
});

describe('caretIndexFromPoint', () => {
  it('returns null when the platform lacks caret hit-testing', () => {
    const root = document.createElement('div');
    root.textContent = 'hola';
    document.body.appendChild(root);
    try {
      expect(caretIndexFromPoint(root, 5, 5)).toBeNull();
    } finally {
      root.remove();
    }
  });

  it('reads the offset from caretPositionFromPoint when the node is a text child', () => {
    const root = document.createElement('div');
    const span = document.createElement('span');
    span.textContent = 'hola';
    root.appendChild(span);
    document.body.appendChild(root);
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    const prev = doc.caretPositionFromPoint;
    doc.caretPositionFromPoint = () => ({ offsetNode: span.firstChild as Node, offset: 2 });
    try {
      expect(caretIndexFromPoint(root, 1, 1)).toBe(2);
      doc.caretPositionFromPoint = () => ({ offsetNode: span, offset: 0 });
      expect(caretIndexFromPoint(root, 1, 1)).toBeNull();
      doc.caretPositionFromPoint = () => ({ offsetNode: document.body, offset: 0 });
      expect(caretIndexFromPoint(root, 1, 1)).toBeNull();
    } finally {
      doc.caretPositionFromPoint = prev;
      root.remove();
    }
  });
});

describe('toggleInlineTextStyle', () => {
  it('toggles bold between 400 and 700', () => {
    const base = createLayer('text');
    const bold = toggleInlineTextStyle(base, 'bold');
    expect(bold.cssVars['--font-weight']).toBe('700');
    expect(toggleInlineTextStyle(bold, 'bold').cssVars['--font-weight']).toBe('400');
    const alreadyBold = createLayer('text', { cssVars: { ...base.cssVars, '--font-weight': '700' } });
    expect(toggleInlineTextStyle(alreadyBold, 'bold').cssVars['--font-weight']).toBe('400');
  });

  it('toggles italic and underline without touching the other key', () => {
    const base = createLayer('text');
    const italic = toggleInlineTextStyle(base, 'italic');
    expect(italic.cssVars['--font-style']).toBe('italic');
    expect(toggleInlineTextStyle(italic, 'italic').cssVars['--font-style']).toBe('');
    const underlined = toggleInlineTextStyle(base, 'underline');
    expect(underlined.cssVars['--text-decoration']).toBe('underline');
    const struck = createLayer('text', {
      cssVars: { ...base.cssVars, '--text-decoration': 'line-through' },
    });
    expect(toggleInlineTextStyle(struck, 'underline').cssVars['--text-decoration']).toBe('underline');
  });
});

describe('inlineEditLayerChanged', () => {
  it('detects value and cssVars changes but not clones', () => {
    const base = createLayer('text', { value: 'Hola' });
    const clone = { ...base, cssVars: { ...base.cssVars } };
    expect(inlineEditLayerChanged(base, clone)).toBe(false);
    expect(inlineEditLayerChanged(base, { ...base, value: 'Otra' })).toBe(true);
    const styled = toggleInlineTextStyle(base, 'bold');
    expect(inlineEditLayerChanged(base, styled)).toBe(true);
  });
});

describe('fitTextHeightMm / growTextLayerToContent', () => {
  it('grows height to fit content and never shrinks', () => {
    expect(fitTextHeightMm(8, 100, 1)).toBeGreaterThan(8);
    expect(fitTextHeightMm(40, 10, 1)).toBe(40);
  });

  it('updates text layer cssVars height when content needs more space', () => {
    const layer = createLayer('text');
    layer.cssVars['--height'] = '8mm';
    const grown = growTextLayerToContent(layer, 80, 1);
    expect(parseMm(grown.cssVars['--height'])).toBeGreaterThan(8);
    const same = growTextLayerToContent(layer, 5, 1);
    expect(same).toBe(layer);
  });
});
