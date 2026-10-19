import type { AiProviderSpec, AiProviderStatus } from '../../api/aiProvidersApi';

export const TONE_COLOR = {
  ok: 'var(--accent-green)',
  warn: 'var(--accent-yellow)',
  off: 'var(--text-secondary)',
} as const;

export function StatusBadge({ tone, children }: { tone: keyof typeof TONE_COLOR; children: string }) {
  const color = TONE_COLOR[tone];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
      style={{
        color,
        borderColor: tone === 'off' ? 'var(--border-subtle)' : `color-mix(in srgb, ${color} 40%, transparent)`,
        background: tone === 'off' ? 'transparent' : `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

export function providerStatusText(p: AiProviderSpec, status?: AiProviderStatus): string {
  if (status?.reachable) {
    return status.models_count != null ? `Disponible · ${status.models_count} modelos` : 'Disponible';
  }
  if (p.has_key || (p.configured && !p.needs_key)) return 'Configurado';
  return p.needs_key ? 'Necesita clave de acceso' : 'No configurado';
}

export function providerStatusTone(p: AiProviderSpec, status?: AiProviderStatus): 'ok' | 'warn' | 'off' {
  if (status?.reachable) return 'ok';
  if (p.has_key || (p.configured && !p.needs_key)) return 'warn';
  return 'off';
}
