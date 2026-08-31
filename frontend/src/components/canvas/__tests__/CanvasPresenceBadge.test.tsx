import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CanvasPresenceBadge from '../editor/CanvasPresenceBadge';

const collaborator = {
  userId: 'user-2',
  displayName: 'Luis Pérez',
  mode: 'editing' as const,
  presenceKey: 'user-2',
};

describe('CanvasPresenceBadge', () => {
  it('hides when there is no active realtime state', () => {
    const { container } = render(<CanvasPresenceBadge collaborators={[]} status="idle" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows live state without collaborators', () => {
    render(<CanvasPresenceBadge collaborators={[]} status="live" />);
    expect(screen.getByRole('status', { name: 'Canvas en vivo' })).toBeInTheDocument();
  });

  it('shows collaborator count and names', () => {
    render(<CanvasPresenceBadge collaborators={[collaborator]} status="live" />);
    expect(screen.getByRole('status', { name: '1 colaborador conectado' })).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('retains known collaborators when the channel goes offline', () => {
    render(<CanvasPresenceBadge collaborators={[collaborator]} status="offline" />);
    expect(screen.getByRole('status', { name: '1 colaborador conectado' })).toHaveAttribute('data-status', 'offline');
  });

  it('shows connection errors', () => {
    render(<CanvasPresenceBadge collaborators={[]} status="error" />);
    expect(screen.getByRole('status', { name: 'Error de colaboración, reintentando' })).toBeInTheDocument();
  });
});
