import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import {
  canFocusFieldBinding,
  canInlineEditLayer,
  fieldDesignLabel,
  fitTextHeightMm,
  growTextLayerToContent,
  isEditableKeyboardTarget,
  isTypeToEditKey,
  justifyContentForTextAlign,
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
