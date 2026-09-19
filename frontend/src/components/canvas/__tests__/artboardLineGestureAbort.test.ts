import { describe, expect, it, vi } from 'vitest';
import type { MutableRefObject, RefObject } from 'react';
import { createLayer } from '../constants';
import { createArtboardToolGestures } from '../editor/artboardToolGestures';
import { createArtboardPathGapGestures } from '../editor/artboardTransformGestures';
import type { PointerGestureSessionOptions } from '../ops/pointerGestureSession';
import type { CanvasLayer } from '../types';

// El dueno del gesto graba las opciones de la sesion para poder disparar onAbort
// sin tener que simular un pointercancel real desde el arbol de React.
function sessionRecorder() {
  let options: PointerGestureSessionOptions | null = null;
  const pointerGestures = {
    start(next: PointerGestureSessionOptions) {
      options = next;
      return { aborted: false, abort: () => {}, dispose: () => {} };
    },
    abort: () => {},
    dispose: () => {},
  };
  return {
    pointerGestures,
    abort: () => {
      const onAbort = options?.onAbort;
      expect(onAbort, 'la sesion no abrio una via de abort').toBeTypeOf('function');
      onAbort!();
    },
  };
}

const pointerDown = (overrides: Record<string, unknown> = {}) => ({
  stopPropagation: () => {},
  preventDefault: () => {},
  clientX: 10,
  clientY: 10,
  button: 0,
  ...overrides,
});

function toolGestures(line: CanvasLayer, abortGesturePreview = vi.fn()) {
  const recorder = sessionRecorder();
  const layersRef: MutableRefObject<CanvasLayer[]> = { current: [line] };
  const frameRef: RefObject<HTMLDivElement | null> = { current: document.createElement('div') };
  const gestures = createArtboardToolGestures({
    frameRef,
    zoomRef: { current: 1 },
    layersRef,
    pinchGestureRef: { current: false },
    drawStart: { current: null },
    selectedIdsRef: { current: [line.id] },
    pointerGestures: recorder.pointerGestures,
    selectedIds: [line.id],
    displayLayers: [line],
    pathEditingLayerId: line.id,
    placing: false,
    tool: 'bend',
    onDrawLayer: () => {},
    onStartPathEdit: () => {},
    onChangeLayers: () => {},
    onSelectIds: () => {},
    applyGestureLayers: () => {},
    endGesture: () => {},
    abortGesturePreview,
    setDraft: () => {},
    setLassoPts: () => {},
  });
  return { gestures, abort: recorder.abort, abortGesturePreview };
}

describe('abort de gestos de linea', () => {
  it('beginBend restaura el preview al cancelarse la sesion', () => {
    const { gestures, abort, abortGesturePreview } = toolGestures(createLayer('line'));
    gestures.beginBend(pointerDown());
    abort();
    expect(abortGesturePreview).toHaveBeenCalledTimes(1);
  });

  it('beginPathPointDrag restaura el preview al cancelarse la sesion', () => {
    const line = createLayer('line');
    const recorder = sessionRecorder();
    const frameRef: RefObject<HTMLDivElement | null> = { current: document.createElement('div') };
    const abortGesturePreview = vi.fn();
    const gestures = createArtboardPathGapGestures({
      frameRef,
      zoomRef: { current: 1 },
      layersRef: { current: [line] },
      gestureDirtyRef: { current: false },
      pointerGestures: recorder.pointerGestures,
      pathEditLayer: line,
      onCancelInertia: () => {},
      applyGestureLayers: () => {},
      endGesture: () => {},
      abortGesturePreview,
    });
    gestures.beginPathPointDrag(0, 'anchor', pointerDown());
    recorder.abort();
    expect(abortGesturePreview).toHaveBeenCalledTimes(1);
  });
});
