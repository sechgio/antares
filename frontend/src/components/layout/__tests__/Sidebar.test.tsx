import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import Sidebar from '../Sidebar';
import { TAB_DEFINITIONS } from '../../../navigation';
import { ToastProvider } from '../../../hooks/useToast';

const STORAGE_KEY = 'antares_sidebar_expanded';
const mockSignOut = vi.fn(async () => {});

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'user@test.com', displayName: 'Test User', isAdmin: false, isDisabled: false, createdAt: '' },
    signOut: mockSignOut,
  }),
}));

function renderSidebar(props: { activeTab: 'convert'; onTabChange: ReturnType<typeof vi.fn> }) {
  return render(
    <ToastProvider>
      <Sidebar {...props} />
    </ToastProvider>,
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    mockSignOut.mockClear();
  });

  it('does not show the removed brand tagline', () => {
    const removedTagline = ['Precision', 'tools'].join(' ');

    renderSidebar({ activeTab: 'convert', onTabChange: vi.fn() });

    expect(screen.queryByText(removedTagline)).not.toBeInTheDocument();
  });

  it('does not render the removed sidebar search shortcut', () => {
    renderSidebar({ activeTab: 'convert', onTabChange: vi.fn() });

    expect(screen.queryByText('Buscar')).not.toBeInTheDocument();
    expect(screen.queryByText('Ctrl+K')).not.toBeInTheDocument();
  });

  it('renders the sidebar toggle with the expected label', () => {
    renderSidebar({ activeTab: 'convert', onTabChange: vi.fn() });

    expect(screen.getByRole('button', { name: 'Alternar barra lateral' })).toBeInTheDocument();
  });

  it('shows a Hide Sidebar tooltip when expanded', () => {
    renderSidebar({ activeTab: 'convert', onTabChange: vi.fn() });

    const toggle = screen.getByTestId('sidebar-toggle');
    expect(toggle).not.toHaveAttribute('title');
    expect(screen.getByText('Hide Sidebar')).toBeInTheDocument();
    expect(screen.queryByText('Ctrl')).not.toBeInTheDocument();
  });

  it('shows Show Sidebar after collapsing', () => {
    renderSidebar({ activeTab: 'convert', onTabChange: vi.fn() });

    fireEvent.click(screen.getByTestId('sidebar-toggle'));

    expect(screen.getByText('Show Sidebar')).toBeInTheDocument();
    expect(screen.queryByText('Hide Sidebar')).not.toBeInTheDocument();
  });

  it('collapses and expands when toggled', () => {
    renderSidebar({ activeTab: 'convert', onTabChange: vi.fn() });

    const sidebar = screen.getByTestId('app-sidebar');
    const toggle = screen.getByTestId('sidebar-toggle');

    expect(sidebar).toHaveAttribute('data-expanded', 'true');

    fireEvent.click(toggle);
    expect(sidebar).toHaveAttribute('data-expanded', 'false');

    fireEvent.click(toggle);
    expect(sidebar).toHaveAttribute('data-expanded', 'true');
  });

  it('toggles the sidebar with Ctrl+B', () => {
    renderSidebar({ activeTab: 'convert', onTabChange: vi.fn() });

    const sidebar = screen.getByTestId('app-sidebar');
    expect(sidebar).toHaveAttribute('data-expanded', 'true');

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(sidebar).toHaveAttribute('data-expanded', 'false');

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(sidebar).toHaveAttribute('data-expanded', 'true');
  });

  it('shows tool name tooltips when collapsed, without shortcut keycaps', () => {
    renderSidebar({ activeTab: 'convert', onTabChange: vi.fn() });

    fireEvent.click(screen.getByTestId('sidebar-toggle'));

    const espacios = screen.getByRole('button', { name: 'Espacios' });
    expect(espacios).not.toHaveAttribute('title');

    const tooltips = screen.getAllByRole('tooltip');
    const espaciosTip = tooltips.find((node) => node.textContent === 'Espacios');
    const informesTip = tooltips.find((node) => node.textContent === 'Informes técnicos');

    expect(espaciosTip).toBeTruthy();
    expect(informesTip).toBeTruthy();
    expect(espaciosTip?.textContent).not.toContain('Ctrl');
    expect(informesTip?.textContent).not.toContain('Ctrl');
  });

  it('does not render tool name tooltips when expanded', () => {
    renderSidebar({ activeTab: 'convert', onTabChange: vi.fn() });

    const tooltips = screen.getAllByRole('tooltip');
    expect(tooltips).toHaveLength(1);
    expect(tooltips[0]).toHaveTextContent('Hide Sidebar');
  });

  it('keeps collapsed labels centered on the icon row', () => {
    renderSidebar({ activeTab: 'convert', onTabChange: vi.fn() });

    fireEvent.click(screen.getByTestId('sidebar-toggle'));

    const convertButton = screen.getByRole('button', { name: 'Conversión' });
    expect(convertButton.parentElement).toHaveClass('flex', 'size-8', 'items-center');

    const convertTooltip = screen
      .getAllByRole('tooltip')
      .find((node) => node.textContent === 'Conversión');
    expect(convertTooltip).toHaveClass('left-full', 'top-1/2', '-translate-y-1/2');
  });

  it('keeps navigation rows on a uniform rhythm', () => {
    renderSidebar({ activeTab: 'convert', onTabChange: vi.fn() });

    const nav = screen.getByRole('navigation');
    const expandedButton = screen.getByRole('button', { name: 'Conversión' });

    expect(nav).toHaveClass('gap-0.5');
    expect(expandedButton).toHaveClass('h-8');
    fireEvent.click(screen.getByTestId('sidebar-toggle'));

    expect(nav).toHaveClass('gap-0.5');
    expect(screen.getByRole('button', { name: 'Conversión' })).toHaveClass('size-8');
  });

  it('hides all navigation group headings', () => {
    renderSidebar({ activeTab: 'convert', onTabChange: vi.fn() });

    expect(screen.queryByText('General')).not.toBeInTheDocument();
    expect(screen.queryByText('Reportes')).not.toBeInTheDocument();
    expect(screen.queryByText('Herramientas')).not.toBeInTheDocument();
    expect(screen.queryByText('Producción')).not.toBeInTheDocument();
  });

  it('keeps navigation content mounted while toggling', () => {
    renderSidebar({ activeTab: 'convert', onTabChange: vi.fn() });

    const sidebar = screen.getByTestId('app-sidebar');
    const conversionButton = screen.getByRole('button', { name: 'Conversión' });
    const conversionLabel = within(conversionButton).getByText('Conversión');

    expect(sidebar).toHaveClass('min-w-0');
    fireEvent.click(screen.getByTestId('sidebar-toggle'));

    expect(within(conversionButton).getByText('Conversión')).toBe(conversionLabel);
    expect(conversionLabel).toHaveClass('max-w-0', 'opacity-0');
    expect(screen.getByRole('button', { name: 'Conversión' })).toHaveClass('gap-0', 'justify-start', 'pl-2');
    expect(screen.getByAltText('Antares')).toBeInTheDocument();
  });

  it('persists the collapsed state in localStorage', () => {
    renderSidebar({ activeTab: 'convert', onTabChange: vi.fn() });

    fireEvent.click(screen.getByTestId('sidebar-toggle'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
  });

  it('keeps all current navigation sections', () => {
    renderSidebar({ activeTab: 'convert', onTabChange: vi.fn() });

    for (const tab of TAB_DEFINITIONS) {
      expect(screen.getByRole('button', { name: tab.label })).toBeInTheDocument();
    }
  });

  it('calls onTabChange when a navigation item is clicked', () => {
    const onTabChange = vi.fn();

    renderSidebar({ activeTab: 'convert', onTabChange });

    fireEvent.click(screen.getByRole('button', { name: 'Conversión' }));
    expect(onTabChange).toHaveBeenCalledWith('convert');
  });

  it('does not render history or appearance as sidebar navigation items', () => {
    renderSidebar({ activeTab: 'convert', onTabChange: vi.fn() });

    expect(screen.queryByRole('button', { name: 'Historial' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apariencia' })).not.toBeInTheDocument();
  });

  it('shows a sign-out tooltip when collapsed', () => {
    renderSidebar({ activeTab: 'convert', onTabChange: vi.fn() });

    fireEvent.click(screen.getByTestId('sidebar-toggle'));

    const signOut = screen.getByTestId('sidebar-signout-button');
    expect(signOut).not.toHaveAttribute('title');
    expect(screen.getAllByRole('tooltip').some((node) => node.textContent === 'auth.signOut')).toBe(true);
  });

  it('calls signOut from the bottom logout button', async () => {
    renderSidebar({ activeTab: 'convert', onTabChange: vi.fn() });

    fireEvent.click(screen.getByTestId('sidebar-signout-button'));

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});
