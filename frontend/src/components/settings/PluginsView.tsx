import { Disc3, Headphones, Library, Music, Radio, StickyNote, type LucideIcon } from 'lucide-react';
import Toggle from '../ui/Toggle';
import { setPluginEnabled, usePluginEnabled, type PluginId } from '../../plugins';

interface NativePluginDef {
  id: PluginId;
  name: string;
  description: string;
  icon: LucideIcon;
}

const NATIVE_PLUGINS: NativePluginDef[] = [
  {
    id: 'sticky-notes',
    name: 'Sticky Notes',
    description: 'Notas adhesivas flotantes dentro de la ventana de Antares.',
    icon: StickyNote,
  },
  {
    id: 'radio-live',
    name: 'Radio Live',
    description: 'Radio en vivo en la barra de título.',
    icon: Radio,
  },
  {
    id: 'spotify',
    name: 'Spotify',
    description: 'Widget de Spotify en la barra de título.',
    icon: Music,
  },
  {
    id: 'audius',
    name: 'Audius',
    description: 'Música de Audius en la barra de título. Gratis y sin suscripción.',
    icon: Headphones,
  },
  {
    id: 'jamendo',
    name: 'Jamendo',
    description: 'Música Creative Commons de Jamendo en la barra de título.',
    icon: Disc3,
  },
  {
    id: 'archive',
    name: 'Archive',
    description: 'Conciertos y netlabels de Internet Archive en la barra de título.',
    icon: Library,
  },
];

function PluginRow({ plugin }: { plugin: NativePluginDef }) {
  const enabled = usePluginEnabled(plugin.id);
  const Icon = plugin.icon;
  return (
    <div
      className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3 last:border-b-0"
      data-testid={`plugin-row-${plugin.id}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--accent-primary)]">
        <Icon size={17} strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[var(--text-primary)]">{plugin.name}</div>
        <div className="truncate text-xs text-[var(--text-muted)]">{plugin.description}</div>
      </div>
      <Toggle
        checked={enabled}
        onChange={(next) => setPluginEnabled(plugin.id, next)}
        aria-label={`${enabled ? 'Desactivar' : 'Activar'} ${plugin.name}`}
      />
    </div>
  );
}

export default function PluginsView() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <p className="text-xs text-[var(--text-muted)]">
        Activa o desactiva plugins de Antares. Los cambios se aplican al instante.
      </p>
      <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        {NATIVE_PLUGINS.map((plugin) => (
          <PluginRow key={plugin.id} plugin={plugin} />
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
        Sticky Notes: <kbd className="rounded bg-[var(--bg-elevated)] px-1 py-0.5 font-mono">Ctrl+Shift+N</kbd> nueva nota,{' '}
        <kbd className="rounded bg-[var(--bg-elevated)] px-1 py-0.5 font-mono">Ctrl+Alt+S</kbd> recoger todas.
      </p>
    </div>
  );
}
