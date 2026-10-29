import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import App from '../App';
import { agentApi, type AgentBrowserState } from '../api/agentApi';
import { findSidebarTab } from './sidebarNav';

vi.mock('../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ user: null, loading: false, signOut: vi.fn() }),
}));
vi.mock('../components/agent', () => ({ default: () => <p>Agent abierto</p> }));
vi.mock('../components/editor/EditorView', () => ({ EditorView: () => <p>Editor abierto</p> }));

it('retira un navegador nativo que quedó acoplado al iniciar fuera de Agent y al cambiar de pestaña', async () => {
  const state: AgentBrowserState = {
    open: true, url: 'https://example.com', title: 'Página abierta', loading: false,
    can_go_back: false, can_go_forward: false, docked: true, user_control: false,
  };
  const browser = vi.spyOn(agentApi, 'agentBrowser').mockImplementation(async (action, extra) => {
    if (action === 'bounds') state.docked = !!extra?.bounds;
    return { ...state };
  });
  try {
    render(<App />);
    await waitFor(() => expect(state.docked).toBe(false));
    expect(state.open).toBe(true);
    browser.mockClear();

    fireEvent.click(await findSidebarTab('Agent'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Agent' }).at(-1)!);
    await screen.findByText('Agent abierto');
    expect(browser).toHaveBeenCalledTimes(1);
    expect(browser).toHaveBeenCalledWith('bounds', { bounds: null });
    state.docked = true;

    fireEvent.click(await findSidebarTab('Editor'));
    await screen.findByText('Editor abierto');
    await waitFor(() => expect(state.docked).toBe(false));
    expect(browser).toHaveBeenLastCalledWith('bounds', { bounds: null });
    expect(state.open).toBe(true);
  } finally {
    browser.mockRestore();
  }
});
