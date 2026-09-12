import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useContextMenuSurface } from './useContextMenuSurface';

function Harness({ onClose }: { onClose: () => void }) {
  const ref = useContextMenuSurface(2000, 2000, onClose);
  return <div ref={ref} data-testid="menu"><span>inside</span></div>;
}

describe('useContextMenuSurface', () => {
  it('clamps position and closes on Escape or an outside click', () => {
    const onClose = vi.fn();
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 100,
      height: 80,
      x: 0,
      y: 0,
      top: 0,
      right: 100,
      bottom: 80,
      left: 0,
      toJSON: () => ({}),
    });
    const { getByTestId, getByText } = render(<Harness onClose={onClose} />);
    const menu = getByTestId('menu');

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(getByText('inside'));
    fireEvent.mouseDown(document.body);

    expect(onClose).toHaveBeenCalledTimes(2);
    expect(menu).toHaveStyle({
      left: `${window.innerWidth - 108}px`,
      top: `${window.innerHeight - 88}px`,
    });
    rectSpy.mockRestore();
  });
});
