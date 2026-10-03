import type { FlowNode, FlowNodeKind, TriggerKind } from './types';

export interface NodeKindDef {
  kind: FlowNodeKind;
  label: string;
  description: string;
  accent: string;
  implemented: boolean;
  inputs: string[];
  outputs: { port: string; label: string }[];
}

export interface SwitchCase {
  value: unknown;
  port: string;
}

export function nodeOutputs(flowNode: FlowNode): { port: string; label: string }[] {
  if (flowNode.kind === 'switch') {
    const cases = Array.isArray(flowNode.config.cases) ? (flowNode.config.cases as SwitchCase[]) : [];
    const outs = cases
      .filter((c) => c && typeof c.port === 'string' && c.port)
      .map((c, i) => ({ port: c.port, label: `Caso ${i + 1}` }));
    outs.push({ port: 'default', label: 'Defecto' });
    return outs;
  }
  return NODE_KIND_DEFS[flowNode.kind].outputs;
}

export const NODE_KIND_DEFS: Record<FlowNodeKind, NodeKindDef> = {
  trigger: {
    kind: 'trigger',
    label: 'Disparador',
    description: 'Punto de entrada del flujo',
    accent: 'var(--accent-primary, #6366f1)',
    implemented: true,
    inputs: [],
    outputs: [{ port: 'main', label: 'Salida' }],
  },
  tool_call: {
    kind: 'tool_call',
    label: 'Acción',
    description: 'Ejecuta un método de la app',
    accent: '#38bdf8',
    implemented: true,
    inputs: ['main'],
    outputs: [{ port: 'main', label: 'Resultado' }],
  },
  condition: {
    kind: 'condition',
    label: 'Condición',
    description: 'Ramifica verdadero / falso',
    accent: '#f59e0b',
    implemented: true,
    inputs: ['main'],
    outputs: [
      { port: 'true', label: 'Sí' },
      { port: 'false', label: 'No' },
    ],
  },
  transform: {
    kind: 'transform',
    label: 'Transformar',
    description: 'Construye un objeto con expresiones',
    accent: '#34d399',
    implemented: true,
    inputs: ['main'],
    outputs: [{ port: 'main', label: 'Objeto' }],
  },
  loop: {
    kind: 'loop',
    label: 'Bucle',
    description: 'Próximamente',
    accent: '#a78bfa',
    implemented: false,
    inputs: ['main'],
    outputs: [{ port: 'main', label: 'Cada elemento' }],
  },
  http_request: {
    kind: 'http_request',
    label: 'HTTP',
    description: 'Llamada HTTP; puede firmar con una Conexión OAuth',
    accent: '#fb7185',
    implemented: true,
    inputs: ['main'],
    outputs: [{ port: 'main', label: 'Respuesta' }],
  },
  agent: {
    kind: 'agent',
    label: 'Agente IA',
    description: 'Un turno con un proveedor IA guardado',
    accent: '#e879f9',
    implemented: true,
    inputs: ['main'],
    outputs: [{ port: 'main', label: 'Texto' }],
  },
  switch: {
    kind: 'switch',
    label: 'Distribuir',
    description: 'Enruta por casos según una expresión',
    accent: '#fbbf24',
    implemented: true,
    inputs: ['main'],
    outputs: [{ port: 'default', label: 'Defecto' }],
  },
  code: {
    kind: 'code',
    label: 'Código',
    description: 'Próximamente',
    accent: '#94a3b8',
    implemented: false,
    inputs: ['main'],
    outputs: [{ port: 'main', label: 'Salida' }],
  },
};

export const PALETTE_KINDS: FlowNodeKind[] = [
  'tool_call',
  'condition',
  'switch',
  'transform',
  'loop',
  'http_request',
  'agent',
  'code',
];

export const TRIGGER_KIND_LABELS: Record<TriggerKind, string> = {
  manual: 'Manual',
  schedule: 'Programado',
  app_event: 'Evento de la app',
  webhook: 'Webhook',
};

export const ENABLED_TRIGGER_KINDS: TriggerKind[] = ['manual', 'schedule'];

export const CONDITION_OPS: { value: string; label: string }[] = [
  { value: 'eq', label: 'es igual a' },
  { value: 'neq', label: 'es distinto de' },
  { value: 'gt', label: 'es mayor que' },
  { value: 'gte', label: 'es mayor o igual que' },
  { value: 'lt', label: 'es menor que' },
  { value: 'lte', label: 'es menor o igual que' },
  { value: 'contains', label: 'contiene' },
  { value: 'exists', label: 'existe' },
];
