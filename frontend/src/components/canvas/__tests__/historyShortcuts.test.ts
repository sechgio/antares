import { describe, expect, it } from 'vitest';
import { isEditableKeyboardTarget } from '../ops/inlineEdit';
import { matchHistoryShortcut } from '../ops/historyShortcuts';

describe('matchHistoryShortcut', () => {
  it('maps Ctrl+Z to undo (lowercase or CapsLock via code)', () => {
    expect(
      matchHistoryShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, code: 'KeyZ' }),
    ).toBe('undo');
    expect(
      matchHistoryShortcut({ ctrlKey: false, metaKey: true, shiftKey: false, code: 'KeyZ' }),
    ).toBe('undo');
  });

  it('maps Ctrl+Shift+Z to redo (Shift makes e.key "Z", code stays KeyZ)', () => {
    expect(
      matchHistoryShortcut({ ctrlKey: true, metaKey: false, shiftKey: true, code: 'KeyZ' }),
    ).toBe('redo');
  });

  it('maps Ctrl+Y to redo', () => {
    expect(
      matchHistoryShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, code: 'KeyY' }),
    ).toBe('redo');
  });

  it('ignores plain Z / Y without modifiers', () => {
    expect(
      matchHistoryShortcut({ ctrlKey: false, metaKey: false, shiftKey: false, code: 'KeyZ' }),
    ).toBeNull();
    expect(
      matchHistoryShortcut({ ctrlKey: false, metaKey: false, shiftKey: true, code: 'KeyZ' }),
    ).toBeNull();
  });

  it('inspector editable targets are detectable so CanvasView can skip history chords', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const div = document.createElement('div');
    expect(isEditableKeyboardTarget(input)).toBe(true);
    expect(isEditableKeyboardTarget(textarea)).toBe(true);
    expect(isEditableKeyboardTarget(div)).toBe(false);
    expect(
      matchHistoryShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, code: 'KeyZ' }),
    ).toBe('undo');
  });
});
