import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { flowsApi } from '../../api/flowsApi';
import { connectionsApi } from '../../api/connectionsApi';
import NodeConfigDrawer from './NodeConfigDrawer';
import type { FlowNode } from './types';

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(flowsApi, 'flowsOrchestratableMethods').mockResolvedValue({ methods: [] });
  vi.spyOn(connectionsApi, 'connectionsProviders').mockResolvedValue({ providers: [] });
});

function Condition({ changed, value }: { changed: (node: FlowNode) => void; value?: unknown }) {
  const [node, setNode] = useState<FlowNode>({
    id: 'n1', kind: 'condition', name: 'Condición', position: { x: 0, y: 0 }, config: { value },
  });
  return <NodeConfigDrawer node={node} onChange={(next) => { changed(next); setNode(next); }} onDelete={vi.fn()} onClose={vi.fn()} />;
}

it.each([
  ['true', true], ['false', false], ['10', 10], ['0', 0], ['-3.5', -3.5], ['null', null],
  ['[1,2]', [1, 2]], ['{"total":10}', { total: 10 }],
  ['"10"', '10'], ['"true"', 'true'], ['=run.trigger.umbral', '=run.trigger.umbral'],
  ['texto literal', 'texto literal'], ['', undefined],
] as const)('preserva el tipo del valor de comparación %s', async (raw, value) => {
  const changed = vi.fn();
  render(<Condition changed={changed} />);
  const field = screen.getByPlaceholderText('10 o =run.trigger.umbral');
  if (raw === '') fireEvent.change(field, { target: { value: 'previo' } });
  fireEvent.change(field, { target: { value: raw } });
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(changed.mock.lastCall?.[0].config.value).toEqual(value);
});

it('permite completar una cadena numérica entre comillas sin convertirla al teclear', async () => {
  const changed = vi.fn();
  render(<Condition changed={changed} />);
  const field = screen.getByPlaceholderText('10 o =run.trigger.umbral');
  for (const raw of ['"', '"1', '"10', '"10"']) fireEvent.change(field, { target: { value: raw } });
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(changed.mock.lastCall?.[0].config.value).toBe('10');
  expect(field).toHaveValue('"10"');
});

it.each([null, { total: 10 }, [1, 2]])('muestra %j existente como JSON editable', async (value) => {
  const changed = vi.fn();
  render(<Condition changed={changed} value={value} />);
  await waitFor(() => expect(flowsApi.flowsOrchestratableMethods).toHaveBeenCalled());
  expect(screen.getByPlaceholderText('10 o =run.trigger.umbral')).toHaveValue(JSON.stringify(value));
});
