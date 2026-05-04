import { Minus, Square, X } from 'lucide-react';

const menuItems = ['Archivo', 'Editar', 'Ver', 'Ventana', 'Ayuda'];

function handleWindowAction(action: 'minimizeWindow' | 'maximizeWindow' | 'closeWindow') {
  window.electronAPI?.[action]?.();
}

function handleMenuClick(index: number, element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  window.electronAPI?.showAppMenu?.(index, { x: rect.left, y: rect.bottom });
}

export default function TitleBar() {
  return (
    <div
      data-testid="app-titlebar"
      className="app-titlebar flex h-9 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] select-none"
    >
      <nav className="flex h-full items-center px-1" aria-label="Menu principal">
        {menuItems.map((item, index) => (
          <button
            key={item}
            type="button"
            onClick={(event) => handleMenuClick(index, event.currentTarget)}
            className="app-titlebar-button h-full px-3 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            {item}
          </button>
        ))}
      </nav>

      <div className="app-titlebar-controls flex h-full items-stretch">
        <button
          type="button"
          aria-label="Minimizar"
          title="Minimizar"
          onClick={() => handleWindowAction('minimizeWindow')}
          className="app-titlebar-button flex w-12 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          <Minus size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="Maximizar"
          title="Maximizar"
          onClick={() => handleWindowAction('maximizeWindow')}
          className="app-titlebar-button flex w-12 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          <Square size={11} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="Cerrar"
          title="Cerrar"
          onClick={() => handleWindowAction('closeWindow')}
          className="app-titlebar-button flex w-12 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-red)] hover:text-white"
        >
          <X size={15} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
