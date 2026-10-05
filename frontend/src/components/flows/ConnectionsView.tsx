import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Code2,
  FileText,
  KanbanSquare,
  LayoutGrid,
  MessagesSquare,
  Palette,
  Plug,
  Search,
  Tag,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { onNotify } from '../../api';
import {
  connectionsApi,
  type ConnectionCategory,
  type ConnectionProviderSpec,
} from '../../api/connectionsApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import { useDialog } from '../../hooks/useDialog';
import ConnectionDetail from './ConnectionDetail';
import McpServersView from './McpServersView';
import { ProviderIcon } from './connectionIcons';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  desarrollo: Code2,
  comunicacion: MessagesSquare,
  documentos: FileText,
  planificacion: KanbanSquare,
  diseno: Palette,
  productividad: Wrench,
};

type Filter = 'all' | 'connected' | `cat:${string}`;

function Row({
  p,
  onOpen,
}: {
  p: ConnectionProviderSpec;
  onOpen: (p: ConnectionProviderSpec) => void;
}) {
  return (
    <button
      onClick={() => onOpen(p)}
      className="group flex w-full items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 text-left transition-colors duration-150 hover:border-[var(--border-medium)] hover:bg-[var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
    >
      <ProviderIcon providerId={p.id} label={p.label} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-[var(--text-primary)]">
          {p.label}
        </span>
        <span className="block truncate text-xs text-[var(--text-secondary)]">{p.description}</span>
      </span>
      {p.connected ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[color:color-mix(in_srgb,var(--accent-green)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-green)_10%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent-green)]">
          <CheckCircle2 size={12} />
          Conectada
        </span>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors duration-150 group-hover:border-[var(--accent-primary)] group-hover:text-[var(--text-primary)]">
          <Plug size={11} />
          Conectar
        </span>
      )}
    </button>
  );
}

export default function ConnectionsView() {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const [providers, setProviders] = useState<ConnectionProviderSpec[]>([]);
  const [categories, setCategories] = useState<ConnectionCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await connectionsApi.connectionsProviders();
      setProviders(res.providers);
      setCategories(res.categories);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudieron cargar las conexiones'), type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void refresh();
    const off = onNotify((method) => {
      if (method === 'connections.changed') void refresh();
    });
    return off;
  }, [refresh]);

  const saveCreds = async (
    p: ConnectionProviderSpec,
    creds: { clientId: string; clientSecret: string },
  ) => {
    try {
      await connectionsApi.connectionsOauthConfigSave({
        provider: p.id,
        client_id: creds.clientId.trim(),
        client_secret: creds.clientSecret.trim() || undefined,
      });
      addToast({ message: `Credenciales de ${p.label} guardadas cifradas`, type: 'success' });
      await refresh();
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudieron guardar las credenciales'), type: 'error' });
    }
  };

  const connect = async (p: ConnectionProviderSpec) => {
    setConnecting(p.id);
    try {
      await connectionsApi.connectionsConnect(p.id);
      addToast({
        message: `Se abrió el navegador para autorizar ${p.label}. Completa el acceso y vuelve aquí.`,
        type: 'success',
      });
    } catch (err) {
      addToast({ message: errorMessage(err, `No se pudo iniciar la conexión con ${p.label}`), type: 'error' });
    } finally {
      setConnecting(null);
    }
  };

  const disconnect = async (p: ConnectionProviderSpec) => {
    const ok = await confirm({
      title: `Desconectar ${p.label}`,
      description: `Se eliminarán los tokens de ${p.label} guardados en este equipo. Los flujos que usan esta conexión dejarán de firmarse.`,
      confirmLabel: 'Desconectar',
      type: 'destructive',
    });
    if (!ok) return;
    try {
      await connectionsApi.connectionsDisconnect(p.id);
      addToast({ message: `${p.label} desconectado`, type: 'success' });
      await refresh();
    } catch (err) {
      addToast({ message: errorMessage(err, `No se pudo desconectar ${p.label}`), type: 'error' });
    }
  };

  const connectedCount = providers.filter((p) => p.connected).length;

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const visible = providers.filter((p) => {
      if (filter === 'connected' && !p.connected) return false;
      if (filter.startsWith('cat:') && (p.category || '') !== filter.slice(4)) return false;
      if (!q) return true;
      return `${p.label} ${p.description}`.toLowerCase().includes(q);
    });
    const byCat = new Map<string, ConnectionProviderSpec[]>();
    for (const p of visible) {
      const key = p.category || '';
      const list = byCat.get(key) ?? [];
      list.push(p);
      byCat.set(key, list);
    }
    const ordered: { id: string; label: string; items: ConnectionProviderSpec[] }[] = [];
    for (const c of categories) {
      const items = byCat.get(c.id);
      if (items?.length) ordered.push({ id: c.id, label: c.label, items });
    }
    const rest = [...byCat.keys()].filter((k) => !categories.some((c) => c.id === k));
    for (const k of rest) {
      const items = byCat.get(k);
      if (items?.length) ordered.push({ id: k || 'otras', label: 'Otras', items });
    }
    return ordered;
  }, [providers, categories, filter, search]);

  const detail = detailId ? providers.find((p) => p.id === detailId) ?? null : null;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
        Cargando conexiones…
      </div>
    );
  }

  const railItem = (
    id: Filter,
    label: string,
    icon: LucideIcon,
    count?: number,
  ) => {
    const Icon = icon;
    const active = filter === id;
    return (
      <button
        key={id}
        onClick={() => setFilter(id)}
        aria-pressed={active}
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors duration-150 ${
          active
            ? 'bg-[var(--bg-elevated)] font-medium text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)] hover:bg-[color:color-mix(in_srgb,var(--bg-elevated)_60%,transparent)] hover:text-[var(--text-primary)]'
        }`}
      >
        <Icon size={13} />
        <span className="flex-1 truncate">{label}</span>
        {count !== undefined && (
          <span className="text-[10px] tabular-nums text-[var(--text-secondary)]">{count}</span>
        )}
      </button>
    );
  };

  return (
    <div className="relative flex h-full">
      <aside className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--border-medium)] px-2 py-4">
        {railItem('all', 'Todas', LayoutGrid, providers.length)}
        {railItem('connected', 'Conectadas', CheckCircle2, connectedCount)}
        {categories.length > 0 && (
          <>
            <div className="mb-1 mt-4 px-2.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
              Categorías
            </div>
            {categories.map((c) =>
              railItem(
                `cat:${c.id}` as Filter,
                c.label,
                CATEGORY_ICONS[c.id] ?? Tag,
                providers.filter((p) => p.category === c.id).length,
              ),
            )}
          </>
        )}
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-5">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Conexiones</h2>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Autoriza apps externas vía OAuth; tus flujos firman sus llamadas con estas cuentas.
              </p>
            </div>
            <div className="relative w-60 shrink-0">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre…"
                aria-label="Buscar conexiones"
                spellCheck={false}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--border-active)] focus:outline-none"
              />
            </div>
          </div>

          {groups.map((g) => (
            <section key={g.id} className="mb-6">
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                {g.label}
              </h3>
              <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
                {g.items.map((p) => (
                  <Row key={p.id} p={p} onOpen={(prov) => setDetailId(prov.id)} />
                ))}
              </div>
            </section>
          ))}

          {!groups.length && (
            <p className="mt-8 text-center text-sm text-[var(--text-secondary)]">
              {providers.length
                ? `Sin resultados para «${search.trim()}»${filter !== 'all' ? ' en este filtro' : ''}.`
                : 'No hay proveedores configurados en el catálogo.'}
            </p>
          )}

          <div className="mt-8 border-t border-[var(--border-subtle)] pt-5">
            <McpServersView />
          </div>
        </div>
      </div>

      {detail && (
        <ConnectionDetail
          provider={detail}
          connecting={connecting === detail.id}
          onConnect={(p) => void connect(p)}
          onDisconnect={(p) => void disconnect(p)}
          onSaveCreds={saveCreds}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
