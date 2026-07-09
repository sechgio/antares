import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  consumeEspaciosFocusTarget,
  ESPACIOS_FOCUS_EVENT,
  writeEspaciosFocusTarget,
} from '../utils/focusTarget';

describe('focusTarget', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('writes, dispatches, and consumes once', () => {
    const handler = vi.fn();
    window.addEventListener(ESPACIOS_FOCUS_EVENT, handler);

    writeEspaciosFocusTarget({
      tareaId: 't1',
      proyectoId: 'p1',
      espacioId: 'e1',
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(consumeEspaciosFocusTarget()).toEqual({
      tareaId: 't1',
      proyectoId: 'p1',
      espacioId: 'e1',
    });
    expect(consumeEspaciosFocusTarget()).toBeNull();

    window.removeEventListener(ESPACIOS_FOCUS_EVENT, handler);
  });
});
