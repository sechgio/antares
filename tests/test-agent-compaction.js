'use strict';

const { assert, finish } = require('./helpers/harness');
const { compactMessages, requestBudget } = require('../electron/agent-compaction');

function chars(message) {
  if (typeof message.content === 'string') return message.content.length;
  if (!Array.isArray(message.content)) return 0;
  return message.content.reduce((sum, block) => {
    if (!block) return sum;
    if (block.type === 'image') return sum + 4800;
    return sum + String(block.text || block.name || '').length;
  }, 0);
}

const estimate = (messages) => Math.ceil(messages.reduce((sum, message) => sum + chars(message), 0) / 4);

const system = (text, ts = 0) => ({ role: 'system', content: text, timestamp: ts });
const user = (text, ts = 1) => ({ role: 'user', content: text, timestamp: ts });
const assistant = (text, ts = 2, toolCalls = []) => ({
  role: 'assistant',
  content: [{ type: 'text', text }, ...toolCalls],
  usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: 'stop',
  timestamp: ts,
});
const toolResult = (id, name, text, ts = 3) => ({
  role: 'toolResult',
  toolCallId: id,
  toolName: name,
  content: [{ type: 'text', text }],
  isError: false,
  timestamp: ts,
});
const toolCall = (id, name) => ({ type: 'toolCall', id, name, arguments: {} });

function main() {
  {
    assert(requestBudget(8192, 2048) === 5735, 'una ventana de 8 k reserva sitio para la respuesta y el prompt');
    assert(requestBudget(128000, 8192) > 100000, 'una ventana grande conserva la mayor parte del historial');
    assert(requestBudget(0) === 0 && requestBudget(undefined) === 0, 'sin ventana no se compacta');
  }

  {
    const messages = [system('sys'), user('hola')];
    assert(compactMessages(messages, { budget: 1000, estimate }) === undefined,
      'una petición que cabe en la ventana no se toca');
  }

  {
    const results = [0, 1, 2, 3, 4].map((index) => toolResult(`c${index}`, 'canvas_list', 'x'.repeat(2000), index));
    const messages = [system('sys'), user('consulta'), assistant('llamo', 2, [toolCall('c0', 'canvas_list')]), ...results, assistant('fin', 10)];
    const compacted = compactMessages(messages, { budget: 2000, estimate });
    assert(compacted && compacted.length === messages.length, 'podar resultados no elimina mensajes ni emparejamientos');
    assert(String(compacted[3].content[0].text).startsWith('[Resultado de canvas_list omitido'),
      'los resultados antiguos se sustituyen por una nota con su tamaño');
    assert(compacted[5].content[0].text.length === 2000 && compacted[7].content[0].text.length === 2000,
      'los resultados recientes se conservan completos');
  }

  {
    const messages = [system('sys')];
    for (let index = 0; index < 5; index++) {
      messages.push(user('u'.repeat(4000), index * 2 + 1), assistant('a'.repeat(4000), index * 2 + 2));
    }
    const compacted = compactMessages(messages, { budget: 9000, estimate });
    assert(compacted && compacted.length === messages.length, 'recortar texto conserva la estructura');
    assert(String(compacted[1].content).includes('[recortado para ahorrar contexto]'),
      'los mensajes antiguos se recortan con una marca visible para el modelo');
    assert(chars(compacted[9]) === 4000 && chars(compacted[10]) === 4000,
      'los últimos mensajes quedan intactos');
  }

  {
    const messages = [
      system('sys'),
      user('primer encargo ' + 'p'.repeat(4000), 1),
      assistant('primera respuesta', 2),
      user('segundo encargo', 3),
      assistant('segunda respuesta', 4),
      user('tercer encargo', 5),
      assistant('tercera respuesta', 6),
    ];
    const compacted = compactMessages(messages, { budget: 400, estimate });
    assert(compacted && compacted[0] === messages[0], 'el prompt base se conserva al frente');
    assert(String(compacted[1].content).includes('[Contexto compactado por Antares')
      && String(compacted[1].content).includes('Peticiones del usuario'),
      'los turnos omitidos se resumen de forma estructurada');
    assert(compacted.some((message) => message.role === 'user' && message.content === 'segundo encargo')
      && compacted.some((message) => message.role === 'user' && message.content === 'tercer encargo'),
      'los dos últimos turnos del usuario se conservan verbatim');
    assert(!JSON.stringify(compacted).includes('p'.repeat(200)), 'el texto antiguo ya no viaja en la petición');
  }

  {
    const call = toolCall('c1', 'canvas_list');
    const messages = [
      system('sys'),
      user('primer encargo ' + 'p'.repeat(2000), 1),
      assistant('llamo', 2, [call]),
      toolResult('c1', 'canvas_list', 'resultado', 3),
      user('segundo encargo', 4),
      assistant('respuesta', 5),
      user('tercer encargo', 6),
      assistant('respuesta', 7),
    ];
    const compacted = compactMessages(messages, { budget: 300, estimate });
    assert(compacted && String(compacted[1].content).includes('Herramientas usadas: canvas_list'),
      'el resumen conserva las herramientas usadas en el tramo omitido');
  }

  {
    const messages = [
      system('sys'),
      user('primer encargo', 1),
      assistant('llamo', 2, [toolCall('c1', 'canvas_list')]),
      user('segundo encargo', 3),
      assistant('respuesta', 4),
      user('tercer encargo', 5),
      assistant('respuesta', 6),
    ];
    const compacted = compactMessages(messages, { budget: 50, estimate });
    assert(compacted === undefined || !JSON.stringify(compacted).includes('[Contexto compactado'),
      'no se omite un tramo con una llamada de herramienta sin resultado');
  }

  {
    const messages = [
      system('sys'),
      { role: 'user', content: [{ type: 'text', text: 'captura' }, { type: 'image', data: 'abc', mimeType: 'image/jpeg' }], timestamp: 1 },
      assistant('vista', 2),
      user('siguiente', 3),
      assistant('ok', 4),
      user('siguiente 2', 5),
      assistant('ok', 6),
      user('siguiente 3', 7),
      assistant('ok', 8),
      user([{ type: 'text', text: 'captura reciente' }, { type: 'image', data: 'def', mimeType: 'image/jpeg' }], 9),
    ];
    const compacted = compactMessages(messages, { budget: 1300, estimate });
    assert(compacted && !compacted[1].content.some((block) => block.type === 'image')
      && JSON.stringify(compacted[1]).includes('imagen anterior omitida'),
      'las imágenes antiguas se retiran con una nota para el modelo');
    assert(compacted[9].content.some((block) => block.type === 'image'),
      'la imagen del último turno se conserva');
  }

  {
    const messages = [system('sys'), user('anterior'), user('x'.repeat(8000), 2)];
    const compacted = compactMessages(messages, { budget: 10, estimate });
    assert(compacted === undefined || compacted[compacted.length - 1].content === messages[2].content,
      'el mensaje actual del usuario nunca se recorta para forzar el presupuesto');
  }

  finish();
}

main();
