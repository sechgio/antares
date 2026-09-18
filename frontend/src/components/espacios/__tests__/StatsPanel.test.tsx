import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import StatsPanel from '../components/StatsPanel';
import type { TaskStats } from '../utils/filters';

const stats: TaskStats = {
  total: 10,
  open: 6,
  completed: 4,
  overdue: 2,
  unscheduled: 1,
  scheduled: 9,
  progress: 40,
};

describe('StatsPanel', () => {
  it('renderiza progreso y todos los contadores', () => {
    render(<StatsPanel stats={stats} filteredCount={10} totalCount={10} />);
    const group = screen.getByRole('group', { name: 'Resumen del proyecto' });
    expect(group).toHaveTextContent('Progreso');
    expect(group).toHaveTextContent('40%');
    expect(group).toHaveTextContent('Total');
    expect(group).toHaveTextContent('Abiertas');
    expect(group).toHaveTextContent('Completadas');
    expect(group).toHaveTextContent('Atrasadas');
    expect(group).toHaveTextContent('Sin fecha');
  });

  it('muestra el indicador de filtro solo cuando filteredCount != totalCount', () => {
    const { rerender } = render(<StatsPanel stats={stats} filteredCount={10} totalCount={10} />);
    expect(screen.queryByText(/Mostrando/)).toBeNull();

    rerender(<StatsPanel stats={stats} filteredCount={3} totalCount={10} />);
    expect(screen.getByText('Mostrando 3 de 10')).toBeInTheDocument();
  });
});
