import { fireEvent, screen } from '@testing-library/react';

const SIDEBAR_GROUPS = ['General', 'Producción', 'Reportes', 'Herramientas', 'Agent'];

export async function findSidebarTab(name: string | RegExp) {
  await screen.findByRole('button', { name: SIDEBAR_GROUPS[0] }, { timeout: 5000 });
  for (const group of SIDEBAR_GROUPS) {
    const tab = screen.queryByRole('button', { name });
    if (tab) return tab;
    fireEvent.click(screen.getByRole('button', { name: group }));
  }
  return screen.getByRole('button', { name });
}
