import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Sidebar from '../Sidebar';

describe('Sidebar', () => {
  it('does not show the removed brand tagline', () => {
    const removedTagline = ['Precision', 'tools'].join(' ');

    render(
      <Sidebar
        activeTab="convert"
        onTabChange={vi.fn()}
      />,
    );

    expect(screen.queryByText(removedTagline)).not.toBeInTheDocument();
  });

  it('does not render the removed sidebar search shortcut', () => {
    render(
      <Sidebar
        activeTab="convert"
        onTabChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('Buscar')).not.toBeInTheDocument();
    expect(screen.queryByText('Ctrl+K')).not.toBeInTheDocument();
  });
});
