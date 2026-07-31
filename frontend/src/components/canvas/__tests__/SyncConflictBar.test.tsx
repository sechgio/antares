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
  it('renders icon actions next to tools chrome', () => {
    const onResolve = vi.fn();
    render(<SyncConflictBar conflict={makeConflict()} onResolve={onResolve} />);

    expect(screen.getByTestId('sync-conflict-bar')).toBeInTheDocument();
    expect(screen.getByTestId('sync-conflict-keep-local')).toHaveAttribute(
      'aria-label',
      'Mantener mi versión',
    );
    expect(screen.getByTestId('sync-conflict-use-remote')).toHaveAttribute(
      'aria-label',
      'Usar versión en la nube',
    );
  });

  it('keeps local on HardDrive icon', () => {
    const onResolve = vi.fn();
    render(<SyncConflictBar conflict={makeConflict()} onResolve={onResolve} />);

    fireEvent.click(screen.getByTestId('sync-conflict-keep-local'));
    expect(onResolve).toHaveBeenCalledWith('keep-local');
  });

  it('does not dismiss on Escape', () => {
    const onResolve = vi.fn();
    render(<SyncConflictBar conflict={makeConflict()} onResolve={onResolve} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('uses remote on CloudDownload icon', () => {
    const onResolve = vi.fn();
    render(<SyncConflictBar conflict={makeConflict()} onResolve={onResolve} />);

    fireEvent.click(screen.getByTestId('sync-conflict-use-remote'));
    expect(onResolve).toHaveBeenCalledWith('use-remote');
  });
});
