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

export type DataSource = { value: string; label: string };

export function ObjectFieldsEditor({ value, onChange, fields = [], sources = [], allowAdd = true }: {
  value: unknown;
  onChange: (value: Record<string, unknown>) => void;
  fields?: string[];
  sources?: DataSource[];
  allowAdd?: boolean;
}) {
  const [newField, setNewField] = useState('');
  if (value != null && (typeof value !== 'object' || Array.isArray(value))) {
    return <p className="text-xs text-[var(--text-secondary)]">Este valor usa una expresión o lista. Puedes editarlo en las opciones avanzadas.</p>;
  }
  const data = (value ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...fields, ...Object.keys(data)])];
  return (
    <div className="space-y-3">
    {keys.map((key) => {
      const current = data[key];
      const kind = typeof current === 'string' && current.startsWith('=') ? 'source' : typeof current;
      return (
        <div key={key} className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <FieldLabel>{({ id: 'Identificador del elemento', run_id: 'Identificador de ejecución', format_id: 'Identificador del formato', name: 'Nombre', value: 'Valor a comparar',
            document: 'Plantilla de Canvas', contexts: 'Datos e imágenes de los paneles', localImagePaths: 'Archivos de las imágenes', outputPath: 'Archivo de salida', output_path: 'Archivo de salida',
            template_name: 'Plantilla HTML', context: 'Datos de la plantilla', html: 'Contenido del documento', desde: 'Número inicial', hasta: 'Número final',
            rows: 'Filas de datos', key_column: 'Columna ID', image_names: 'Nombres de las imágenes', image_paths: 'Archivos de las imágenes', panels: 'Paneles preparados', template_id: 'Plantilla',
            files: 'Archivos de entrada', destino: 'Carpeta de salida', formato: 'Formato de imagen', pdf_path: 'PDF de entrada', stamp_path: 'Imagen del sello', stamp_count: 'Cantidad de sellos',
            excelPath: 'Excel de entrada', outputDir: 'Carpeta de salida',
            printer_name: 'Impresora', copies: 'Copias',
          } as Record<string, string>)[key] ?? key}</FieldLabel>
          {!fields.includes(key) && (
            <Button variant="ghost" size="sm" aria-label={`Quitar ${key}`} onClick={() => {
              const next = { ...data };
              delete next[key];
              onChange(next);
            }}><X size={12} /></Button>
          )}
        </div>
        {current != null && typeof current === 'object' ? <p className="text-xs text-[var(--text-secondary)]">Valor compuesto: editar en opciones avanzadas.</p> : <>
          <ThemedSelect
            aria-label={`Tipo de ${key}`}
            value={current == null ? 'string' : kind}
            options={[
              { value: 'string', label: 'Texto' },
              { value: 'number', label: 'Número' },
              { value: 'boolean', label: 'Sí / No' },
              ...(sources.length || kind === 'source' ? [{ value: 'source', label: 'Datos de otro paso' }] : []),
            ]}
            onChange={(type) => onChange({ ...data, [key]: type === 'number' ? 0 : type === 'boolean' ? true : type === 'source' ? sources[0]?.value ?? current : '' })}
          />
          {kind === 'source' ? (
            <ThemedSelect
              aria-label={`Dato para ${key}`} value={String(current)}
              options={sources.some((s) => s.value === current) ? sources : [...sources, { value: String(current), label: 'Expresión personalizada' }]}
              onChange={(v) => onChange({ ...data, [key]: v })}
            />
          ) : kind === 'boolean' ? (
            <ThemedSelect
              aria-label={`Valor de ${key}`} value={String(current)}
              options={[{ value: 'true', label: 'Sí' }, { value: 'false', label: 'No' }]}
              onChange={(v) => onChange({ ...data, [key]: v === 'true' })}
            />
          ) : <Input aria-label={`Valor de ${key}`} className="w-full" type={kind === 'number' ? 'number' : 'text'} value={current == null ? '' : String(current)}
            onChange={(e) => {
              if (kind === 'number' && (e.target.value === '' || !Number.isFinite(Number(e.target.value)))) return;
              onChange({ ...data, [key]: kind === 'number' ? Number(e.target.value) : e.target.value });
            }} />}
        </>}
        </div>
      );
    })}
    {keys.length === 0 && <p className="text-xs text-[var(--text-secondary)]">No necesitas completar campos para las consultas generales. Añade uno si quieres enviar datos.</p>}
    {allowAdd && <div className="flex items-center gap-1">
      <Input aria-label="Nombre del nuevo campo" placeholder="Nombre del campo" className="min-w-0 flex-1" value={newField} onChange={(e) => setNewField(e.target.value)} />
      <Button size="sm" variant="secondary" disabled={!newField.trim() || keys.includes(newField.trim())} onClick={() => {
        onChange({ ...data, [newField.trim()]: '' });
        setNewField('');
      }}>Añadir</Button>
    </div>}
    </div>
  );
}

export function SwitchConfigEditor({ node, patchConfig, sources = [] }: { node: FlowNode; patchConfig: PatchConfig; sources?: DataSource[] }) {
  const cases = (Array.isArray(node.config.cases) ? node.config.cases : []) as SwitchCase[];
  const setCases = (next: SwitchCase[]) => patchConfig({ cases: next });
  const nextCasePort = () => {
    let i = 1;
    while (cases.some((c) => c.port === `caso_${i}`)) i += 1;
    return `caso_${i}`;
  };
  return (
    <>
      <div>
        <FieldLabel>Campo a evaluar</FieldLabel>
        <ThemedSelect aria-label="Dato a distribuir" value={String(node.config.field ?? '')}
          options={[{ value: '', label: 'Elige datos de un paso conectado…' }, ...sources,
            ...(node.config.field && !sources.some((s) => s.value === node.config.field) ? [{ value: String(node.config.field), label: 'Expresión personalizada' }] : [])]}
          onChange={(field) => patchConfig({ field })} />
        <details>
        <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">Expresión avanzada</summary>
        <Input
          value={String(node.config.field ?? '')}
          onChange={(e) => patchConfig({ field: e.target.value })}
          placeholder="=nodes.n1.json.estado"
          spellCheck={false}
          className="font-mono text-xs"
        />
        </details>
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

export function AgentConfigEditor({ node, patchConfig, sources = [] }: { node: FlowNode; patchConfig: PatchConfig; sources?: DataSource[] }) {
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
        <FieldLabel>¿Qué debe hacer la IA?</FieldLabel>
        <Textarea
          value={String(node.config.prompt ?? '')}
          rows={6}
          spellCheck={false}
          placeholder="Resume: {{ =nodes.n1.json.text }}"
          onChange={(e) => patchConfig({ prompt: e.target.value })}
        />
        {sources.length > 0 && <ThemedSelect aria-label="Insertar datos en las instrucciones" value=""
          options={[{ value: '', label: 'Insertar datos de otro paso…' }, ...sources]}
          onChange={(v) => { if (v) patchConfig({ prompt: `${String(node.config.prompt ?? '')} {{ ${v} }}` }); }} />}
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
      <div className="rounded-md border border-[var(--border-medium)] p-3">
        <label className="flex items-center gap-2 text-xs text-[var(--text-primary)]">
          <input
            type="checkbox"
            checked={node.config.tools === true || Array.isArray(node.config.tools)}
            onChange={(e) => patchConfig({ tools: e.target.checked ? true : false })}
            className="accent-[var(--accent-primary)]"
          />
          Permitir herramientas de Antares
        </label>
        {(node.config.tools === true || Array.isArray(node.config.tools)) && (
          <div className="mt-2 space-y-2">
            <p className="text-[11px] text-[var(--text-secondary)]">
              El agente puede consultar datos y ejecutar acciones. Las acciones con
              efectos pausan la ejecución hasta que las apruebes en Ejecuciones.
            </p>
            <div>
              <FieldLabel>Pasos máximos del agente</FieldLabel>
              <Input
                type="number"
                min={1}
                max={12}
                value={Number(node.config.max_steps ?? 8)}
                onChange={(e) => {
                  const v = Math.round(Number(e.target.value));
                  if (Number.isFinite(v)) patchConfig({ max_steps: Math.min(Math.max(v, 1), 12) });
                }}
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={node.config.auto_approve === true}
                onChange={(e) => patchConfig({ auto_approve: e.target.checked ? true : undefined })}
                className="accent-[var(--accent-primary)]"
              />
              Aprobar acciones automáticamente (sin pausar)
            </label>
          </div>
        )}
      </div>
    </>
  );
}

export function McpCallConfigEditor({ node, patchConfig, sources = [], invalid = false }: { node: FlowNode; patchConfig: PatchConfig; sources?: DataSource[]; invalid?: boolean }) {
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
        <FieldLabel>Herramienta</FieldLabel>
        <ThemedSelect
          value={toolName}
          onChange={(v) => patchConfig({ tool: v })}
          options={[
            { value: '', label: serverId ? 'Selecciona una herramienta…' : 'Elige primero un servidor' },
            ...tools.map((t) => ({ value: t.name, label: t.name })),
          ]}
        />
        {toolDesc && <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{toolDesc}</p>}
      </div>
      <div>
        <FieldLabel>Datos para la herramienta</FieldLabel>
        <fieldset disabled={invalid}>
          <ObjectFieldsEditor value={node.config.args} sources={sources} onChange={(args) => patchConfig({ args })} />
        </fieldset>
        <details>
        <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">Argumentos avanzados (JSON)</summary>
        <FieldLabel>Argumentos (JSON)</FieldLabel>
        <Textarea
          key={JSON.stringify(node.config.args)}
          data-json
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
              // El borrador inválido permanece visible y bloquea el guardado.
            }
          }}
        />
        </details>
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
