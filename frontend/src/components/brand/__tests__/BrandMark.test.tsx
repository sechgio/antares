import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import BrandMark from '../BrandMark';

describe('BrandMark', () => {
  it('renders the Precision Linear lockup with accessible product label', () => {
    render(<BrandMark showText tagline="Orden tecnico para archivos visuales" />);

    expect(screen.getByLabelText('COSMO logo')).toBeInTheDocument();
    expect(screen.getByText('COSMO')).toBeInTheDocument();
    expect(screen.getByText('Orden tecnico para archivos visuales')).toBeInTheDocument();
  });
});
