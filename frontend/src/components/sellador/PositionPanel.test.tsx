import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PositionPanel from './PositionPanel';

function setup(onRectChange = vi.fn()) {
  render(
    <PositionPanel
      positions={[{ id: 'p1', name: 'Posición 1', rect: { x: 10, y: 20, width: 100, height: 50 } }]}
      activeIndex={0}
      stampCount={1}
      slotIndices={[0]}
      assignmentMode="auto"
      onSelectPosition={vi.fn()}
      onAddPosition={vi.fn()}
      onRemovePosition={vi.fn()}
      onAssignmentModeChange={vi.fn()}
      onSlotChange={vi.fn()}
      onRectChange={onRectChange}
    />,
  );
  return onRectChange;
}

describe('PositionPanel numeric rect fields', () => {
  it('reports each typed value and keeps the draft until blur', () => {
    const onRectChange = setup();
    const width = screen.getByLabelText('Posición 1: Ancho en puntos') as HTMLInputElement;

    fireEvent.change(width, { target: { value: '5' } });
    expect(onRectChange).toHaveBeenLastCalledWith(0, { x: 10, y: 20, width: 5, height: 50 });
    // El padre sigue mostrando 100 (valor limitado): el borrador no se pisa.
    expect(width.value).toBe('5');

    fireEvent.blur(width);
    expect(width.value).toBe('100');
  });

  it('ignores an emptied field', () => {
    const onRectChange = setup();
    fireEvent.change(screen.getByLabelText('Posición 1: X en puntos'), { target: { value: '' } });
    expect(onRectChange).not.toHaveBeenCalled();
  });
});
