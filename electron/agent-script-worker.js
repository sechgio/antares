'use strict';

const vm = require('node:vm');
const { isMainThread, parentPort, workerData } = require('node:worker_threads');

const SYNC_TIMEOUT_MS = 2_000;
const MAX_RESULT_JSON_CHARS = 500_000;
const PRINT_CHUNK_CHARS = 100_000;
const WORKER_FLAG = 'antaresScriptWorker';

// Bootstrap que se compila dentro del contexto. Recibe los puentes del host,
// pero los devuelve solo a través de funciones creadas por el propio contexto:
// el código del modelo nunca recibe un objeto del host.
function scriptBootstrap(hostCall, hostPrint, hostDone, catalogJson, maxResultChars, printChunkChars) {
  'use strict';
  const pending = new Map();
  const resultLimit = Number(maxResultChars) || 500000;
  const printChunk = Math.max(1, Number(printChunkChars) || 100000);
  let sequence = 0;
  let finished = false;

  const format = (value) => {
    if (typeof value === 'string') return value;
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    try {
      const text = JSON.stringify(value);
      return typeof text === 'string' ? text : String(value);
    } catch {
      try { return String(value); } catch { return '[valor no serializable]'; }
    }
  };

  const print = (...args) => {
    if (finished) return;
    let text = args.map(format).join(' ');
    while (text.length > printChunk) {
      hostPrint(text.slice(0, printChunk));
      text = text.slice(printChunk);
    }
    if (text) hostPrint(text);
  };

  const console = { log: print, info: print, warn: print, error: print, debug: print };

  const tools = {
    list: () => {
      const parsed = JSON.parse(catalogJson);
      return Array.isArray(parsed) ? parsed : [];
    },
    call: (name, args) => new Promise((resolve, reject) => {
      if (finished) {
        reject(new Error('El script ya terminó'));
        return;
      }
      let payload;
      try {
        payload = JSON.stringify(args === undefined ? {} : args);
      } catch {
        reject(new Error('Los argumentos de la herramienta no son serializables'));
        return;
      }
      if (typeof payload !== 'string') {
        reject(new Error('Los argumentos de la herramienta no son serializables'));
        return;
      }
      if (payload.length > 100000) {
        reject(new Error('Los argumentos de la herramienta exceden el límite'));
        return;
      }
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      try {
        hostCall(id, String(name), payload);
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    }),
  };

  const settle = (id, ok, text) => {
    const item = pending.get(id);
    if (!item) return;
    pending.delete(id);
    if (!ok) {
      item.reject(new Error(String(text || 'La herramienta falló')));
      return;
    }
    try {
      item.resolve(JSON.parse(text));
    } catch {
      item.reject(new Error('La herramienta devolvió un resultado no válido'));
    }
  };

  const finish = (value, error) => {
    if (finished) return;
    finished = true;
    let resultJson = 'null';
    let resultTruncated = false;
    try {
      resultJson = JSON.stringify(value === undefined ? null : value);
      if (typeof resultJson !== 'string') resultJson = 'null';
      if (resultJson.length > resultLimit) {
        resultTruncated = true;
        resultJson = JSON.stringify({
          truncated: true,
          total_chars: resultJson.length,
          preview: resultJson.slice(0, resultLimit),
        });
      }
    } catch {
      resultJson = JSON.stringify({ error: 'El resultado no es serializable' });
      resultTruncated = true;
    }
    hostDone(JSON.stringify({
      ok: !error,
      error: error ? String((error && (error.stack || error.message)) || error).slice(0, 4000) : null,
      result_json: resultJson,
      result_truncated: resultTruncated,
    }));
  };

  return { tools, print, console, settle, finish };
}

// Se compila como fuente dentro del vm; pasar la función desde el padre
// expondría sus prototipos y rompería el aislamiento del contexto.
const BOOTSTRAP_SOURCE = `(${scriptBootstrap.toString()})`;

function startWorker(data) {
  const catalogJson = String(data.catalog_json || '[]');
  const syncTimeout = Number(data.sync_timeout_ms) || SYNC_TIMEOUT_MS;
  const maxResultChars = Number(data.max_result_chars) || MAX_RESULT_JSON_CHARS;
  let bridge = null;
  let finished = false;

  const hostCall = (id, name, argsJson) => {
    if (finished) return;
    parentPort.postMessage({ type: 'call', id: Number(id), name: String(name), args_json: String(argsJson) });
  };
  const hostPrint = (text) => {
    if (finished) return;
    parentPort.postMessage({ type: 'print', text: String(text).slice(0, PRINT_CHUNK_CHARS) });
  };
  const hostDone = (payloadJson) => {
    if (finished) return;
    finished = true;
    parentPort.postMessage({ type: 'done', payload_json: String(payloadJson) });
  };

  const context = vm.createContext(Object.create(null), {
    name: 'antares-script',
    codeGeneration: { strings: false, wasm: false },
  });
  bridge = new vm.Script(BOOTSTRAP_SOURCE, { filename: 'antares-script-bootstrap.js' })
    .runInContext(context, { timeout: syncTimeout })(hostCall, hostPrint, hostDone, catalogJson, maxResultChars,
      PRINT_CHUNK_CHARS);
  context.tools = bridge.tools;
  context.print = bridge.print;
  context.console = bridge.console;

  parentPort.on('message', (message) => {
    if (!bridge || !message || message.type !== 'result') return;
    bridge.settle(Number(message.id), message.ok === true, String(message.text || ''));
  });

  const runner = `(async () => {
${String(data.code || '')}
})`;
  let fn;
  try {
    fn = new vm.Script(runner, { filename: 'antares-script-user.js' }).runInContext(context, { timeout: syncTimeout });
  } catch (error) {
    bridge.finish(null, error);
    return;
  }
  try {
    fn().then((result) => bridge.finish(result, null), (error) => bridge.finish(null, error));
  } catch (error) {
    bridge.finish(null, error);
  }
}

if (!isMainThread && workerData && workerData[WORKER_FLAG]) {
  startWorker(workerData);
}

module.exports = { SYNC_TIMEOUT_MS, MAX_RESULT_JSON_CHARS, WORKER_FLAG };
