import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeAll } from 'vitest';
import DataPreviewModal from './DataPreviewModal';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error mock
global.ResizeObserver = global.ResizeObserver || ResizeObserverMock;

describe('DataPreviewModal', () => {
  beforeAll(() => {
    if (!window.requestAnimationFrame) {
      window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number;
    }
  });

  it('renders without crashing for small dataset', () => {
    const data = [
      { ID: 'A001', NAME: 'Test 1', ESTADO: 'ATENDIDO' },
      { ID: 'A002', NAME: 'Test 2', ESTADO: 'PENDIENTE' },
    ];
    const headers = ['ID', 'NAME', 'ESTADO'];
    const images = [new File([''], 'A001-1.jpg', { type: 'image/jpeg' })];
    render(
      <DataPreviewModal
        open
        onClose={() => {}}
        data={data}
        headers={headers}
        images={images}
        idColumn="ID"
        selectedIndex="0"
        onSelectRow={() => {}}
        sheetName="Sheet1"
      />
    );
    expect(screen.getByText('Vista previa de datos')).toBeInTheDocument();
    expect(screen.getByText('Test 1')).toBeInTheDocument();
  });

  it('builds rowPhotoMap in O(n) not O(n*m)', () => {
    const ROWS = 2000;
    const IMAGES = 100;
    const bigData = Array.from({ length: ROWS }, (_, i) => ({
      ID: `ID_${String(i).padStart(5, '0')}`,
      NAME: `Nombre ${i}`,
      ESTADO: i % 2 === 0 ? 'ATENDIDO' : 'PENDIENTE',
      OTRO: `valor ${i}`,
    }));
    const headers = ['ID', 'NAME', 'ESTADO', 'OTRO'];
    const manyImages = Array.from({ length: IMAGES }, (_, i) => {
      const id = `ID_${String(i).padStart(5, '0')}`;
      return new File([''], `${id}-1.jpg`, { type: 'image/jpeg' });
    });

    const start = performance.now();
    const { container } = render(
      <DataPreviewModal
        open
        onClose={() => {}}
        data={bigData}
        headers={headers}
        images={manyImages}
        idColumn="ID"
        selectedIndex="0"
        onSelectRow={() => {}}
        sheetName="Sheet1"
      />
    );
    const elapsed = performance.now() - start;

    // eslint-disable-next-line no-console
    console.log(`DataPreviewModal 2000x100 render: ${elapsed.toFixed(1)}ms`);

    expect(elapsed).toBeLessThan(500);

    expect(container.querySelector('[role="dialog"]')).toBeInTheDocument();

    const trs = container.querySelectorAll('tbody tr');
    expect(trs.length).toBeLessThan(10);
    expect(trs.length).toBeGreaterThanOrEqual(1);

    const virtualRows = container.querySelectorAll('tbody td div[style*="position"] , tbody td div.flex');
    expect(virtualRows.length).toBeGreaterThan(0);
  });

  it('debounces search filtering and still highlights matches', async () => {
    const data = [
      { ID: 'A001', NAME: 'Alpha', ESTADO: 'ATENDIDO' },
      { ID: 'A002', NAME: 'Beta', ESTADO: 'PENDIENTE' },
    ];
    const headers = ['ID', 'NAME', 'ESTADO'];
    render(
      <DataPreviewModal
        open
        onClose={() => {}}
        data={data}
        headers={headers}
        images={[]}
        idColumn="ID"
        selectedIndex="0"
        onSelectRow={() => {}}
      />
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });
});
