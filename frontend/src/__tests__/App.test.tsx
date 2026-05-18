import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';

describe('App', () => {
  it('shows an Electron-only message when the preload bridge is unavailable', () => {
    const electronAPI = window.electronAPI;
    window.electronAPI = undefined;

    render(<App />);

    expect(screen.getByText('Abre Antares desde la aplicacion de escritorio')).toBeInTheDocument();
    expect(screen.queryByText('Arrastra imágenes o videos aquí')).not.toBeInTheDocument();

    window.electronAPI = electronAPI;
  });

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

  it('keeps conversion empty-state actions visible before files are selected', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Seleccionar archivos/i })).toBeInTheDocument();
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

  it('opens Informes tecnicos from the sidebar', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Informes técnicos|Informes tecnicos/i }));

    expect(await screen.findByRole('heading', { name: /Informes técnicos|Informes tecnicos/i }, { timeout: 5000 })).toBeInTheDocument();
  });

  it('renders the image optimizer in a full-height workspace without the generic page padding', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Optimizador/i }));

    const heading = await screen.findByRole('heading', { name: /Image Optimizer/i }, { timeout: 5000 });
    const routeViewport = heading.closest('main')?.firstElementChild;

    expect(routeViewport).toBeInstanceOf(HTMLElement);
    expect(routeViewport).not.toHaveClass('px-6');
    expect(routeViewport).not.toHaveClass('py-6');
  });

  it('does not render removed section titles in the shared header for any tool', async () => {
    render(<App />);

    const removedHeaderTitles = [
      'Conversión',
      'Formatos PDF',
      'Generar Padrones',
      'Generar Volantes',
      'Reportes de Campo',
      'Informes técnicos',
      'Optimizador de Imágenes',
      'Generador Reportes',
      'Aviso de Corte',
      'Historial',
      'Apariencia',
    ];

    const toolButtons = [
      'Conversión',
      'Formatos PDF',
      'Generar Padrones',
      'Generar Volantes',
      'Reportes de Campo',
      'Informes técnicos',
      'Optimizador',
      'Generador Reportes',
      'Aviso de Corte',
      'Historial',
      'Apariencia',
    ];

    for (const label of toolButtons) {
      fireEvent.click(screen.getByTitle(label));
      const header = screen.getByTestId('app-header');
      expect(header).toHaveTextContent('Buscar');
      for (const title of removedHeaderTitles) {
        expect(header).not.toHaveTextContent(title);
      }
    }
  });

  it('opens search from the header button and Ctrl+K', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(screen.getByPlaceholderText('Buscar acción...')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Buscar acción...')).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(screen.getByPlaceholderText('Buscar acción...')).toBeInTheDocument();
  });
});
