import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../Thumbnail', () => ({
  default: () => <div data-testid="thumb" />,
}));

import FileCard from './FileCard';

function renderCard(overrides: Partial<Parameters<typeof FileCard>[0]> = {}) {
  const props = {
    path: 'C:\\fotos\\IMG_001.jpg',
    selected: false,
    isPrimary: false,
    onClick: vi.fn(),
    onDoubleClick: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
  const utils = render(<FileCard {...props} />);
  return { props, ...utils };
}

describe('FileCard', () => {
  it('muestra nombre de archivo y extensión', () => {
    renderCard();
    expect(screen.getByText('IMG_001.jpg')).toBeInTheDocument();
    expect(screen.getByText('JPG')).toBeInTheDocument();
  });

  it('usa el path completo cuando no hay separadores', () => {
    renderCard({ path: 'foto.png' });
    expect(screen.getByText('foto.png')).toBeInTheDocument();
  });

  it('propaga click y doble click', () => {
    const { props, container } = renderCard();
    const card = container.firstElementChild!;
    fireEvent.click(card);
    fireEvent.doubleClick(card);
    expect(props.onClick).toHaveBeenCalledTimes(1);
    expect(props.onDoubleClick).toHaveBeenCalledTimes(1);
  });

  it('propaga onRemove desde el botón de quitar', () => {
    const { props, container } = renderCard({ isPrimary: true });
    const removeBtn = container.querySelector('button')!;
    fireEvent.click(removeBtn);
    expect(props.onRemove).toHaveBeenCalledTimes(1);
  });

  it('muestra el badge VIDEO solo para videos', () => {
    const { rerender } = render(
      <FileCard path="a.jpg" selected={false} isPrimary={false} onClick={vi.fn()} onDoubleClick={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.queryByText('VIDEO')).toBeNull();
    rerender(
      <FileCard path="a.mp4" selected={false} isPrimary={false} onClick={vi.fn()} onDoubleClick={vi.fn()} onRemove={vi.fn()} isVideo />,
    );
    expect(screen.getByText('VIDEO')).toBeInTheDocument();
    expect(screen.getByText('MP4')).toBeInTheDocument();
  });
});
