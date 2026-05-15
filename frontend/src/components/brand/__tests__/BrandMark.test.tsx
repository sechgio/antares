import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import BrandMark from '../BrandMark';

describe('BrandMark', () => {
  it('renders the logo with accessible alt text and tagline', () => {
    render(<BrandMark showText tagline="Orden tecnico para archivos visuales" />);

    expect(screen.getByAltText('ANTARES')).toBeInTheDocument();
    expect(screen.getByText('Orden tecnico para archivos visuales')).toBeInTheDocument();
  });
});
