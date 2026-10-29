import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Terminal, Trash2, Wrench } from 'lucide-react';
import { mcpApi, type McpServer, type McpTool } from '../../api/mcpApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import { useDialog } from '../../hooks/useDialog';
import Button from '../ui/Button';
import Input from '../ui/Input';
import ThemedSelect from '../ui/ThemedSelect';
import Toggle from '../ui/Toggle';

function parseSecretLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

type McpOauthConfig = { token_url: string; client_id: string; client_secret?: string; scopes?: string[] };

function publicConfig(value: unknown): { name: string; transport: 'http' | 'stdio'; url: string; command: string; args: string[]; oauth?: McpOauthConfig } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('La configuración debe ser un objeto JSON');
  const config = value as Record<string, unknown>;
  if (Object.keys(config).some((key) => !['name', 'transport', 'url', 'command', 'args', 'oauth'].includes(key))) {
    throw new Error('Introduce los secretos por separado; el JSON admite nombre, transporte, URL, comando, argumentos y oauth');
  }
  if (config.transport !== 'http' && config.transport !== 'stdio') throw new Error('El transporte debe ser http o stdio');
  if (!Array.isArray(config.args ?? []) || (config.args as unknown[] ?? []).some((arg) => typeof arg !== 'string')
    || (config.args as unknown[] ?? []).length > 32) throw new Error('Los argumentos deben ser una lista de hasta 32 textos');
  let oauth: McpOauthConfig | undefined;
  if (config.oauth !== undefined) {
    const maybe = config.oauth;
    const o = maybe && typeof maybe === 'object' && !Array.isArray(maybe) ? (maybe as Record<string, unknown>) : null;
    if (!o || typeof o.token_url !== 'string' || !o.token_url.trim()
      || typeof o.client_id !== 'string' || !o.client_id.trim()
      || (o.client_secret !== undefined && typeof o.client_secret !== 'string')
      || (o.scopes !== undefined && (!Array.isArray(o.scopes) || o.scopes.some((s) => typeof s !== 'string')))) {
      throw new Error('OAuth requiere token_url y client_id (texto) y, opcionalmente, client_secret y scopes (lista de textos)');
    }
    oauth = {
      token_url: o.token_url.trim(),
      client_id: o.client_id.trim(),
      ...(typeof o.client_secret === 'string' && o.client_secret.trim() ? { client_secret: o.client_secret.trim() } : {}),
      ...(Array.isArray(o.scopes) && o.scopes.length ? { scopes: o.scopes as string[] } : {}),
    };
  }
  return { name: String(config.name || ''), transport: config.transport, url: String(config.url || ''),
    command: String(config.command || ''), args: (config.args ?? []) as string[], ...(oauth ? { oauth } : {}) };
}

function ServerCard({ server, onDeleted }: { server: McpServer; onDeleted: () => void }) {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const [expanded, setExpanded] = useState(false);
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [loadingTools, setLoadingTools] = useState(false);
  const [savingTool, setSavingTool] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState('Sin verificar');

  const setEnabled = async (tool: McpTool, enabled: boolean) => {
    if (savingTool) return;
    setSavingTool(tool.name);
    setTools((items) => items?.map((item) => item.name === tool.name ? { ...item, enabled } : item) ?? null);
    try {
      await mcpApi.mcpServerToolSet(server.id, tool.name, enabled);
    } catch (err) {
      setTools((items) => items?.map((item) => item.name === tool.name ? tool : item) ?? null);
      addToast({ message: errorMessage(err, 'No se pudo guardar la selección de herramientas'), type: 'error' });
    } finally {
      setSavingTool(null);
    }
  };

  const toggleTools = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && tools === null && !loadingTools) {
      setLoadingTools(true);
      try {
        const res = await mcpApi.mcpServerTools(server.id);
        setTools(res.tools);
        setConnectionState('Catálogo verificado');
      } catch (err) {
        setConnectionState('No se pudo conectar; vuelve a verificar');
        addToast({ message: errorMessage(err, 'No se pudieron listar las herramientas'), type: 'error' });
        setExpanded(false);
      } finally {
        setLoadingTools(false);
      }
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Eliminar servidor',
      description: `¿Eliminar «${server.name}»? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      type: 'destructive',
    });
    if (!ok) return;
    try {
      await mcpApi.mcpServerDelete(server.id);
      addToast({ message: `Servidor ${server.name} eliminado`, type: 'success' });
      onDeleted();
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo eliminar el servidor'), type: 'error' });
    }
  };

  return (
    <section className="rounded-xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-input)] text-[var(--text-secondary)]">
            <Terminal size={15} />
          </span>
          <div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">{server.name}</div>
            <div className="max-w-[300px] truncate font-mono text-[11px] text-[var(--text-secondary)]">
              {server.transport === 'http' ? server.url : `${server.command} ${server.args.join(' ')}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--text-secondary)]">
            {server.transport}
          </span>
          {server.oauth && (
            <span className="rounded bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--text-secondary)]" title={`OAuth client_credentials · ${server.oauth.client_id}`}>
              OAuth
            </span>
          )}
          <Button size="sm" variant="ghost" onClick={() => void remove()} aria-label={`Eliminar ${server.name}`}>
            <Trash2 size={13} />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 text-[11px] text-[var(--text-secondary)]">
        <button
          type="button"
          onClick={() => void toggleTools()}
          className="flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Wrench size={11} />
          {server.tools_count != null ? `${server.tools_count} herramientas` : 'Ver herramientas'}
          {loadingTools && '…'}
        </button>
        {server.secret_keys.length > 0 && <span>Claves: {server.secret_keys.join(', ')}</span>}
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-secondary)]" role="status">{connectionState}</p>
      <details className="mt-2 text-[11px] text-[var(--text-secondary)]">
        <summary className="cursor-pointer">Ver configuración pública</summary>
        <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify({ name: server.name, transport: server.transport,
          ...(server.transport === 'http' ? { url: server.url } : { command: server.command, args: server.args }), secret_keys: server.secret_keys }, null, 2)}</pre>
      </details>

      {expanded && tools && (
        <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-md bg-[var(--bg-input)] p-2">
          {tools.map((t) => (
            <li key={t.name} className="flex items-center gap-3 py-1 text-[11px]">
              <div className="min-w-0 flex-1 break-words">
                <code className="text-[var(--text-primary)]">{t.name}</code>
                {t.description && <p className="text-[var(--text-secondary)]">{t.description}</p>}
              </div>
              <Toggle checked={t.enabled !== false} disabled={savingTool !== null}
                aria-label={`Habilitar ${t.name}`} onChange={(enabled) => void setEnabled(t, enabled)} />
            </li>
          ))}
          {!tools.length && <li className="text-[11px] text-[var(--text-secondary)]">Sin herramientas publicadas</li>}
        </ul>
      )}
      {server.transport === 'stdio' && <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
        Este proceso se ejecuta con tu usuario de Windows. Puede acceder al sistema; los permisos de archivos de Antares no lo aíslan.
      </p>}
    </section>
  );
}

export default function McpServersView() {
  const { addToast } = useToast();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'http' | 'stdio'>('stdio');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [secretsText, setSecretsText] = useState('');
  const [oauthTokenUrl, setOauthTokenUrl] = useState('');
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthSecret, setOauthSecret] = useState('');
  const [oauthScopes, setOauthScopes] = useState('');
  const [saving, setSaving] = useState(false);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonConfig, setJsonConfig] = useState('{}');

  const refresh = useCallback(async () => {
    try {
      const res = await mcpApi.mcpServersList();
      setServers(res.servers);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudieron cargar los servidores MCP'), type: 'error' });
    }
  }, [addToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const oauthConfig =
    transport === 'http' && oauthTokenUrl.trim() && oauthClientId.trim()
      ? {
          token_url: oauthTokenUrl.trim(),
          client_id: oauthClientId.trim(),
          ...(oauthSecret.trim() ? { client_secret: oauthSecret.trim() } : {}),
          ...(oauthScopes.trim()
            ? { scopes: oauthScopes.split(',').map((s) => s.trim()).filter(Boolean) }
            : {}),
        }
      : undefined;

  const save = async () => {
    setSaving(true);
    try {
      const secrets = parseSecretLines(secretsText);
      const config = publicConfig(jsonMode ? JSON.parse(jsonConfig) : { name: name.trim(), transport, url: url.trim(), command: command.trim(),
        args: args.trim().startsWith('[') ? JSON.parse(args) : args.trim() ? args.trim().split(/\s+/) : [] });
      const oauth = oauthConfig ?? config.oauth;
      await mcpApi.mcpServerAdd({
        ...config,
        secrets:
          Object.keys(secrets).length > 0
            ? config.transport === 'http'
              ? { headers: secrets }
              : { env: secrets }
            : undefined,
        ...(oauth ? { oauth } : {}),
      });
      addToast({ message: 'Servidor MCP registrado', type: 'success' });
      setShowForm(false);
      setName('');
      setUrl('');
      setCommand('');
      setArgs('');
      setSecretsText('');
      setOauthTokenUrl('');
      setOauthClientId('');
      setOauthSecret('');
      setOauthScopes('');
      await refresh();
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo registrar el servidor'), type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Servidores MCP</h2>
        <Button size="sm" variant="secondary" onClick={() => setShowForm((v) => !v)}>
          <Plus size={13} className="mr-1" />
          Añadir servidor
        </Button>
      </div>
      <p className="mb-4 mt-1 text-xs text-[var(--text-secondary)]">
        Servidores Model Context Protocol: herramientas externas que el agente puede usar tras tu
        aprobación. Las claves se guardan cifradas en el vault.
      </p>

      {showForm && (
        <div className="mb-4 space-y-2 rounded-xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-4">
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" aria-pressed={!jsonMode} onClick={() => {
              if (!jsonMode) return;
              try {
                const config = publicConfig(JSON.parse(jsonConfig));
                setName(config.name); setTransport(config.transport); setUrl(config.url); setCommand(config.command); setArgs(JSON.stringify(config.args));
                setOauthTokenUrl(config.oauth?.token_url ?? ''); setOauthClientId(config.oauth?.client_id ?? '');
                setOauthSecret(config.oauth?.client_secret ?? ''); setOauthScopes((config.oauth?.scopes ?? []).join(', '));
                setJsonMode(false);
              } catch (err) { addToast({ message: errorMessage(err, 'JSON inválido'), type: 'error' }); }
            }}>Formulario</Button>
            <Button size="sm" variant="secondary" aria-pressed={jsonMode} onClick={() => {
              if (jsonMode) return;
              try {
                setJsonConfig(JSON.stringify({ name, transport, url, command,
                  args: args.trim().startsWith('[') ? JSON.parse(args) : args.trim() ? args.trim().split(/\s+/) : [],
                  ...(oauthConfig ? { oauth: oauthConfig } : {}) }, null, 2));
                setJsonMode(true);
              } catch (err) { addToast({ message: errorMessage(err, 'Argumentos inválidos'), type: 'error' }); }
            }}>JSON</Button>
          </div>
          {jsonMode ? <textarea value={jsonConfig} onChange={(event) => setJsonConfig(event.target.value)} rows={8}
            aria-label="Configuración JSON del servidor" spellCheck={false}
            className="w-full rounded-md border border-[var(--border-medium)] bg-[var(--bg-input)] p-2 font-mono text-xs text-[var(--text-primary)]" /> : <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre (p. ej. GitHub MCP)"
              aria-label="Nombre del servidor"
            />
            <ThemedSelect
              value={transport}
              onChange={(v) => setTransport(v as 'http' | 'stdio')}
              options={[
                { value: 'stdio', label: 'stdio (proceso local)' },
                { value: 'http', label: 'HTTP (remoto)' },
              ]}
              aria-label="Transporte"
            />
          </div>
          {transport === 'http' ? (
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://servidor.example.com/mcp"
              spellCheck={false}
              aria-label="URL del servidor MCP"
            />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="Comando (p. ej. npx)"
                spellCheck={false}
                aria-label="Comando"
              />
              <Input
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder='Argumentos: ["-y", "paquete", "texto con espacios"]'
                spellCheck={false}
                aria-label="Argumentos"
              />
            </div>
          )}
          </>}
          <textarea
            value={secretsText}
            onChange={(e) => setSecretsText(e.target.value)}
            placeholder={
              transport === 'http'
                ? 'Cabeceras secretas, una por línea:\nAuthorization=Bearer xxx'
                : 'Variables de entorno, una por línea:\nAPI_KEY=xxx'
            }
            rows={3}
            spellCheck={false}
            aria-label="Secretos del servidor"
            className="w-full rounded-md border border-[var(--border-medium)] bg-[var(--bg-input)] px-3 py-2 font-mono text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
          />
          {transport === 'http' && (
            <details className="rounded-md border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-2">
              <summary className="cursor-pointer text-[11px] font-medium text-[var(--text-secondary)]">
                OAuth (opcional): token automático para este servidor
              </summary>
              <div className="mt-2 space-y-2">
                <Input
                  value={oauthTokenUrl}
                  onChange={(e) => setOauthTokenUrl(e.target.value)}
                  placeholder="URL del endpoint de token (p. ej. https://servidor.example.com/oauth/token)"
                  spellCheck={false}
                  aria-label="URL del endpoint de token OAuth"
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input
                    value={oauthClientId}
                    onChange={(e) => setOauthClientId(e.target.value)}
                    placeholder="Client ID"
                    spellCheck={false}
                    aria-label="Client ID OAuth"
                  />
                  <Input
                    type="password"
                    value={oauthSecret}
                    onChange={(e) => setOauthSecret(e.target.value)}
                    placeholder="Client Secret (opcional)"
                    aria-label="Client Secret OAuth"
                  />
                </div>
                <Input
                  value={oauthScopes}
                  onChange={(e) => setOauthScopes(e.target.value)}
                  placeholder="Scopes separados por comas (opcional)"
                  spellCheck={false}
                  aria-label="Scopes OAuth"
                />
                <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                  Si el servidor exige OAuth (client_credentials), Antares pedirá un bearer token y lo
                  renovará solo. El secreto se guarda cifrado en el vault.
                </p>
              </div>
            </details>
          )}
          <Button size="sm" disabled={saving || (!jsonMode && !name.trim())} onClick={() => void save()}>
            Registrar servidor
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {servers.map((s) => (
          <ServerCard key={s.id} server={s} onDeleted={() => void refresh()} />
        ))}
      </div>
      {!servers.length && !showForm && (
        <p className="text-center text-sm text-[var(--text-secondary)]">
          Ningún servidor MCP registrado todavía.
        </p>
      )}
    </div>
  );
}
