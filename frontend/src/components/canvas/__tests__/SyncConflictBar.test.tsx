import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SyncConflictBar from '../editor/SyncConflictBar';
import type { SyncConflict } from '../sync/canvasCloudSync';
import { createEmptyDocument } from '../types';

function makeConflict(name = 'PANEL 2'): SyncConflict {
  const localDoc = createEmptyDocument();
  localDoc.name = name;
  localDoc.updatedAt = '2026-07-31T16:17:00.000Z';
  const remoteDoc = { ...localDoc, name, updatedAt: '2026-07-31T16:18:00.000Z' };
  return {
    localDoc,
    remoteDoc,
    localUpdatedAt: localDoc.updatedAt,
    remoteUpdatedAt: remoteDoc.updatedAt,
  };
}

describe('SyncConflictBar', () => {
  it('renders a non-modal chip with doc name and actions', () => {
    const onResolve = vi.fn();
    render(<SyncConflictBar conflict={makeConflict()} onResolve={onResolve} />);

    expect(screen.getByTestId('sync-conflict-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('sync-conflict-overlay')).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText(/PANEL 2/)).toBeInTheDocument();
  });

  it('keeps local on Mantener and Esc', () => {
    const onResolve = vi.fn();
    render(<SyncConflictBar conflict={makeConflict()} onResolve={onResolve} />);

    fireEvent.click(screen.getByTestId('sync-conflict-keep-local'));
    expect(onResolve).toHaveBeenCalledWith('keep-local');

    onResolve.mockClear();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onResolve).toHaveBeenCalledWith('keep-local');
  });

  it('uses remote on Actualizar', () => {
    const onResolve = vi.fn();
    render(<SyncConflictBar conflict={makeConflict()} onResolve={onResolve} />);

    fireEvent.click(screen.getByTestId('sync-conflict-use-remote'));
    expect(onResolve).toHaveBeenCalledWith('use-remote');
  });
});
