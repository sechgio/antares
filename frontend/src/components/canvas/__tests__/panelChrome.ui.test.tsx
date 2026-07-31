import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TopBar from '../editor/TopBar';
import { createLayer } from '../constants';
import RightPanel from '../editor/RightPanel';

const baseProps = {
  name: 'Doc',
  mode: 'design' as const,
  canUndo: false,
  canRedo: false,
  status: null,
  onNameChange: vi.fn(),
  onMode: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onSave: vi.fn(),
  onDuplicate: vi.fn(),
};

const rightPanelBase = {
  selectedCount: 1,
  pageColors: [] as string[],
  onChange: vi.fn(),
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

describe('TopBar UI lock', () => {
  it('toggles UI lock', () => {
    const onToggleUiLock = vi.fn();
    render(<TopBar {...baseProps} uiLocked={false} onToggleUiLock={onToggleUiLock} />);
    fireEvent.click(screen.getByTestId('canvas-ui-lock'));
    expect(onToggleUiLock).toHaveBeenCalledTimes(1);
  });

  it('keeps lock button clickable while locked', () => {
    const onToggleUiLock = vi.fn();
    render(<TopBar {...baseProps} uiLocked onToggleUiLock={onToggleUiLock} />);
    expect(screen.getByTestId('canvas-ui-lock')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('canvas-ui-lock'));
    expect(onToggleUiLock).toHaveBeenCalledTimes(1);
  });

  it('does not render panel toggles in TopBar', () => {
    render(<TopBar {...baseProps} uiLocked={false} onToggleUiLock={vi.fn()} />);
    expect(screen.queryByTestId('canvas-toggle-left-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('canvas-toggle-right-panel')).not.toBeInTheDocument();
  });

  it('aligns trailing actions to the right panel column when open', () => {
    const { container, rerender } = render(
      <TopBar {...baseProps} leftPanelOpen rightPanelOpen />,
    );
    expect(container.querySelector('.canvas-topbar-trailing--panel')).toBeTruthy();
    rerender(<TopBar {...baseProps} leftPanelOpen rightPanelOpen={false} />);
    expect(container.querySelector('.canvas-topbar-trailing--panel')).toBeNull();
    expect(container.querySelector('.canvas-topbar-trailing')).toBeTruthy();
  });

  it('renders sync conflict slot beside the UI lock tools', () => {
    render(
      <TopBar
        {...baseProps}
        onToggleUiLock={vi.fn()}
        syncConflictSlot={<div data-testid="sync-conflict-bar">sync</div>}
      />,
    );
    const tools = document.querySelector('.canvas-topbar-tools');
    expect(tools?.querySelector('[data-testid="sync-conflict-bar"]')).toBeTruthy();
    expect(document.querySelector('.canvas-topbar-trailing [data-testid="sync-conflict-bar"]')).toBeNull();
  });
});

describe('RightPanel hide control', () => {
  it('hides from button next to zoom and stays mounted when collapsed', () => {
    const onHidePanel = vi.fn();
    const layer = createLayer('rect');
    const { rerender } = render(
      <RightPanel {...rightPanelBase} layer={layer} open onHidePanel={onHidePanel} />,
    );

    expect(screen.getByTestId('canvas-zoom-slot')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('canvas-toggle-right-panel'));
    expect(onHidePanel).toHaveBeenCalledTimes(1);

    rerender(<RightPanel {...rightPanelBase} layer={layer} open={false} onHidePanel={onHidePanel} />);
    expect(screen.getByTestId('canvas-right-panel')).toHaveAttribute('data-open', 'false');
    expect(screen.getByTestId('canvas-zoom-slot')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-right-panel')).toHaveAttribute('aria-hidden', 'true');
  });

  it('disables hide when UI locked', () => {
    const onHidePanel = vi.fn();
    render(
      <RightPanel
        {...rightPanelBase}
        layer={createLayer('rect')}
        open
        onHidePanel={onHidePanel}
        hidePanelDisabled
      />,
    );
    expect(screen.getByTestId('canvas-toggle-right-panel')).toBeDisabled();
    fireEvent.click(screen.getByTestId('canvas-toggle-right-panel'));
    expect(onHidePanel).not.toHaveBeenCalled();
  });
});
