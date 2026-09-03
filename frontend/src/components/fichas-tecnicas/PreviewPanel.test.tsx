import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PreviewPanel from './PreviewPanel';
import { createEmptyFicha } from './types';

describe('PreviewPanel (layout sech-gio)', () => {
  it('renders full A4 structure when no ficha is selected (empty plantilla)', () => {
    render(<PreviewPanel ficha={null} logoLeft={null} />);

    const paper = screen.getByTestId('ficha-preview-paper');
    expect(paper).toHaveAttribute('data-template', 'true');
    expect(screen.getByText('FICHA TÉCNICA DE EVALUACIÓN DE ACTIVIDADES')).toBeInTheDocument();
    expect(screen.getByText('SERVICIO A EFECTUAR')).toBeInTheDocument();
    expect(screen.getByText('DIAGNÓSTICO DEL ÁREA A TRATAR')).toBeInTheDocument();
    expect(screen.getByText('CONDICIÓN SANITARIA DE LA ZONA CIRCUNDANTE')).toBeInTheDocument();
    expect(screen.getByText('TIPOS DE TRATAMIENTO')).toBeInTheDocument();
    expect(screen.getByText('PRODUCTOS QUÍMICOS Y/O BIOLÓGICOS UTILIZADOS')).toBeInTheDocument();
    expect(screen.getByText('ACCIONES CORRECTIVAS')).toBeInTheDocument();
    expect(screen.getByText('ÁREAS TRATADAS')).toBeInTheDocument();
    expect(screen.getByText('PERSONAL TÉCNICO')).toBeInTheDocument();
    expect(screen.getByText('OBSERVACIONES')).toBeInTheDocument();
    expect(screen.getByText('RECOMENDACIONES')).toBeInTheDocument();
    expect(screen.getByText('EVALUACIÓN DE SATISFACCIÓN DEL CLIENTE')).toBeInTheDocument();
    expect(screen.getByText('Responsable de Servicio')).toBeInTheDocument();
    expect(screen.getByText('Director Técnico')).toBeInTheDocument();
    expect(screen.getByText('Mz J1 lote 20. Urb. Los Precursores. Surco. Lima')).toBeInTheDocument();
    expect(screen.getByText('operaciones@hidroserviciosaa.com.pe')).toBeInTheDocument();
    expect(screen.getByText('+51 946 803 367')).toBeInTheDocument();
    expect(screen.getByText('www.hidroserviciosaa.com.pe/')).toBeInTheDocument();
    expect(screen.queryByText('NOMBRE DEL CLIENTE')).not.toBeInTheDocument();
  });

  it('renders live ficha data when selected', () => {
    const ficha = {
      ...createEmptyFicha(),
      id: 'FT-00001',
      os_numero: 'OS-12-345',
      cliente: 'Cliente Real',
      direccion: 'Av. Test 123',
      distrito: 'Miraflores',
      fecha: '2026-03-15',
    };

    render(<PreviewPanel ficha={ficha} logoLeft={null} />);

    expect(screen.getByTestId('ficha-preview-paper')).toHaveAttribute('data-template', 'false');
    expect(screen.getByText('Cliente Real')).toBeInTheDocument();
    expect(screen.getByText('Av. Test 123')).toBeInTheDocument();
    expect(screen.getByText('Miraflores')).toBeInTheDocument();
    expect(screen.getByText('12345')).toBeInTheDocument();
    expect(screen.getByText('15-03-2026')).toBeInTheDocument();
  });

  it('renders the left logo in preview when provided', () => {
    const ficha = { ...createEmptyFicha(), id: 'FT-00002', cliente: 'Con Logo' };

    render(<PreviewPanel ficha={ficha} logoLeft="data:image/png;base64,FICHALOGO" />);

    expect(screen.getByAltText('Logo')).toHaveAttribute('src', 'data:image/png;base64,FICHALOGO');
  });

  it('omits the logo image when logoLeft is null', () => {
    render(<PreviewPanel ficha={createEmptyFicha()} logoLeft={null} />);

    expect(screen.queryByAltText('Logo')).not.toBeInTheDocument();
  });
});
