import { Plus, X } from 'lucide-react';
import { aiProvidersApi, type AiProviderSpec } from '../../api/aiProvidersApi';
import { mcpApi, type McpServer, type McpTool } from '../../api/mcpApi';
import { useEffect, useState } from 'react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';
import ThemedSelect from '../ui/ThemedSelect';
import type { SwitchCase } from './nodeDefs';
import type { FlowNode } from './types';

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
      {children}
    </label>
  );
}

type PatchConfig = (patch: Record<string, unknown>) => void;

export function SwitchConfigEditor({ node, patchConfig }: { node: FlowNode; patchConfig: PatchConfig }) {
  const cases = (Array.isArray(node.config.cases) ? node.config.cases : []) as SwitchCase[];
  const setCases = (next: SwitchCase[]) => patchConfig({ cases: next });
  const nextCasePort = () => {
    let i = 1;
    while (cases.some((c) => c.port === `caso_${i}`) || `caso_${i}` === 'default') i += 1;
    return `caso_${i}`;
  };
  return (
    <>
      <div>
        <FieldLabel>Campo a evaluar</FieldLabel>
        <Input
          value={String(node.config.field ?? '')}
          onChange={(e) => patchConfig({ field: e.target.value })}
          placeholder="=nodes.n1.json.estado"
          spellCheck={false}
          className="font-mono text-xs"
        />
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <FieldLabel>Casos</FieldLabel>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCases([...cases, { value: '', port: nextCasePort() }])}
            aria-label="Añadir caso"
          >
            <Plus size={13} />
          </Button>
        </div>
        <div className="space-y-2">
          {cases.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={c.value == null ? '' : String(c.value)}
                onChange={(e) => {
                  const raw = e.target.value;
                  const num = Number(raw);
                  const value = raw !== '' && !Number.isNaN(num) ? num : raw;
                  setCases(cases.map((x, j) => (j === i ? { ...x, value } : x)));
                }}
                placeholder="Valor"
                spellCheck={false}
                className="font-mono text-xs"
              />
              <span className="shrink-0 text-[10px] text-[var(--text-secondary)]">→ {c.port}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCases(cases.filter((_, j) => j !== i))}
                aria-label="Quitar caso"
              >
                <X size={12} />
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
          Si el campo coincide con el valor, la ejecución sale por el puerto del caso; si no, sale
          por «Defecto».
        </p>
      </div>
    </>
  );
}

export function AgentConfigEditor({ node, patchConfig }: { node: FlowNode; patchConfig: PatchConfig }) {
  const [aiProviders, setAiProviders] = useState<AiProviderSpec[]>([]);
  useEffect(() => {
    let alive = true;
    aiProvidersApi
      .aiProvidersList()
      .then((res) => {
        if (alive) setAiProviders(res.providers);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return (
    <>
      <div>
        <FieldLabel>Proveedor IA</FieldLabel>
        <ThemedSelect
          value={String(node.config.provider ?? '')}
          onChange={(v) => patchConfig({ provider: v })}
          options={[
            { value: '', label: 'Selecciona un proveedor…' },
            ...aiProviders.map((p) => ({
              value: p.id,
              label: p.configured ? p.label : `${p.label} (sin clave)`,
            })),
          ]}
        />
        <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
          Usa la clave guardada en la sección Proveedores IA.
        </p>
      </div>
      <div>
        <FieldLabel>Modelo</FieldLabel>
        <Input
          value={String(node.config.model ?? '')}
          onChange={(e) => patchConfig({ model: e.target.value || undefined })}
          placeholder="Predeterminado del proveedor"
          spellCheck={false}
          className="font-mono text-xs"
        />
      </div>
      <div>
        <FieldLabel>Prompt</FieldLabel>
        <Textarea
          defaultValue={String(node.config.prompt ?? '')}
          rows={6}
          spellCheck={false}
          placeholder="Resume: {{ =nodes.n1.json.text }}"
          onBlur={(e) => patchConfig({ prompt: e.target.value })}
        />
        <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
          Inserta valores con {'{{ =expresión }}'} — p. ej. {'{{ =item.json }}'} o{' '}
          {'{{ =run.trigger.tema }}'}.
        </p>
      </div>
      <div>
        <FieldLabel>Sistema (opcional)</FieldLabel>
        <Textarea
          defaultValue={String(node.config.system ?? '')}
          rows={3}
          spellCheck={false}
          placeholder="Responde en JSON con…"
          onBlur={(e) => patchConfig({ system: e.target.value || undefined })}
        />
      </div>
    </>
  );
}

export function McpCallConfigEditor({ node, patchConfig }: { node: FlowNode; patchConfig: PatchConfig }) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [tools, setTools] = useState<McpTool[]>([]);
  const serverId = String(node.config.server ?? '');
  const toolName = String(node.config.tool ?? '');
  const toolDesc = tools.find((t) => t.name === toolName)?.description;
  useEffect(() => {
    let alive = true;
    mcpApi
      .mcpServersList()
      .then((res) => {
        if (alive) setServers(res.servers);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!serverId) {
      setTools([]);
      return;
    }
    let alive = true;
    mcpApi
      .mcpServerTools(serverId)
      .then((res) => {
        if (alive) setTools(res.tools);
      })
      .catch(() => {
        if (alive) setTools([]);
      });
    return () => {
      alive = false;
    };
  }, [serverId]);
  return (
    <>
      <div>
        <FieldLabel>Servidor MCP</FieldLabel>
        <ThemedSelect
          value={serverId}
          onChange={(v) => patchConfig({ server: v, tool: '' })}
          options={[
            { value: '', label: 'Selecciona un servidor…' },
            ...servers.map((s) => ({ value: s.id, label: `${s.name} (${s.transport})` })),
          ]}
        />
        <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
          Se registran en Conexiones → Servidores MCP.
        </p>
      </div>
      <div>
        <FieldLabel>Tool</FieldLabel>
        <ThemedSelect
          value={toolName}
          onChange={(v) => patchConfig({ tool: v })}
          options={[
            { value: '', label: serverId ? 'Selecciona una tool…' : 'Elige primero un servidor' },
            ...tools.map((t) => ({ value: t.name, label: t.name })),
          ]}
        />
        {toolDesc && <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{toolDesc}</p>}
      </div>
      <div>
        <FieldLabel>Argumentos (JSON)</FieldLabel>
        <Textarea
          defaultValue={
            node.config.args == null ? '' : JSON.stringify(node.config.args, null, 2)
          }
          rows={4}
          spellCheck={false}
          placeholder='{"param": "{{ =item.json.valor }}"}'
          onBlur={(e) => {
            const raw = e.target.value.trim();
            if (!raw) {
              patchConfig({ args: undefined });
              return;
            }
            try {
              patchConfig({ args: JSON.parse(raw) });
            } catch {
              // se conserva el texto; validar al guardar es opcional
            }
          }}
        />
      </div>
    </>
  );
}

export function RetryConfigEditor({ node, onChange }: { node: FlowNode; onChange: (n: FlowNode) => void }) {
  const retry = (node.config.retry ?? {}) as { attempts?: number; delay_ms?: number };
  const enabled = node.config.retry != null;
  const patch = (p: { attempts?: number; delay_ms?: number } | null) => {
    if (p === null) {
      const next = { ...node.config };
      delete next.retry;
      onChange({ ...node, config: next });
      return;
    }
    onChange({ ...node, config: { ...node.config, retry: { attempts: 1, delay_ms: 0, ...retry, ...p } } });
  };
  return (
    <div className="rounded-md border border-[var(--border-medium)] p-3">
      <label className="flex items-center gap-2 text-xs text-[var(--text-primary)]">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => patch(e.target.checked ? {} : null)}
          className="accent-[var(--accent-primary)]"
        />
        Reintentar si falla
      </label>
      {enabled && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <FieldLabel>Intentos</FieldLabel>
            <Input
              type="number"
              min={1}
              max={5}
              value={retry.attempts ?? 1}
              onChange={(e) => {
                const v = Math.round(Number(e.target.value));
                if (Number.isFinite(v)) patch({ attempts: Math.min(Math.max(v, 1), 5) });
              }}
            />
          </div>
          <div>
            <FieldLabel>Espera (ms)</FieldLabel>
            <Input
              type="number"
              min={0}
              max={60000}
              step={100}
              value={retry.delay_ms ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) patch({ delay_ms: Math.min(Math.max(v, 0), 60000) });
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
