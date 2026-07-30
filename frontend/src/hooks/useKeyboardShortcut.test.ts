import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcut } from './useKeyboardShortcut';

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
});
