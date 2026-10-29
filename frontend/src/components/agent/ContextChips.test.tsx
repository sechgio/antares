import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ContextChips from './ContextChips';
import { FilePreviewContext } from './filePreviewContext';

it('previsualiza el archivo autorizado sin retirar su permiso', () => {
  const open = vi.fn();
  const remove = vi.fn();
  render(<FilePreviewContext.Provider value={open}><ContextChips
    context={{ modules: [], accounts: [], files: [{ path: 'C:\\datos.xlsx', folder: false }] }}
    onRemoveFile={remove} onSetWorkspace={vi.fn()} /></FilePreviewContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: 'Previsualizar datos.xlsx' }));
  expect(open).toHaveBeenCalledWith('C:\\datos.xlsx');
  expect(remove).not.toHaveBeenCalled();
});

it('no duplica la raíz activa y permite cambiarla a otra carpeta adjunta', () => {
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
  expect(screen.queryByLabelText('Espacio de trabajo activo')).toBeNull();
  expect(screen.queryByTitle('C:\\web')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Usar web como espacio de trabajo' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Usar nota.txt como espacio de trabajo' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Usar otra como espacio de trabajo' }));
  expect(onSetWorkspace).toHaveBeenCalledWith('C:\\otra');
});

it('no muestra la fila cuando solo está la carpeta de trabajo', () => {
  const { container } = render(
    <ContextChips
      context={{ modules: [], accounts: [], files: [{ path: 'C:\\web', folder: true }], workspace: 'C:\\web' }}
      onRemoveFile={vi.fn()}
      onSetWorkspace={vi.fn()}
    />,
  );
  expect(container).toBeEmptyDOMElement();
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
