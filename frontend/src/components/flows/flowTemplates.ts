import type { WorkflowGraph } from './types';

export interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  graph: WorkflowGraph;
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: 'clasicficador-ia',
    name: 'Clasificador con IA',
    description:
      'Manual → consulta datos → el agente IA los clasifica → cada categoría a su transformación.',
    graph: {
      nodes: [
        { id: 'trigger', kind: 'trigger', name: 'Disparador', config: { trigger_kind: 'manual' }, position: { x: 0, y: 0 } },
        {
          id: 'datos',
          kind: 'tool_call',
          name: 'Obtener datos',
          config: { method: 'formats' },
          position: { x: 260, y: 0 },
        },
        {
          id: 'ia',
          kind: 'agent',
          name: 'Clasificar',
          config: {
            provider: '',
            prompt: 'Clasifica el contenido en una palabra (alto, medio, bajo): {{ =nodes.datos.json }}',
          },
          position: { x: 520, y: 0 },
        },
        {
          id: 'sw',
          kind: 'switch',
          name: 'Distribuir',
          config: {
            field: '=nodes.ia.json.text',
            cases: [
              { value: 'alto', port: 'caso_1' },
              { value: 'medio', port: 'caso_2' },
            ],
          },
          position: { x: 780, y: 0 },
        },
        {
          id: 'alto',
          kind: 'transform',
          name: 'Alta',
          config: { output: { prioridad: 'alta', texto: '=nodes.ia.json.text' } },
          position: { x: 1040, y: -110 },
        },
        {
          id: 'bajo',
          kind: 'transform',
          name: 'Resto',
          config: { output: { prioridad: 'normal', texto: '=nodes.ia.json.text' } },
          position: { x: 1040, y: 110 },
        },
      ],
      edges: [
        { from_node: 'trigger', to_node: 'datos', from_port: 'main', to_port: 'main' },
        { from_node: 'datos', to_node: 'ia', from_port: 'main', to_port: 'main' },
        { from_node: 'ia', to_node: 'sw', from_port: 'main', to_port: 'main' },
        { from_node: 'sw', to_node: 'alto', from_port: 'caso_1', to_port: 'main' },
        { from_node: 'sw', to_node: 'bajo', from_port: 'default', to_port: 'main' },
      ],
    },
  },
  {
    id: 'http-programado',
    name: 'Sonda HTTP programada',
    description: 'Programado → llama una API → si responde mal, reintenta y lo registra.',
    graph: {
      nodes: [
        {
          id: 'trigger',
          kind: 'trigger',
          name: 'Disparador',
          config: { trigger_kind: 'schedule', interval_minutes: 60 },
          position: { x: 0, y: 0 },
        },
        {
          id: 'http',
          kind: 'http_request',
          name: 'Sondear API',
          config: {
            url: 'https://api.ejemplo.com/estado',
            method: 'GET',
            retry: { attempts: 3, delay_ms: 1000 },
          },
          position: { x: 260, y: 0 },
        },
        {
          id: 'cond',
          kind: 'condition',
          name: '¿Respondió bien?',
          config: { field: '=nodes.http.json.ok', op: 'eq', value: true },
          position: { x: 520, y: 0 },
        },
        {
          id: 'ok',
          kind: 'transform',
          name: 'Estado correcto',
          config: { output: { estado: 'ok', codigo: '=nodes.http.json.status' } },
          position: { x: 780, y: -100 },
        },
        {
          id: 'bad',
          kind: 'transform',
          name: 'Estado con error',
          config: { output: { estado: 'fallo', codigo: '=nodes.http.json.status' } },
          position: { x: 780, y: 100 },
        },
      ],
      edges: [
        { from_node: 'trigger', to_node: 'http', from_port: 'main', to_port: 'main' },
        { from_node: 'http', to_node: 'cond', from_port: 'main', to_port: 'main' },
        { from_node: 'cond', to_node: 'ok', from_port: 'true', to_port: 'main' },
        { from_node: 'cond', to_node: 'bad', from_port: 'false', to_port: 'main' },
      ],
    },
  },
  {
    id: 'informe-ia',
    name: 'Informe con IA',
    description: 'Manual → reúne formatos → el agente redacta un resumen en texto.',
    graph: {
      nodes: [
        { id: 'trigger', kind: 'trigger', name: 'Disparador', config: { trigger_kind: 'manual' }, position: { x: 0, y: 0 } },
        {
          id: 'datos',
          kind: 'tool_call',
          name: 'Datos',
          config: { method: 'formats' },
          position: { x: 260, y: 0 },
        },
        {
          id: 'ia',
          kind: 'agent',
          name: 'Redactar informe',
          config: {
            provider: '',
            system: 'Eres un redactor técnico conciso. Responde en español.',
            prompt: 'Redacta un breve informe con estos datos: {{ =nodes.datos.json }}',
          },
          position: { x: 520, y: 0 },
        },
      ],
      edges: [
        { from_node: 'trigger', to_node: 'datos', from_port: 'main', to_port: 'main' },
        { from_node: 'datos', to_node: 'ia', from_port: 'main', to_port: 'main' },
      ],
    },
  },
];
