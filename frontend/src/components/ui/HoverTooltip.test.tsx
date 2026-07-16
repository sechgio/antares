import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HoverTooltip, WithHoverTooltip } from './HoverTooltip';

describe('HoverTooltip', () => {
  it('supports top and left placements', () => {
    const { rerender } = render(
      <HoverTooltip label="Top tip" groupHoverClass="group-hover:opacity-100" placement="top" />,
    );
    expect(screen.getByRole('tooltip')).toHaveClass('bottom-full');

    rerender(
      <HoverTooltip label="Left tip" groupHoverClass="group-hover:opacity-100" placement="left" />,
    );
    expect(screen.getByRole('tooltip')).toHaveClass('right-full');
  });
});

describe('WithHoverTooltip', () => {
  it('strips native title and shows a portaled tooltip on hover', () => {
    render(
      <div style={{ overflow: 'hidden', width: 40 }}>
        <WithHoverTooltip label="Renombrar" placement="right">
          <button type="button" title="Renombrar" aria-label="Renombrar">
            Edit
          </button>
        </WithHoverTooltip>
      </div>,
    );

    const button = screen.getByRole('button', { name: 'Renombrar' });
    expect(button).not.toHaveAttribute('title');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.mouseEnter(button.parentElement!);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Renombrar');
    expect(tip).toHaveClass('fixed');
    expect(tip.className).toMatch(/z-\[11000\]/);
    expect(document.body.contains(tip)).toBe(true);

    fireEvent.mouseLeave(button.parentElement!);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('does not render a tooltip when label is empty', () => {
    render(
      <WithHoverTooltip label="">
        <button type="button" aria-label="Sin tip">
          X
        </button>
      </WithHoverTooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Sin tip' }).parentElement!);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
