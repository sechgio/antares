import { render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
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

it('aplica el color elegido sin cambiar la forma del avatar', () => {
  const { container, rerender } = render(<AgentAvatar seed="s1" name="Revisor" />);
  const shape = container.querySelector('path')?.getAttribute('d');
  const originalStroke = container.querySelector('path')?.getAttribute('stroke');
  rerender(<AgentAvatar seed="s1" name="Revisor" color="#0E7490" />);
  expect(container.querySelector('path')).toHaveAttribute('stroke', '#0E7490');
  expect(container.querySelector('path')).toHaveAttribute('d', shape);
  rerender(<AgentAvatar seed="s1" name="Revisor" color="" />);
  expect(container.querySelector('path')).toHaveAttribute('stroke', originalStroke);
});

it('separa mirada y parpadeo con un desfase estable por semilla', () => {
  const { container, rerender } = render(<AgentAvatar seed="s1" />);
  const delay = container.querySelector('svg')?.style.getPropertyValue('--agent-avatar-delay');
  expect(delay).toMatch(/^-\d+(\.\d)?s$/);
  expect(container.querySelector('.agent-avatar-eyes .agent-avatar-look .agent-avatar-blink')?.querySelectorAll('rect')).toHaveLength(2);
  rerender(<AgentAvatar seed="s1" />);
  expect(container.querySelector('svg')?.style.getPropertyValue('--agent-avatar-delay')).toBe(delay);
});

it('desactiva con reducir movimiento las animaciones de los avatares de la barra', () => {
  const css = fs.readFileSync(path.join(__dirname, 'agent.css'), 'utf-8');
  const bodies = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([^}]*)\}/g)].map((block) => block[1]);
  const sidebar = bodies.find((body) => body.includes('.agent-sidebar .agent-avatar-look'));
  expect(sidebar).toContain('.agent-sidebar .agent-avatar,');
  expect(sidebar).toContain('.agent-sidebar .agent-avatar.agent-avatar-active,');
  expect(sidebar).toContain('.agent-sidebar .group:hover .agent-avatar,');
  expect(sidebar).toContain('.agent-sidebar .agent-avatar-look,');
  expect(sidebar).toContain('.agent-sidebar .agent-avatar-blink { animation: none;');
});
