import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PreviewPanel from './PreviewPanel';
import { createEmptyClientReport } from './testFixtures';

describe('Informes v2 PreviewPanel', () => {
  it('renders header fields and 3x2 photo grid', () => {
    const report = createEmptyClientReport(1);
    report.header.estacion = 'R 900 Elevado';
    report.header.distrito = 'Villa El Salvador';
    const photos = [
      { name: 'R-900-1.jpg', src: 'data:image/png;base64,a' },
      { name: 'R-900-2.jpg', src: 'data:image/png;base64,b' },
    ];

    render(<PreviewPanel report={report} logoLeft={null} logoRight={null} photos={photos} />);

    expect(screen.getByTestId('iv2-preview')).toBeInTheDocument();
    expect(screen.getByText(/R 900 Elevado/)).toBeInTheDocument();
    expect(screen.getByText(/DISTRITO:/)).toBeInTheDocument();
    expect(screen.getAllByText(/Villa El Salvador/).length).toBeGreaterThan(0);
    const grid = screen.getByTestId('iv2-photo-grid');
    expect(grid.children).toHaveLength(6);
    expect(grid.querySelectorAll('img')).toHaveLength(2);
  });
});
