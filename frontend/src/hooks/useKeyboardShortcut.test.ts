import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimShellShortcuts, useKeyboardShortcut } from './useKeyboardShortcut';

function dispatchKey(target: EventTarget, key: string, opts: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  target.dispatchEvent(event);
  return event;
}

describe('useKeyboardShortcut', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('fires when focus is not in an editable field', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('k', cb, { ctrl: true }));
    dispatchKey(document.body, 'k', { ctrlKey: true });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('skips when target is input/textarea/select/contentEditable', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('k', cb, { ctrl: true }));

    const input = document.createElement('input');
    document.body.appendChild(input);
    dispatchKey(input, 'k', { ctrlKey: true });

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    dispatchKey(textarea, 'k', { ctrlKey: true });

    const select = document.createElement('select');
    document.body.appendChild(select);
    dispatchKey(select, 'k', { ctrlKey: true });

    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);
    dispatchKey(editable, 'k', { ctrlKey: true });

    expect(cb).not.toHaveBeenCalled();
  });

  it('fires in editable fields when allowInInput is true', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('k', cb, { ctrl: true, allowInInput: true }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    dispatchKey(input, 'k', { ctrlKey: true });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('yields only the chords a view claims', () => {
    const owned = vi.fn();
    const other = vi.fn();
    renderHook(() => useKeyboardShortcut('0', owned, { ctrl: true }));
    renderHook(() => useKeyboardShortcut('2', other, { ctrl: true }));
    claimShellShortcuts('canvas', ['ctrl+0']);
    try {
      dispatchKey(document.body, '0', { ctrlKey: true });
      dispatchKey(document.body, '2', { ctrlKey: true });
      expect(owned).not.toHaveBeenCalled();
      expect(other).toHaveBeenCalledTimes(1);
    } finally {
      claimShellShortcuts('canvas', null);
    }
    dispatchKey(document.body, '0', { ctrlKey: true });
    expect(owned).toHaveBeenCalledTimes(1);
  });

  it('stays silent while a modal dialog is open', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('1', cb, { ctrl: true }));
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    try {
      dispatchKey(document.body, '1', { ctrlKey: true });
      expect(cb).not.toHaveBeenCalled();
    } finally {
      dialog.remove();
    }
    dispatchKey(document.body, '1', { ctrlKey: true });
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
