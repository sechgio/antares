import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import Sidebar from '../Sidebar';
import { TAB_DEFINITIONS, type TabId } from '../../../navigation';
import { ToastProvider } from '../../../hooks/useToast';

const STORAGE_KEY = 'antares_sidebar_expanded';
const mockSignOut = vi.fn(async () => {});
const TEST_USER = { id: 'u1', email: 'user@test.com', displayName: 'Test User', isAdmin: false, isDisabled: false, createdAt: '' };
let mockUser: typeof TEST_USER | null = TEST_USER;

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    signOut: mockSignOut,
  }),
}));

vi.mock('../TaskNotificationsBell', () => ({
  default: ({ onOpenEspacios }: { onOpenEspacios?: () => void }) => (
    <button type="button" data-testid="titlebar-notifications-button" onClick={onOpenEspacios}>Notificaciones</button>
  ),
}));

const GROUP_IDS = ['general', 'produccion', 'reportes', 'herramientas', 'agent'];

function renderSidebar(props: { activeTab?: TabId; onTabChange?: (tab: TabId) => void; onOpenSettings?: () => void } = {}) {
  return render(
    <ToastProvider>
      <Sidebar activeTab={props.activeTab ?? 'convert'} onTabChange={props.onTabChange ?? vi.fn()} onOpenSettings={props.onOpenSettings} />
    </ToastProvider>,
  );
}

function panel() {
  return screen.getByRole('navigation', { name: (name) => name !== 'Grupos' });
}

describe('Sidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    mockSignOut.mockClear();
    mockUser = TEST_USER;
  });

  it('shows the notifications bell in the rail and opens Espacios from it', async () => {
    const onTabChange = vi.fn();
    renderSidebar({ onTabChange });

    const aside = screen.getByTestId('app-sidebar');
    fireEvent.click(await within(aside).findByTestId('titlebar-notifications-button'));

    expect(onTabChange).toHaveBeenCalledWith('espacios');
  });

  it('keeps the account avatar and menu without a session, offering sign-in', () => {
    mockUser = null;
    const onTabChange = vi.fn();
    renderSidebar({ onTabChange });

    fireEvent.click(screen.getByTestId('sidebar-account-button'));
    const menu = screen.getByRole('menu', { name: 'Cuenta' });

    expect(within(menu).getByText('Sin sesión')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-signout-button')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Iniciar sesión' }));
    expect(onTabChange).toHaveBeenCalledWith('espacios');
  });

  it('does not show the removed brand tagline', () => {
    const removedTagline = ['Precision', 'tools'].join(' ');

    renderSidebar();

    expect(screen.queryByText(removedTagline)).not.toBeInTheDocument();
  });

  it('does not render the removed sidebar search shortcut', () => {
    renderSidebar();

    expect(screen.queryByText('Buscar')).not.toBeInTheDocument();
    expect(screen.queryByText('Ctrl+K')).not.toBeInTheDocument();
  });

  it('renders the panel toggle with the expected label and tooltip', () => {
    renderSidebar();

    const toggle = screen.getByRole('button', { name: 'Alternar barra lateral' });
    expect(toggle).not.toHaveAttribute('title');
    fireEvent.focus(toggle);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Ocultar panel');
  });

  it('shows the group of the active tab in the panel', () => {
    renderSidebar({ activeTab: 'sellador' });

    expect(screen.getByRole('heading', { name: 'Producción' })).toBeInTheDocument();
    const items = within(panel()).getAllByRole('button').map((node) => node.textContent);
    expect(items).toEqual(['Conversión', 'Formatos PDF', 'Sellador', 'Generar Padrones', 'Generar Volantes']);
    expect(within(panel()).getByRole('button', { name: 'Sellador' })).toHaveAttribute('aria-current', 'page');
  });

  it('switches the panel group from the rail without navigating', () => {
    const onTabChange = vi.fn();
    renderSidebar({ onTabChange });

    fireEvent.click(screen.getByTestId('sidebar-group-herramientas'));

    expect(screen.getByRole('heading', { name: 'Herramientas' })).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: 'Flujos' })).toBeInTheDocument();
    expect(onTabChange).not.toHaveBeenCalled();
  });

  it('reaches every navigation section through its rail group', () => {
    renderSidebar();

    const seen = new Set<string>();
    for (const id of GROUP_IDS) {
      fireEvent.click(screen.getByTestId(`sidebar-group-${id}`));
      for (const node of within(panel()).getAllByRole('button')) seen.add(node.textContent ?? '');
    }

    expect([...seen].sort()).toEqual(TAB_DEFINITIONS.map((tab) => tab.label).sort());
  });

  it('shows group name tooltips on the rail', () => {
    renderSidebar();

    const reportes = screen.getByRole('button', { name: 'Reportes' });
    expect(reportes).not.toHaveAttribute('title');
    fireEvent.focus(reportes);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Reportes');
  });

  it('collapses the panel with the toggle and reopens it from the rail', () => {
    renderSidebar();

    const sidebar = screen.getByTestId('app-sidebar');
    expect(sidebar).toHaveAttribute('data-expanded', 'true');

    fireEvent.click(screen.getByTestId('sidebar-toggle'));
    expect(sidebar).toHaveAttribute('data-expanded', 'false');

    fireEvent.click(screen.getByTestId('sidebar-group-reportes'));
    expect(sidebar).toHaveAttribute('data-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'Reportes' })).toBeInTheDocument();
  });

  it('collapses the panel when clicking the group already shown', () => {
    renderSidebar();

    fireEvent.click(screen.getByTestId('sidebar-group-produccion'));

    expect(screen.getByTestId('app-sidebar')).toHaveAttribute('data-expanded', 'false');
  });

  it('peeks the hovered group as a floating panel when the panel is not pinned', () => {
    vi.useFakeTimers();
    try {
      renderSidebar();
      fireEvent.click(screen.getByTestId('sidebar-toggle'));

      fireEvent.mouseEnter(screen.getByTestId('sidebar-group-herramientas'));
      const peek = screen.getByTestId('sidebar-peek');
      expect(peek).toHaveAttribute('aria-hidden', 'false');
      expect(within(peek).getByRole('heading', { name: 'Herramientas' })).toBeInTheDocument();
      expect(screen.getByTestId('app-sidebar')).toHaveAttribute('data-expanded', 'false');

      fireEvent.mouseLeave(screen.getByTestId('app-sidebar'));
      fireEvent.mouseEnter(peek);
      act(() => { vi.advanceTimersByTime(500); });
      expect(peek).toHaveAttribute('aria-hidden', 'false');

      fireEvent.mouseLeave(peek);
      act(() => { vi.advanceTimersByTime(500); });
      expect(peek).toHaveAttribute('aria-hidden', 'true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('pins the peeked panel from its header button', () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId('sidebar-toggle'));

    fireEvent.mouseEnter(screen.getByTestId('sidebar-group-reportes'));
    fireEvent.click(within(screen.getByTestId('sidebar-peek')).getByRole('button', { name: 'Fijar panel' }));

    expect(screen.getByTestId('app-sidebar')).toHaveAttribute('data-expanded', 'true');
    expect(screen.queryByTestId('sidebar-peek')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reportes' })).toBeInTheDocument();
  });

  it('closes the peek after choosing a section', () => {
    const onTabChange = vi.fn();
    renderSidebar({ onTabChange });
    fireEvent.click(screen.getByTestId('sidebar-toggle'));

    fireEvent.mouseEnter(screen.getByTestId('sidebar-group-herramientas'));
    fireEvent.click(within(screen.getByTestId('sidebar-peek')).getByRole('button', { name: 'Flujos' }));

    expect(onTabChange).toHaveBeenCalledWith('flows');
    expect(screen.getByTestId('sidebar-peek')).toHaveAttribute('aria-hidden', 'true');
  });

  it('toggles the panel with Ctrl+B', () => {
    renderSidebar();

    const sidebar = screen.getByTestId('app-sidebar');
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(sidebar).toHaveAttribute('data-expanded', 'false');

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(sidebar).toHaveAttribute('data-expanded', 'true');
  });

  it('persists the collapsed state in localStorage', () => {
    renderSidebar();

    fireEvent.click(screen.getByTestId('sidebar-toggle'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
  });

  it('calls onTabChange when a navigation item is clicked', () => {
    const onTabChange = vi.fn();
    renderSidebar({ onTabChange });

    fireEvent.click(screen.getByRole('button', { name: 'Conversión' }));
    expect(onTabChange).toHaveBeenCalledWith('convert');
  });

  it('does not render history or appearance as sidebar navigation items', () => {
    renderSidebar();

    expect(screen.queryByRole('button', { name: 'Historial' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apariencia' })).not.toBeInTheDocument();
  });

  it('opens the account menu with the user identity', () => {
    renderSidebar();

    expect(screen.queryByTestId('sidebar-account-menu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sidebar-account-button'));

    const menu = screen.getByRole('menu', { name: 'Cuenta' });
    expect(within(menu).getByText('Test User')).toBeInTheDocument();
    expect(within(menu).getByText('user@test.com')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-account-button')).toHaveTextContent('TU');
  });

  it('opens settings from the account menu and closes it', () => {
    const onOpenSettings = vi.fn();
    renderSidebar({ onOpenSettings });

    fireEvent.click(screen.getByTestId('sidebar-account-button'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Configuración' }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('sidebar-account-menu')).not.toBeInTheDocument();
  });

  it('lists only the account menu entries the app supports', () => {
    renderSidebar({ onOpenSettings: vi.fn() });

    fireEvent.click(screen.getByTestId('sidebar-account-button'));
    const items = screen.getAllByRole('menuitem').map((node) => node.textContent);

    expect(items).toEqual(['Cuenta', 'Configuración', 'Cerrar sesión']);
    expect(screen.getByRole('menuitem', { name: 'Cuenta' })).toBeDisabled();
  });

  it('calls signOut from the account menu', () => {
    renderSidebar();

    fireEvent.click(screen.getByTestId('sidebar-account-button'));
    fireEvent.click(screen.getByTestId('sidebar-signout-button'));

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});
