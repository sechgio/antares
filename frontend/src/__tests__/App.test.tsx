import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';

describe('App', () => {
  it('renders without crashing', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getAllByText('Conversión').length).toBeGreaterThan(0);
    });
  });

  it('shows conversion tab by default', async () => {
    render(<App />);
    expect(await screen.findByText('Arrastra imágenes o videos aquí', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('keeps start disabled until files and destination are ready', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Iniciar conversión/i })).toBeDisabled();
    });
  });

  it('has sidebar with navigation buttons', () => {
    render(<App />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(4);
  });

  it('opens Reportes de Campo from the sidebar', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Reportes de Campo/i }));

    expect(await screen.findByRole('heading', { name: /Paneles/i }, { timeout: 5000 })).toBeInTheDocument();
  });
});
