import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TableView from '../TableView';
import ListView from '../ListView';
import type { Tarea, TeamMember } from '../../../types';

const mockMembers: TeamMember[] = [
  { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
];

function createMockTareas(count: number): Tarea[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `tarea-${i + 1}`,
    espacio_id: 'espacio-1',
    title: `Tarea ${i + 1}`,
    description: `Descripción ${i + 1}`,
    status: 'todo' as const,
    assignee_id: 'user-1',
    due_date: '2026-08-01',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  }));
}

describe('Virtualized TableView & ListView Components', () => {
  describe('TableView', () => {
    it('renders standard table for <= 50 items', () => {
      const tareas = createMockTareas(10);
      render(
        <TableView
          tareas={tareas}
          members={mockMembers}
          onStatusChange={vi.fn()}
          onComplete={vi.fn()}
          onDelete={vi.fn()}
        />
      );

      expect(screen.getByText('Tarea 1')).toBeInTheDocument();
      expect(screen.getByText('Tarea 10')).toBeInTheDocument();
    });

    it('handles selection toggle callbacks correctly', () => {
      const tareas = createMockTareas(5);
      const onToggleSelect = vi.fn();

      render(
        <TableView
          tareas={tareas}
          members={mockMembers}
          selectedIds={new Set(['tarea-1'])}
          onToggleSelect={onToggleSelect}
          onStatusChange={vi.fn()}
          onComplete={vi.fn()}
          onDelete={vi.fn()}
        />
      );

      const checkbox = screen.getByLabelText('Seleccionar Tarea 1');
      expect(checkbox).toBeChecked();
      fireEvent.click(checkbox);
      expect(onToggleSelect).toHaveBeenCalledWith('tarea-1');
    });
  });

  describe('ListView', () => {
    it('renders list items for <= 50 items', () => {
      const tareas = createMockTareas(10);
      render(
        <ListView
          tareas={tareas}
          members={mockMembers}
          onStatusChange={vi.fn()}
          onDelete={vi.fn()}
        />
      );

      expect(screen.getByText('Tarea 1')).toBeInTheDocument();
      expect(screen.getByText('Tarea 10')).toBeInTheDocument();
    });

    it('handles item delete callback', () => {
      const tareas = createMockTareas(3);
      const onDelete = vi.fn();

      render(
        <ListView
          tareas={tareas}
          members={mockMembers}
          onStatusChange={vi.fn()}
          onDelete={onDelete}
        />
      );

      const deleteBtn = screen.getByLabelText('Eliminar Tarea 1');
      fireEvent.click(deleteBtn);
      expect(onDelete).toHaveBeenCalledWith('tarea-1');
    });
  });
});
