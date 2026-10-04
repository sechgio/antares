import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Terminal, Trash2, Wrench } from 'lucide-react';
import { mcpApi, type McpServer, type McpTool } from '../../api/mcpApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';
import ThemedSelect from '../ui/ThemedSelect';

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

function ServerCard({ server, onDeleted }: { server: McpServer; onDeleted: () => void }) {
  const { addToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [loadingTools, setLoadingTools] = useState(false);

  const toggleTools = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && tools === null && !loadingTools) {
      setLoadingTools(true);
      try {
        const res = await mcpApi.mcpServerTools(server.id);
        setTools(res.tools);
      } catch (err) {
        addToast({ message: errorMessage(err, 'No se pudieron listar las tools'), type: 'error' });
        setExpanded(false);
      } finally {
        setLoadingTools(false);
      }
    }
  };

  const remove = async () => {
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
          {server.tools_count != null ? `${server.tools_count} tools` : 'Ver tools'}
          {loadingTools && '…'}
        </button>
        {server.secret_keys.length > 0 && <span>Claves: {server.secret_keys.join(', ')}</span>}
      </div>

      {expanded && tools && (
        <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-md bg-[var(--bg-input)] p-2">
          {tools.map((t) => (
            <li key={t.name} className="text-[11px]">
              <code className="text-[var(--text-primary)]">{t.name}</code>
              {t.description && <span className="ml-1.5 text-[var(--text-secondary)]">{t.description}</span>}
            </li>
          ))}
          {!tools.length && <li className="text-[11px] text-[var(--text-secondary)]">Sin tools publicadas</li>}
        </ul>
      )}
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
  const [saving, setSaving] = useState(false);

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

  const save = async () => {
    setSaving(true);
    try {
      const secrets = parseSecretLines(secretsText);
      await mcpApi.mcpServerAdd({
        name: name.trim(),
        transport,
        url: url.trim(),
        command: command.trim(),
        args: args.trim() ? args.trim().split(/\s+/) : [],
        secrets:
          Object.keys(secrets).length > 0
            ? transport === 'http'
              ? { headers: secrets }
              : { env: secrets }
            : undefined,
      });
      addToast({ message: 'Servidor MCP registrado', type: 'success' });
      setShowForm(false);
      setName('');
      setUrl('');
      setCommand('');
      setArgs('');
      setSecretsText('');
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
        Servidores Model Context Protocol: tools externas que el agente puede usar tras tu
        aprobación y que el nodo «Llamada MCP» puede invocar en flujos. Las claves se guardan
        cifradas en el vault.
      </p>

      {showForm && (
        <div className="mb-4 space-y-2 rounded-xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-4">
          <div className="grid grid-cols-2 gap-2">
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
                placeholder="Argumentos separados por espacios"
                spellCheck={false}
                aria-label="Argumentos"
              />
            </div>
          )}
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
          <Button size="sm" disabled={saving || !name.trim()} onClick={() => void save()}>
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
