import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SyncStatusBadge from '../editor/SyncStatusBadge';

describe('SyncStatusBadge', () => {
  it('renders synced status and hides when idle', () => {
    const { rerender, container } = render(<SyncStatusBadge status="synced" />);
    expect(screen.getByLabelText('Sincronizado con la nube')).toBeInTheDocument();

    rerender(<SyncStatusBadge status="idle" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders syncing state with spinner', () => {
    render(<SyncStatusBadge status="syncing" />);
    expect(screen.getByLabelText('Sincronizando cambios en la nube')).toBeInTheDocument();
  });

  it('renders error state', () => {
    render(<SyncStatusBadge status="error" />);
    expect(screen.getByLabelText('Error al sincronizar con la nube — reintentando')).toBeInTheDocument();
  });
});

