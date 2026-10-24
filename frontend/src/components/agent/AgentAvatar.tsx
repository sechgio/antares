import { useId } from 'react';
import './agent.css';

interface AgentAvatarPalette {
  from: string;
  to: string;
  name: string;
}

export const AGENT_AVATAR_COLORS: AgentAvatarPalette[] = [
  { from: '#5E6AD2', to: '#8B93FF', name: 'Índigo' },
  { from: '#0E7490', to: '#22C7A9', name: 'Verde' },
  { from: '#B45309', to: '#F59E0B', name: 'Ámbar' },
  { from: '#BE123C', to: '#FB7185', name: 'Rosa' },
  { from: '#6D28D9', to: '#A78BFA', name: 'Violeta' },
  { from: '#0369A1', to: '#38BDF8', name: 'Azul' },
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
    palette: AGENT_AVATAR_COLORS[hash % AGENT_AVATAR_COLORS.length],
    mirrored: ((hash >>> 3) & 1) === 1,
  };
}

const SHAPES = [
  'M12 5Q24 1 36 5Q44 7 44 17V32Q44 43 33 44H15Q4 44 4 33V17Q4 7 12 5Z',
  'M24 3Q33 9 43 10V25Q43 37 24 46Q5 37 5 25V10Q15 9 24 3Z',
  'M24 3C35 3 45 15 45 27C45 39 36 45 24 45C12 45 3 39 3 27C3 15 13 3 24 3Z',
  'M19 7Q24-2 29 7L32 14L40 15Q50 17 42 25L36 30L37 39Q38 49 28 43L24 40L17 44Q7 49 10 38L11 30L5 24Q-2 17 9 15L16 14Z',
];

export default function AgentAvatar({
  seed,
  name,
  size = 40,
  className,
  working = false,
  color,
}: {
  seed: string;
  name?: string;
  size?: number;
  className?: string;
  working?: boolean;
  color?: string;
}) {
  const variant = agentAvatarVariant(seed);
  const { mirrored } = variant;
  const palette = color ? AGENT_AVATAR_COLORS.find((item) => item.from === color) ?? { from: color, to: color } : variant.palette;
  const gradientId = `agent-avatar-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  return (
    <svg
      role="img"
      aria-label={name?.trim() || 'Agente'}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={`agent-avatar ${className ?? ''}`}
      data-working={working}
      style={{ maxWidth: '100%', objectFit: 'contain' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={`color-mix(in srgb, ${palette.to} 38%, white)`} />
          <stop offset="100%" stopColor={`color-mix(in srgb, ${palette.to} 72%, white)`} />
        </linearGradient>
      </defs>
      <g transform={mirrored ? 'translate(48 0) scale(-1 1)' : undefined}>
        <path d={SHAPES[hashSeed(seed.trim() || 'antares-agent') % SHAPES.length]} fill={`url(#${gradientId})`} stroke={palette.from} strokeOpacity="0.2" />
        <g className="agent-avatar-eyes" fill="#17252b" transform="rotate(-7 24 25)">
          <rect x="16" y="18" width="5" height="13" rx="2.5" />
          <rect x="27" y="18" width="5" height="13" rx="2.5" />
        </g>
      </g>
    </svg>
  );
}
