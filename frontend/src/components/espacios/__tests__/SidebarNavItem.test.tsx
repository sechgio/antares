import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SidebarNavItem from '../components/SidebarNavItem';

function renderItem(overrides: Partial<Parameters<typeof SidebarNavItem>[0]> = {}) {
  const props = {
    name: 'RESERSERVO',
    color: '#10B981',
    colorIndex: 0,
    isActive: true,
    onSelect: vi.fn(),
    onColorChange: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    renameLabel: 'Renombrar proyecto RESERSERVO',
    deleteLabel: 'Eliminar proyecto RESERSERVO',
    ...overrides,
  };
  return { ...render(<SidebarNavItem {...props} />), props };
}

describe('SidebarNavItem rename', () => {
  it('renames via pencil button and Enter', () => {
    const { props } = renderItem();

    fireEvent.click(screen.getByRole('button', { name: /Renombrar proyecto RESERSERVO/i }));
    const input = screen.getByRole('textbox', { name: /Renombrar proyecto RESERSERVO/i });
    fireEvent.change(input, { target: { value: 'RESERVORIO' } });
    fireEvent.submit(input.closest('form')!);

    expect(props.onRename).toHaveBeenCalledTimes(1);
    expect(props.onRename).toHaveBeenCalledWith('RESERVORIO');
  });

  it('starts rename on double click', () => {
    const { props } = renderItem();
    fireEvent.doubleClick(screen.getByRole('button', { name: 'RESERSERVO' }));
    const input = screen.getByRole('textbox', { name: /Renombrar proyecto RESERSERVO/i });
    fireEvent.change(input, { target: { value: 'RESERVORIO NORTE' } });
    fireEvent.blur(input);
    expect(props.onRename).toHaveBeenCalledWith('RESERVORIO NORTE');
  });

  it('does not rename when name is unchanged or empty', () => {
    const { props } = renderItem();
    fireEvent.click(screen.getByRole('button', { name: /Renombrar proyecto RESERSERVO/i }));
    const input = screen.getByRole('textbox', { name: /Renombrar proyecto RESERSERVO/i });
    fireEvent.blur(input);
    expect(props.onRename).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Renombrar proyecto RESERSERVO/i }));
    const input2 = screen.getByRole('textbox', { name: /Renombrar proyecto RESERSERVO/i });
    fireEvent.change(input2, { target: { value: '   ' } });
    fireEvent.blur(input2);
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it('cancels rename on Escape', () => {
    const { props } = renderItem();
    fireEvent.click(screen.getByRole('button', { name: /Renombrar proyecto RESERSERVO/i }));
    const input = screen.getByRole('textbox', { name: /Renombrar proyecto RESERSERVO/i });
    fireEvent.change(input, { target: { value: 'OTRO' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('RESERSERVO')).toBeInTheDocument();
  });
});
