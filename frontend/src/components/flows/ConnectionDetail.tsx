import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, KeyRound, Link2, X } from 'lucide-react';
import type { ConnectionProviderSpec } from '../../api/connectionsApi';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { ProviderIcon } from './connectionIcons';

interface Props {
  provider: ConnectionProviderSpec;
  connecting: boolean;
  onConnect: (p: ConnectionProviderSpec) => void;
  onDisconnect: (p: ConnectionProviderSpec) => void;
  onSaveCreds: (
    p: ConnectionProviderSpec,
    creds: { clientId: string; clientSecret: string },
  ) => Promise<void>;
  onClose: () => void;
}

function StatusPill({ p }: { p: ConnectionProviderSpec }) {
  if (p.connected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:color-mix(in_srgb,var(--accent-green)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-green)_10%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-green)]">
        <Check size={11} strokeWidth={3} />
        Conectada{p.account ? ` · ${p.account}` : ''}
      </span>
    );
  }
  if (p.configured) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:color-mix(in_srgb,var(--accent-yellow)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-yellow)_10%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-yellow)]">
        Lista para conectar
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] px-2.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
      Sin credenciales
    </span>
  );
}

export default function ConnectionDetail({
  provider: p,
  connecting,
  onConnect,
  onDisconnect,
  onSaveCreds,
  onClose,
}: Props) {
  const { addToast } = useToast();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    setClientId('');
    setClientSecret('');
    setCopied(false);
  }, [p.id]);

  const copyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(p.redirect_hint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      addToast({ message: 'No se pudo copiar la redirect URI', type: 'error' });
    }
  };

  const save = async () => {
    if (!clientId.trim()) {
      addToast({ message: 'Introduce el Client ID de tu app', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      await onSaveCreds(p, { clientId, clientSecret });
      setClientId('');
      setClientSecret('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside
      className={`absolute inset-y-0 right-0 z-10 flex w-[340px] shrink-0 flex-col border-l border-[var(--border-medium)] bg-[var(--bg-base)] shadow-[-12px_0_32px_rgba(0,0,0,0.35)] transition-transform duration-200 ease-out ${
        mounted ? 'translate-x-0' : 'translate-x-full'
      }`}
      aria-label={`Detalle de ${p.label}`}
    >
      <header className="flex items-start gap-3 border-b border-[var(--border-subtle)] px-4 py-4">
        <ProviderIcon providerId={p.id} label={p.label} size={38} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{p.label}</h3>
            <StatusPill p={p} />
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-secondary)]">{p.description}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Cerrar detalle"
          className="rounded-md p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          <X size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <div>
          {p.connected ? (
            <Button size="sm" variant="secondary" className="w-full" onClick={() => onDisconnect(p)}>
              Desconectar
            </Button>
          ) : (
            <Button
              size="sm"
              className="w-full"
              disabled={!p.configured || connecting}
              onClick={() => onConnect(p)}
            >
              <Link2 size={13} />
              {connecting ? 'Abriendo navegador…' : `Conectar con ${p.label}`}
            </Button>
          )}
          {p.connected && p.expiry_date ? (
            <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
              El token caduca el {new Date(p.expiry_date).toLocaleString('es')}
            </p>
          ) : null}
        </div>

        <div>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
            Redirect URI
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-[var(--bg-input)] px-2.5 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-primary)]">
              {p.redirect_hint}
            </code>
            <button
              onClick={() => void copyRedirect()}
              aria-label="Copiar redirect URI"
              className="rounded p-1 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              {copied ? <Check size={13} className="text-[var(--accent-green)]" /> : <Copy size={13} />}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
            Regístrala en tu app del proveedor.
          </p>
        </div>

        {p.scopes.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
              Permisos solicitados
            </div>
            <div className="flex flex-wrap gap-1.5">
              {p.scopes.map((s) => (
                <code
                  key={s}
                  className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]"
                >
                  {s}
                </code>
              ))}
            </div>
            {p.connected && p.scope && p.scope !== p.scopes.join(' ') && (
              <p className="mt-1.5 truncate text-[11px] text-[var(--text-secondary)]">
                Concedidos: {p.scope}
              </p>
            )}
          </div>
        )}

        <div className="border-t border-[var(--border-subtle)] pt-4">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
              Credenciales de tu app
            </div>
            {p.docs && (
              <button
                onClick={() => window.open(p.docs, '_blank')}
                className="inline-flex items-center gap-1 text-[11px] text-[var(--accent-blue)] transition-colors hover:text-[var(--accent-primary-hover)]"
              >
                <ExternalLink size={11} />
                Panel del proveedor
              </button>
            )}
          </div>
          <p className="mb-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            {p.configured
              ? `Client ID actual: ${p.client_id_masked ?? 'guardado'}`
              : 'Crea una app OAuth en el panel del proveedor y pega aquí sus credenciales; se guardan cifradas (BYOK).'}
          </p>
          <div className="space-y-2">
            <Input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={p.configured ? 'Nuevo Client ID (opcional)' : 'Client ID'}
              spellCheck={false}
              aria-label={`Client ID de ${p.label}`}
            />
            {p.requires_client_secret && (
              <Input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Client Secret"
                spellCheck={false}
                aria-label={`Client Secret de ${p.label}`}
              />
            )}
            <Button size="sm" variant="secondary" disabled={saving} onClick={() => void save()}>
              <KeyRound size={13} />
              {p.configured ? 'Actualizar credenciales' : 'Guardar credenciales'}
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
