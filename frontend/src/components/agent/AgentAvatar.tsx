import { useId } from 'react';

/**
 * Avatar determinista por semilla (id de conversación) con motivo de papel
 * doblado, al estilo del espacio de agentes de BoardUI. Misma semilla → mismo
 * color y misma orientación; no hay estado ni recursos externos.
 */

export interface AgentAvatarPalette {
  from: string;
  to: string;
}

const PALETTES: AgentAvatarPalette[] = [
  { from: '#5E6AD2', to: '#8B93FF' }, // índigo
  { from: '#0E7490', to: '#22C7A9' }, // teal
  { from: '#B45309', to: '#F59E0B' }, // ámbar
  { from: '#BE123C', to: '#FB7185' }, // rosa
  { from: '#6D28D9', to: '#A78BFA' }, // violeta
  { from: '#0369A1', to: '#38BDF8' }, // celeste
];

function hashSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function agentAvatarVariant(seed: string): { palette: AgentAvatarPalette; mirrored: boolean } {
  const hash = hashSeed(seed.trim() || 'antares-agent');
  return {
    palette: PALETTES[hash % PALETTES.length],
    mirrored: ((hash >>> 3) & 1) === 1,
  };
}

// Página con la esquina superior derecha doblada hacia dentro.
const SHAPE_PATH = 'M10 2H32L46 16V38A8 8 0 0 1 38 46H10A8 8 0 0 1 2 38V10A8 8 0 0 1 10 2Z';
const FOLD_PATH = 'M32 2L46 16L32 16Z';

export default function AgentAvatar({
  seed,
  name,
  size = 40,
  className,
}: {
  seed: string;
  name?: string;
  size?: number;
  className?: string;
}) {
  const { palette, mirrored } = agentAvatarVariant(seed);
  const gradientId = `agent-avatar-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  return (
    <svg
      role="img"
      aria-label={name?.trim() || 'Agente'}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      style={{ maxWidth: '100%', objectFit: 'contain' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={palette.to} />
          <stop offset="100%" stopColor={palette.from} />
        </linearGradient>
      </defs>
      <g transform={mirrored ? 'translate(48 0) scale(-1 1)' : undefined}>
        <path d={SHAPE_PATH} fill={`url(#${gradientId})`} />
        <path d={FOLD_PATH} fill="rgba(255,255,255,0.34)" />
      </g>
    </svg>
  );
}
