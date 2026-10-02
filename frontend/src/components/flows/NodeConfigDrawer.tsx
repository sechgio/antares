import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { flowsApi } from '../../api/flowsApi';
import { connectionsApi } from '../../api/connectionsApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';
import ThemedSelect from '../ui/ThemedSelect';
import { CONDITION_OPS, ENABLED_TRIGGER_KINDS, NODE_KIND_DEFS, TRIGGER_KIND_LABELS } from './nodeDefs';
import type { FlowNode, TriggerKind } from './types';

interface Props {
  node: FlowNode | null;
  onChange: (node: FlowNode) => void;
  onDelete: (nodeId: string) => void;
  onClose: () => void;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
      {children}
    </label>
  );
}

export default function NodeConfigDrawer({ node, onChange, onDelete, onClose }: Props) {
  const { addToast } = useToast();
  const [methods, setMethods] = useState<string[]>([]);
  const [connections, setConnections] = useState<{ id: string; label: string; connected: boolean }[]>([]);

  useEffect(() => {
    let alive = true;
    flowsApi
      .flowsOrchestratableMethods()
      .then((res) => {
        if (alive) setMethods(res.methods);
      })
      .catch((err) => addToast({ message: errorMessage(err, 'No se pudieron cargar los métodos'), type: 'error' }));
    connectionsApi
      .connectionsProviders()
      .then((res) => {
        if (alive)
          setConnections(
            res.providers.map((p) => ({ id: p.id, label: p.label, connected: p.connected })),
          );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [addToast]);

  if (!node) return null;
  const def = NODE_KIND_DEFS[node.kind];

  const patchConfig = (patch: Record<string, unknown>) =>
    onChange({ ...node, config: { ...node.config, ...patch } });

  const parseJsonField = (raw: string, apply: (value: unknown) => void, label: string) => {
    if (!raw.trim()) {
      apply(undefined);
      return;
    }
    try {
      apply(JSON.parse(raw));
    } catch {
      addToast({ message: `${label}: JSON inválido, no se aplicó el cambio`, type: 'error' });
    }
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-[var(--border-medium)] bg-[var(--bg-base)]">
      <div className="flex items-center justify-between border-b border-[var(--border-medium)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: def.accent }} />
          <div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">{def.label}</div>
            <div className="text-[10px] text-[var(--text-secondary)]">{node.id}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {node.kind !== 'trigger' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(node.id)}
              aria-label="Eliminar nodo"
            >
              <Trash2 size={15} />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Cerrar">
            <X size={15} />
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div>
          <FieldLabel>Nombre</FieldLabel>
          <Input
            value={node.name}
            onChange={(e) => onChange({ ...node, name: e.target.value })}
            placeholder={node.id}
          />
        </div>

        {node.kind === 'trigger' && (
          <div>
            <FieldLabel>Tipo de disparo</FieldLabel>
            <ThemedSelect
              value={String(node.config.trigger_kind ?? 'manual')}
              onChange={(v) => patchConfig({ trigger_kind: v as TriggerKind })}
              options={Object.entries(TRIGGER_KIND_LABELS).map(([value, label]) => ({
                value,
                label: ENABLED_TRIGGER_KINDS.includes(value as TriggerKind)
                  ? label
                  : `${label} (próximamente)`,
              }))}
            />
            {!ENABLED_TRIGGER_KINDS.includes((node.config.trigger_kind ?? 'manual') as TriggerKind) && (
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Este disparo aún no está disponible; el flujo se ejecutará manualmente.
              </p>
            )}
          </div>
        )}

        {node.kind === 'trigger' && node.config.trigger_kind === 'schedule' && (
          <div>
            <FieldLabel>Intervalo (minutos)</FieldLabel>
            <Input
              type="number"
              min={1}
              max={10080}
              value={Number(node.config.interval_minutes ?? 60)}
              onChange={(e) => {
                const value = Math.round(Number(e.target.value));
                if (Number.isFinite(value)) patchConfig({ interval_minutes: value });
              }}
            />
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
              Se ejecuta cada N minutos mientras la app esté abierta y el flujo activo.
            </p>
          </div>
        )}

        {node.kind === 'tool_call' && (
          <>
            <div>
              <FieldLabel>Método</FieldLabel>
              <ThemedSelect
                value={String(node.config.method ?? '')}
                onChange={(v) => patchConfig({ method: v })}
                options={[
                  { value: '', label: 'Selecciona un método…' },
                  ...methods.map((m) => ({ value: m, label: m })),
                ]}
                placeholder="Selecciona un método…"
              />
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Solo métodos marcados como orquestables y de solo lectura.
              </p>
            </div>
            <div>
              <FieldLabel>Argumentos (JSON)</FieldLabel>
              <Textarea
                defaultValue={node.config.args ? JSON.stringify(node.config.args, null, 2) : ''}
                rows={6}
                spellCheck={false}
                className="font-mono text-xs"
                placeholder='{ "id": "=nodes.trigger.json" }'
                onBlur={(e) => parseJsonField(e.target.value, (v) => patchConfig({ args: v }), 'Argumentos')}
              />
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Las cadenas que empiezan por = se evalúan: =item, =items, =nodes.&lt;id&gt;.json, =run.trigger.
              </p>
            </div>
          </>
        )}

        {node.kind === 'condition' && (
          <>
            <div>
              <FieldLabel>Campo a evaluar</FieldLabel>
              <Input
                value={String(node.config.field ?? '')}
                onChange={(e) => patchConfig({ field: e.target.value })}
                placeholder="=nodes.n1.json.total"
                spellCheck={false}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <FieldLabel>Operador</FieldLabel>
              <ThemedSelect
                value={String(node.config.op ?? 'eq')}
                onChange={(v) => patchConfig({ op: v })}
                options={CONDITION_OPS.map((o) => ({ value: o.value, label: o.label }))}
              />
            </div>
            <div>
              <FieldLabel>Valor de comparación</FieldLabel>
              <Input
                value={node.config.value == null ? '' : String(node.config.value)}
                onChange={(e) => {
                  const raw = e.target.value;
                  patchConfig({ value: raw === '' ? undefined : raw });
                }}
                placeholder="10 o =run.trigger.umbral"
                spellCheck={false}
                className="font-mono text-xs"
              />
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Usa = para comparar contra otra expresión.
              </p>
            </div>
          </>
        )}

        {node.kind === 'http_request' && (
          <>
            <div>
              <FieldLabel>URL</FieldLabel>
              <Input
                value={String(node.config.url ?? '')}
                onChange={(e) => patchConfig({ url: e.target.value })}
                placeholder="https://api.ejemplo.com/datos"
                spellCheck={false}
                className="font-mono text-xs"
              />
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Solo http/https; admite expresiones =…
              </p>
            </div>
            <div>
              <FieldLabel>Método</FieldLabel>
              <ThemedSelect
                value={String(node.config.method ?? 'GET')}
                onChange={(v) => patchConfig({ method: v })}
                options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => ({
                  value: m,
                  label: m,
                }))}
              />
            </div>
            <div>
              <FieldLabel>Conexión</FieldLabel>
              <ThemedSelect
                value={String(node.config.connection_ref ?? '')}
                onChange={(v) => patchConfig({ connection_ref: v || undefined })}
                options={[
                  { value: '', label: 'Sin firma OAuth' },
                  ...connections.map((c) => ({
                    value: c.id,
                    label: c.connected ? c.label : `${c.label} (no conectada)`,
                  })),
                ]}
              />
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Si eliges una conexión se añade Authorization: Bearer con su token, refrescado si
                caducó. Gestiona cuentas en la sección Conexiones.
              </p>
            </div>
            <div>
              <FieldLabel>Cabeceras (JSON)</FieldLabel>
              <Textarea
                defaultValue={node.config.headers ? JSON.stringify(node.config.headers, null, 2) : ''}
                rows={4}
                spellCheck={false}
                className="font-mono text-xs"
                placeholder='{ "Accept": "application/json" }'
                onBlur={(e) => parseJsonField(e.target.value, (v) => patchConfig({ headers: v }), 'Cabeceras')}
              />
            </div>
            <div>
              <FieldLabel>Cuerpo (JSON o texto)</FieldLabel>
              <Textarea
                defaultValue={node.config.body != null ? JSON.stringify(node.config.body, null, 2) : ''}
                rows={5}
                spellCheck={false}
                className="font-mono text-xs"
                placeholder='{ "texto": "=nodes.n1.json.title" }'
                onBlur={(e) => parseJsonField(e.target.value, (v) => patchConfig({ body: v }), 'Cuerpo')}
              />
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Objetos/listas se envían como JSON; texto sin envolver va literal. Vacío = sin cuerpo.
              </p>
            </div>
            <div>
              <FieldLabel>Timeout (segundos)</FieldLabel>
              <Input
                type="number"
                min={1}
                max={60}
                value={Number(node.config.timeout_s ?? 20)}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (Number.isFinite(value)) patchConfig({ timeout_s: value });
                }}
              />
            </div>
          </>
        )}

        {node.kind === 'transform' && (
          <div>
            <FieldLabel>Objeto de salida (JSON)</FieldLabel>
            <Textarea
              defaultValue={node.config.output ? JSON.stringify(node.config.output, null, 2) : ''}
              rows={8}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder={'{\n  "nombre": "=item.json.name",\n  "total": 0\n}'}
              onBlur={(e) => parseJsonField(e.target.value, (v) => patchConfig({ output: v }), 'Salida')}
            />
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
              Cada cadena =... se reemplaza por su valor evaluado.
            </p>
          </div>
        )}

        {!def.implemented && node.kind !== 'trigger' && (
          <p className="rounded-md border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-3 text-xs text-[var(--text-secondary)]">
            Este tipo de nodo aún no se puede ejecutar. Quedará omitido en las ejecuciones.
          </p>
        )}
      </div>
    </aside>
  );
}
