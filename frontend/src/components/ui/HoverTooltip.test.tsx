import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { computeTooltipPosition, HoverTooltip, WithHoverTooltip } from './HoverTooltip';

describe('computeTooltipPosition', () => {
  const viewport = { width: 1000, height: 800 };

  it('clamps a bottom tooltip so the full label stays inside the viewport', () => {
    const trigger = { top: 8, right: 992, bottom: 40, left: 960, width: 32, height: 32 };
    const tip = { width: 180, height: 28 };
    const pos = computeTooltipPosition(trigger, tip, 'bottom', viewport);

    expect(pos.left).toBe(812);
    expect(pos.left + tip.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(pos.top).toBe(48);
    expect(pos.placement).toBe('bottom');
  });

  it('flips from bottom to top when there is no space below', () => {
    const trigger = { top: 760, right: 200, bottom: 792, left: 160, width: 40, height: 32 };
    const pos = computeTooltipPosition(trigger, { width: 120, height: 40 }, 'bottom', viewport);
    expect(pos.placement).toBe('top');
    expect(pos.top).toBe(712);
  });

  it('flips from right to left when there is no space on the right', () => {
    const trigger = { top: 40, right: 990, bottom: 72, left: 958, width: 32, height: 32 };
    const pos = computeTooltipPosition(trigger, { width: 160, height: 28 }, 'right', viewport);
    expect(pos.placement).toBe('left');
    expect(pos.left + 160).toBeLessThanOrEqual(trigger.left);
  });
});

describe('HoverTooltip', () => {
  it('keeps a bare tooltip out of the accessibility tree until the trigger is active', () => {
    render(
      <button type="button" aria-label="Top tip">
        Action
        <HoverTooltip label="Top tip" placement="top" />
      </button>,
    );

    const trigger = screen.getByRole('button', { name: 'Top tip' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.focus(trigger);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveClass('fixed');
    expect(tip).toHaveTextContent('Top tip');
    expect(document.body.contains(tip)).toBe(true);

    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
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
    expect(tip.className).toMatch(/bg-\[#1e1e1e\]/);
    expect(tip.querySelector('span[aria-hidden="true"]')).toBeInTheDocument();
    expect(tip.style.transform).not.toMatch(/translateX\(-50%\)/);
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

  it('shows and hides the tooltip for keyboard focus', () => {
    render(
      <WithHoverTooltip label="Acción accesible">
        <button type="button" aria-label="Acción accesible">A</button>
      </WithHoverTooltip>,
    );

    const button = screen.getByRole('button', { name: 'Acción accesible' });
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Acción accesible');

    fireEvent.blur(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('renders dark Figma-style tooltip with shortcut', () => {
    render(
      <WithHoverTooltip label="Acciones" shortcut="Ctrl+," placement="top" variant="dark">
        <button type="button" aria-label="Acciones">
          *
        </button>
      </WithHoverTooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Acciones' }).parentElement!);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Acciones');
    expect(tip).toHaveTextContent('Ctrl+,');
    expect(tip.className).toMatch(/bg-\[#1e1e1e\]/);
    expect(tip).toHaveClass('fixed');
    expect(tip).not.toHaveClass('relative');
  });

  it('keeps the full label when the trigger sits against the right edge', () => {
    render(
      <div style={{ position: 'absolute', right: 0 }}>
        <WithHoverTooltip label="Actualizar vista previa" placement="bottom">
          <button type="button" aria-label="Actualizar vista previa">
            Refresh
          </button>
        </WithHoverTooltip>
      </div>,
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Actualizar vista previa' }).parentElement!);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Actualizar vista previa');
  });
});
