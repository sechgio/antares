import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import App from '../App';
import { findSidebarTab } from './sidebarNav';
import { TAB_DEFINITIONS } from '../navigation';

vi.mock('../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ user: null, loading: false, signOut: vi.fn() }),
}));
vi.mock('../components/editor/EditorView', () => ({
  EditorView: () => <p>Editor abierto</p>,
}));

it('expone el tab Editor en Herramientas y abre la vista sin cuenta', async () => {
  const editorTab = TAB_DEFINITIONS.find((tab) => tab.id === 'editor');
  expect(editorTab).toBeDefined();
  expect(editorTab?.label).toBe('Editor');
  expect(editorTab?.fullBleed).toBe(true);

  render(<App />);
  fireEvent.click(await findSidebarTab('Editor'));
  expect(await screen.findByText('Editor abierto')).toBeInTheDocument();
});

it('carga la vista del editor de forma diferida', async () => {
  render(<App />);
  await waitFor(() => expect(screen.queryByText('Editor abierto')).not.toBeInTheDocument());
  fireEvent.click(await findSidebarTab('Editor'));
  await screen.findByText('Editor abierto');
});

it('conserva las demás herramientas al abrir el editor', async () => {
  render(<App />);
  fireEvent.click(await findSidebarTab('Canvas'));
  await waitFor(
    () => expect(document.querySelector('.canvas-app')).toBeTruthy(),
    { timeout: 15000 },
  );
  fireEvent.click(await findSidebarTab('Editor'));
  await screen.findByText('Editor abierto');
});
