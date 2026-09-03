import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ErrorBoundary from '../ErrorBoundary';

const ProblemChild = ({ shouldThrow = false }: { shouldThrow?: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test crash');
  }
  return <div>Normal Content</div>;
};

describe('ErrorBoundary Component', () => {
  it('renders children normally when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Normal Content')).toBeInTheDocument();
  });

  it('catches rendering errors and displays fallback UI', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Ocurrió un error inesperado en la interfaz')).toBeInTheDocument();
    expect(screen.getAllByText(/Test crash/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Reintentar/i })).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('resets error state when Reintentar button is clicked', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let throwError = true;
    const DynamicChild = () => {
      if (throwError) {
        throw new Error('Dynamic crash');
      }
      return <div>Recovered Content</div>;
    };

    const { rerender } = render(
      <ErrorBoundary>
        <DynamicChild />
      </ErrorBoundary>
    );

    expect(screen.getByText('Ocurrió un error inesperado en la interfaz')).toBeInTheDocument();

    throwError = false;
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/i }));

    rerender(
      <ErrorBoundary>
        <DynamicChild />
      </ErrorBoundary>
    );

    expect(screen.getByText('Recovered Content')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });
});
