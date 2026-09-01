import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TopBar from './TopBar';

describe('TopBar PDF import', () => {
  it('shows and triggers the PDF import action', () => {
    const onImportPdf = vi.fn();
    render(
      <TopBar
        name="Documento"
        mode="design"
        canUndo={false}
        canRedo={false}
        status={null}
        onNameChange={vi.fn()}
        onMode={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onSave={vi.fn()}
        onDuplicate={vi.fn()}
        onImportPdf={onImportPdf}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Importar PDF' }));
    expect(onImportPdf).toHaveBeenCalledOnce();
  });
});
