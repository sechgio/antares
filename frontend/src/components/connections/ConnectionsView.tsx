import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Plus, RefreshCw, Search } from 'lucide-react';
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

type Filter = 'all' | 'connected';

interface Props {
  detailId: string | null;
  onDetailChange: (id: string | null) => void;
  onProvidersChange?: (providers: ConnectionProviderSpec[]) => void;
}

function stateLabel(p: ConnectionProviderSpec): string {
  if (p.connected) return 'Conectada';
  return p.state === 'missing_scopes' ? 'Faltan permisos' : p.state === 'reauth_required' ? 'Volver a conectar'
    : p.state === 'unavailable' ? 'Sin verificar' : p.state === 'connecting' ? 'Conectando…' : 'Conectar';
}

function Row({ p, connecting, onOpen }: { p: ConnectionProviderSpec; connecting?: boolean; onOpen: (p: ConnectionProviderSpec) => void }) {
  const attention = !p.connected && (p.state === 'missing_scopes' || p.state === 'reauth_required');
  const label = connecting && !p.connected ? 'Conectando…' : stateLabel(p);
  return (
    <button
      type="button"
      onClick={() => onOpen(p)}
      className="group flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 hover:bg-[color:color-mix(in_srgb,var(--text-primary)_4%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
    >
      <ProviderIcon providerId={p.id} label={p.label} size={36} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium leading-5 text-[var(--text-primary)]">{p.label}</span>
        <span className="block truncate text-[12.5px] leading-5 text-[var(--text-secondary)]">{p.description}</span>
      </span>
      <span
        title={label}
        className={`flex size-8 shrink-0 items-center justify-center rounded-full transition-colors duration-150 ${
          p.connected
            ? 'text-[var(--accent-green)]'
            : attention
              ? 'text-[var(--accent-yellow)]'
              : 'text-[var(--text-secondary)] group-hover:bg-[var(--bg-input)] group-hover:text-[var(--text-primary)]'
        }`}
      >
        {p.connected ? <Check size={16} strokeWidth={2.25} /> : attention ? <AlertCircle size={16} /> : <Plus size={18} strokeWidth={1.75} />}
        <span className="sr-only">{label}</span>
      </span>
    </button>
  );
}

export default function ConnectionsView({ detailId, onDetailChange, onProvidersChange }: Props) {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const [providers, setProviders] = useState<ConnectionProviderSpec[]>([]);
  const [categories, setCategories] = useState<ConnectionCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [awaitingId, setAwaitingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await connectionsApi.connectionsProviders();
      setProviders(res.providers);
      setCategories(res.categories);
      onProvidersChange?.(res.providers);
      setAwaitingId((id) => (id && res.providers.some((p) => p.id === id && p.connected) ? null : id));
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudieron cargar los complementos'), type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [addToast, onProvidersChange]);

  useEffect(() => {
    void refresh();
    const off = onNotify((method, params) => {
      if (method !== 'connections.changed') return;
      const payload = (params ?? {}) as { error?: string; provider?: string };
      if (payload.error) {
        addToast({ message: payload.error, type: 'error' });
        if (payload.provider) setAwaitingId((id) => (id === payload.provider ? null : id));
      }
      void refresh();
    });
    return off;
  }, [refresh, addToast]);

  const reload = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

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
    const permissions = p.scopes.length ? ` Permisos solicitados: ${p.scopes.join(', ')}.` : '';
    const ok = await confirm({
      title: `Autorizar ${p.label}`,
      description:
        `Se abrirá tu navegador para iniciar sesión en ${p.label}.${permissions} `
        + `Al completar el acceso volverás a Antares; los tokens se guardan cifrados en este equipo. `,
      confirmLabel: 'Abrir navegador y autorizar',
      cancelLabel: 'Cancelar',
    });
    if (!ok) return;
    setConnecting(p.id);
    try {
      await connectionsApi.connectionsConnect(p.id);
      setAwaitingId(p.id);
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
      description: `Se eliminarán los tokens de ${p.label} guardados en este equipo.`,
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

  const cancel = async (p: ConnectionProviderSpec) => {
    setAwaitingId((id) => (id === p.id ? null : id));
    try {
      await connectionsApi.connectionsCancel(p.id);
    } catch {
      // El flujo local termina solo; un fallo al cancelar no requiere acción.
    } finally {
      await refresh();
    }
  };

  const connectedCount = providers.filter((p) => p.connected).length;

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const visible = providers.filter((p) => {
      if (filter === 'connected' && !p.connected) return false;
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

  const detail = providers.find((p) => p.id === detailId) ?? null;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
        Cargando complementos…
      </div>
    );
  }

  const pill = (id: Filter, label: string, count: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setFilter(id)}
      aria-pressed={filter === id}
      className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors duration-150 ${
        filter === id
          ? 'bg-[var(--bg-input)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      }`}
    >
      {label}
      <span className="ml-1.5 tabular-nums text-[var(--text-muted)]">{count}</span>
    </button>
  );

  return (
    <div className="relative h-full">
      <div className="custom-scrollbar h-full overflow-y-auto">
        <div className="mx-auto max-w-[880px] px-8 pb-12 pt-8">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-primary)]">Complementos</h1>
              <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
                Conecta tus herramientas para que el agente pueda trabajar con ellas.
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="flex h-9 w-64 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3.5 focus-within:border-[var(--border-active)]">
                <Search size={14} className="shrink-0 text-[var(--text-secondary)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar complementos"
                  aria-label="Buscar complementos"
                  spellCheck={false}
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                />
              </label>
              <button
                type="button"
                onClick={() => void reload()}
                disabled={refreshing}
                aria-label="Actualizar complementos"
                title="Actualizar"
                className="flex size-9 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] disabled:opacity-50"
              >
                <RefreshCw size={15} className={refreshing ? 'animate-spin' : undefined} />
              </button>
            </div>
          </header>

          <div role="group" aria-label="Filtrar complementos" className="mt-6 flex gap-1">
            {pill('all', 'Todos', providers.length)}
            {pill('connected', 'Conectados', connectedCount)}
          </div>

          {groups.map((g) => (
            <section key={g.id} aria-label={g.label} className="mt-8">
              <h2 className="mb-2 px-3 text-[15px] font-medium text-[var(--text-primary)]">{g.label}</h2>
              <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 lg:grid-cols-2">
                {g.items.map((p) => (
                  <Row key={p.id} p={p} connecting={connecting === p.id || awaitingId === p.id} onOpen={(prov) => onDetailChange(prov.id)} />
                ))}
              </div>
            </section>
          ))}

          {!groups.length && (
            <p className="mt-12 text-center text-sm text-[var(--text-secondary)]">
              {providers.length
                ? search.trim()
                  ? `Sin resultados para «${search.trim()}».`
                  : 'Todavía no hay complementos conectados.'
                : 'No hay complementos configurados en el catálogo.'}
            </p>
          )}

          <div className="mt-10 border-t border-[var(--border-subtle)] px-3 pt-6">
            <McpServersView />
          </div>
        </div>
      </div>

      {detail && (
        <ConnectionDetail
          provider={detail}
          connecting={connecting === detail.id || awaitingId === detail.id}
          onConnect={(p) => void connect(p)}
          onCancel={(p) => void cancel(p)}
          onDisconnect={(p) => void disconnect(p)}
          onSaveCreds={saveCreds}
          onClose={() => onDetailChange(null)}
        />
      )}
    </div>
  );
}
