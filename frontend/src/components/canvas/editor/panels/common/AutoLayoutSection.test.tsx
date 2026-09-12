import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createLayer } from '../../../constants';
import { defaultAutoLayout } from '../../../ops/autoLayout';
import type { CanvasLayer } from '../../../types';
import type { SectionProps } from '../types';
import AutoLayoutSection from './AutoLayoutSection';

function propsFor(layer: CanvasLayer): SectionProps {
  return {
    layer,
    pageColors: [],
    onChange: () => {},
    mapLive: () => {},
    emitLive: () => {},
    setVar: () => {},
    setVarLive: () => {},
    setVars: () => {},
    setVarsLive: () => {},
    setMeta: () => {},
    setMetaLive: () => {},
    onAlign: () => {},
    zOrder: {
      onBringFront: () => {},
      onBringForward: () => {},
      onSendBack: () => {},
      onSendBackward: () => {},
    },
    isLine: false,
    showRadius: false,
    hasFill: false,
    hasStroke: false,
    strokeWeightPx: 1,
    strokeWeightPct: 1,
    setStrokeWeight: () => {},
    exportScale: 1,
    setExportScale: () => {},
    exporting: false,
    setExporting: () => {},
  };
}

describe('AutoLayoutSection', () => {
  it('resets independent padding UI when selection changes to a uniform layout', () => {
    const asymmetric = createLayer('rect', {
      id: 'asymmetric',
      meta: { autoLayout: { ...defaultAutoLayout(), padTopMm: 2 } },
    });
    const uniform = createLayer('rect', {
      id: 'uniform',
      meta: { autoLayout: defaultAutoLayout() },
    });
    const { rerender } = render(<AutoLayoutSection {...propsFor(asymmetric)} />);

    expect(screen.getByTitle('Usar padding uniforme')).toBeTruthy();

    rerender(<AutoLayoutSection {...propsFor(uniform)} />);

    expect(screen.getByTitle('Configurar padding por lados independientes')).toBeTruthy();
  });
});
