import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import {
  canFocusFieldBinding,
  canInlineEditLayer,
  fieldDesignLabel,
  isEditableKeyboardTarget,
  justifyContentForTextAlign,
} from '../ops/inlineEdit';

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
