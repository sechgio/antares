import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createLayer } from '../constants';
import RightPanel from '../editor/RightPanel';
import { EyeSlash, VisibilityIcon } from '../editor/VisibilityIcon';

describe('VisibilityIcon', () => {
  it('uses a full eye + slash for the hidden state (not Lucide EyeOff fragments)', () => {
    const { container, rerender } = render(<VisibilityIcon visible={false} className="h-3.5 w-3.5" />);
    const slash = screen.getByTestId('canvas-eye-slash');
    expect(slash.tagName.toLowerCase()).toBe('svg');
    // Full iris circle — Lucide EyeOff only keeps a truncated arc.
    expect(slash.querySelector('circle')).not.toBeNull();
    expect(slash.querySelectorAll('path')).toHaveLength(2);
    expect(container.querySelector('.lucide-eye-off')).toBeNull();

    rerender(<VisibilityIcon visible className="h-3.5 w-3.5" />);
    expect(screen.queryByTestId('canvas-eye-slash')).toBeNull();
    expect(container.querySelector('.lucide-eye')).not.toBeNull();
  });

  it('EyeSlash stays a single svg root (no stacked icons)', () => {
    const { container } = render(<EyeSlash className="h-3.5 w-3.5" />);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });
});

describe('RightPanel visibility toggle', () => {
  const panelProps = {
    selectedCount: 1,
    pageColors: [] as string[],
    onDelete: vi.fn(),
    onAlign: vi.fn(),
    onDistribute: vi.fn(),
    onBulkVisible: vi.fn(),
    onBulkLocked: vi.fn(),
    onBulkOpacity: vi.fn(),
    onBringFront: vi.fn(),
    onBringForward: vi.fn(),
    onSendBack: vi.fn(),
    onSendBackward: vi.fn(),
  };

  it('renders EyeSlash when the selected layer is hidden', () => {
    const layer = createLayer('rect', { visible: false });
    render(<RightPanel layer={layer} onChange={vi.fn()} {...panelProps} />);
    expect(screen.getByLabelText('Visible')).toContainElement(screen.getByTestId('canvas-eye-slash'));
  });
});
