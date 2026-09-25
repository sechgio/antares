import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAnchoredPopover } from './useAnchoredPopover';

function Harness({
  estimatedHeight = 100,
  estimatedWidth = 100,
  align,
  direction,
  gap,
  matchTriggerWidth,
  maxHeightCap,
  positioner,
  name = 'trigger',
}: {
  estimatedHeight?: number;
  estimatedWidth?: number;
  align?: 'start' | 'end' | 'center';
  direction?: 'auto' | 'up' | 'down';
  gap?: number;
  matchTriggerWidth?: boolean;
  maxHeightCap?: number;
  positioner?: (trigger: DOMRect, popup: HTMLElement | null) => { top: number; left: number; width: number; maxHeight?: number };
  name?: string;
}) {
  const { isOpen, position, triggerRef, popupRef, toggle } = useAnchoredPopover({
    estimatedHeight,
    estimatedWidth,
    align,
    direction,
    gap,
    matchTriggerWidth,
    maxHeightCap,
    positioner,
  });
  return (
    <div>
      <button ref={triggerRef} type="button" onClick={toggle}>
        {name}
      </button>
      {isOpen && (
        <div
          ref={popupRef}
          data-testid={`popup-${name}`}
          style={
            position
              ? {
                  top: position.top,
                  left: position.left,
                  width: position.width,
                  maxHeight: position.maxHeight,
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

describe('useAnchoredPopover', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens with computed position and closes on toggle', () => {
    render(<Harness />);
    expect(screen.queryByTestId('popup-trigger')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('trigger'));
    const popup = screen.getByTestId('popup-trigger');
    expect(popup).toHaveStyle({ top: '6px', left: '8px', width: '100px' });

    fireEvent.click(screen.getByText('trigger'));
    expect(screen.queryByTestId('popup-trigger')).not.toBeInTheDocument();
  });

  it('closes on Escape and outside mousedown', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('trigger'));
    expect(screen.getByTestId('popup-trigger')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('popup-trigger')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('trigger'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('popup-trigger')).not.toBeInTheDocument();
  });

  it('closes other instances when a new popover opens', () => {
    render(
      <>
        <Harness name="first" />
        <Harness name="second" />
      </>,
    );

    fireEvent.click(screen.getByText('first'));
    expect(screen.getByTestId('popup-first')).toBeInTheDocument();

    fireEvent.click(screen.getByText('second'));
    expect(screen.queryByTestId('popup-first')).not.toBeInTheDocument();
    expect(screen.getByTestId('popup-second')).toBeInTheDocument();
  });

  it('opens upward when there is no room below', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 700, bottom: 710, left: 20, right: 120, width: 100, height: 10, x: 20, y: 700,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100);

    render(<Harness estimatedHeight={100} />);
    fireEvent.click(screen.getByText('trigger'));

    // top = 700 - 100 - 6 = 594
    expect(screen.getByTestId('popup-trigger')).toHaveStyle({ top: '594px' });
  });

  it('aligns end relative to the trigger right edge', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0, bottom: 10, left: 500, right: 600, width: 100, height: 10, x: 500, y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    render(<Harness align="end" estimatedWidth={150} />);
    fireEvent.click(screen.getByText('trigger'));

    // left = rect.right - width = 600 - 150 = 450
    expect(screen.getByTestId('popup-trigger')).toHaveStyle({ left: '450px', width: '150px' });
  });

  it('repositions on window resize and scroll', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('trigger'));
    const popup = screen.getByTestId('popup-trigger');
    expect(popup).toHaveStyle({ top: '6px' });

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 40, bottom: 50, left: 30, right: 130, width: 100, height: 10, x: 30, y: 40,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent(window, new Event('resize'));
    // top = 50 + 6 = 56, left = 30
    expect(popup).toHaveStyle({ top: '56px', left: '30px' });
  });

  it('pins direction down even when space below is tight', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 700, bottom: 710, left: 20, right: 120, width: 100, height: 10, x: 20, y: 700,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100);

    render(<Harness direction="down" estimatedHeight={100} />);
    fireEvent.click(screen.getByText('trigger'));

    // stays below: top = min(710 + 6, 768 - 100 - 8) = 660
    expect(screen.getByTestId('popup-trigger')).toHaveStyle({ top: '660px' });
  });

  it('fits maxHeight to the space below when capped', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 400, bottom: 410, left: 20, right: 120, width: 100, height: 10, x: 20, y: 400,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(500);

    render(<Harness maxHeightCap={224} estimatedHeight={500} />);
    fireEvent.click(screen.getByText('trigger'));

    // spaceBelow = 768 - 410 - 6 = 352 → maxHeight = min(224, max(80, 352)) = 224
    expect(screen.getByTestId('popup-trigger')).toHaveStyle({ maxHeight: '224px' });
  });

  it('matches the trigger width when matchTriggerWidth is set', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0, bottom: 10, left: 20, right: 190, width: 170, height: 10, x: 20, y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    render(<Harness matchTriggerWidth estimatedWidth={400} />);
    fireEvent.click(screen.getByText('trigger'));

    expect(screen.getByTestId('popup-trigger')).toHaveStyle({ width: '170px' });
  });

  it('delegates geometry to a custom positioner', () => {
    const positioner = vi.fn().mockReturnValue({ top: 12, left: 34, width: 240, maxHeight: 300 });
    render(<Harness positioner={positioner} />);
    fireEvent.click(screen.getByText('trigger'));

    expect(positioner).toHaveBeenCalled();
    expect(screen.getByTestId('popup-trigger')).toHaveStyle({ top: '12px', left: '34px', width: '240px', maxHeight: '300px' });
  });
});
