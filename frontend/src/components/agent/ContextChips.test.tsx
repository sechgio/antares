import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ContextChips from './ContextChips';

it('muestra la raíz activa y permite cambiarla a otra carpeta adjunta', () => {
  const onSetWorkspace = vi.fn();
  render(
    <ContextChips
      context={{
        modules: [],
        accounts: [],
        files: [{ path: 'C:\\web', folder: true }, { path: 'C:\\otra', folder: true }, { path: 'C:\\nota.txt', folder: false }],
        workspace: 'C:\\web',
      }}
      onRemoveFile={vi.fn()}
      onSetWorkspace={onSetWorkspace}
    />,
  );
  expect(screen.getByLabelText('Espacio de trabajo activo')).toHaveTextContent('web');
  expect(screen.queryByRole('button', { name: 'Usar web como espacio de trabajo' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Usar nota.txt como espacio de trabajo' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Usar otra como espacio de trabajo' }));
  expect(onSetWorkspace).toHaveBeenCalledWith('C:\\otra');
});

it('indica los borradores cuando hay carpetas pero ninguna raíz activa', () => {
  render(
    <ContextChips
      context={{ modules: [], accounts: [], files: [{ path: 'C:\\web', folder: true }], workspace: null }}
      onRemoveFile={vi.fn()}
      onSetWorkspace={vi.fn()}
    />,
  );
  expect(screen.getByLabelText('Espacio de trabajo activo')).toHaveTextContent('Borradores');
});

it('muestra el tipo de cada archivo adjunto y permite retirarlo', () => {
  const onRemoveFile = vi.fn();
  render(
    <ContextChips
      context={{ modules: [], accounts: [], files: [{ path: 'C:/datos/TRABAJOS_MB_OCTUBRE.xlsx', folder: false }, { path: 'C:/informe.pdf', folder: false }], workspace: null }}
      onRemoveFile={onRemoveFile}
      onSetWorkspace={vi.fn()}
    />,
  );
  expect(screen.getByTitle('C:/datos/TRABAJOS_MB_OCTUBRE.xlsx')).toHaveTextContent('TRABAJOS_MB_OCTUBRE.xlsxHoja de cálculo');
  expect(screen.getByTitle('C:/informe.pdf')).toHaveTextContent('informe.pdfPDF');
  fireEvent.click(screen.getByRole('button', { name: 'Retirar acceso a TRABAJOS_MB_OCTUBRE.xlsx' }));
  expect(onRemoveFile).toHaveBeenCalledWith('C:/datos/TRABAJOS_MB_OCTUBRE.xlsx');
});
