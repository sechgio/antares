import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import AgentAvatar, { agentAvatarVariant } from './AgentAvatar';

it('es determinista para la misma semilla', () => {
  expect(agentAvatarVariant('sesion-1')).toEqual(agentAvatarVariant('sesion-1'));
  expect(agentAvatarVariant('')).toEqual(agentAvatarVariant('   '));
});

it('expone el nombre de la conversación como etiqueta accesible', () => {
  render(<AgentAvatar seed="s1" name="Primera" />);
  expect(screen.getByRole('img', { name: 'Primera' })).toBeInTheDocument();
});

it('usa una etiqueta genérica sin nombre', () => {
  render(<AgentAvatar seed="s1" />);
  expect(screen.getByRole('img', { name: 'Agente' })).toBeInTheDocument();
});
