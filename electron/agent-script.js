'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const {
  SYNC_TIMEOUT_MS, MAX_RESULT_JSON_CHARS, WORKER_FLAG,
} = require('./agent-script-worker');

const SCRIPT_MAX_CHARS = 20_000;
const DEFAULT_MAX_OUTPUT_CHARS = 4_000;
const MAX_OUTPUT_CHARS = 20_000;
const MAX_STORED_CHARS = 1_500_000;
const MAX_TOOL_RESULT_CHARS = 1_000_000;
const MAX_ARGS_CHARS = 100_000;
const MAX_CALLS = 25;
const MAX_CONCURRENT_CALLS = 4;
const SCRIPT_TOOL = 'script_run';
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

// chord es ESM; se carga una sola vez y solo cuando una llamada interna lleva señal.
let chordContext = null;
const loadChordContext = () => (chordContext ||= import('@earendil-works/chord/context'));

// En la app empaquetada el worker se descomprime (asarUnpack); en desarrollo la
// ruta resuelta ya apunta al archivo real.
function workerEntry() {
  return require.resolve('./agent-script-worker')
    .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

// Allowlist explícita: una nativa nueva no entra al sandbox hasta que se
// clasifique aquí. No se deduce del módulo ni de `gated`, porque ambos son
// fail-open cuando alguien añade una herramienta de escritura.
const READ_ONLY_NATIVE_TOOLS = new Set([
  // AutoIMG: consultas y lecturas de Drive/Sheets.
  'autoimg_status', 'autoimg_operation_status', 'autoimg_drive_status',
  'autoimg_sheets_auth_status', 'autoimg_sheets_get_config', 'autoimg_sheets_read_range',
  'autoimg_folders_list', 'autoimg_drive_list_folder', 'autoimg_drive_verify_folder',
  'autoimg_drive_folder_preview', 'autoimg_drive_scan_nis', 'autoimg_arrastre_list',
  'autoimg_logs_list', 'autoimg_rename_dest_config',
  // Espacios: consultas.
  'espacios_list', 'espacios_projects', 'espacios_tasks', 'espacios_task_get',
  'espacios_task_comments', 'espacios_task_activity', 'espacios_members',
  'espacios_my_tasks', 'espacios_my_task_origins',
  // Navegador: contenido de la página, sin navegar ni ceder el control.
  'web_read', 'web_text', 'web_console', 'web_network', 'web_screenshot',
  // Equipo: inventario, sin inyectar entrada.
  'cua_list_windows', 'cua_list_apps', 'cua_screen_size',
  // Conexiones: búsquedas y lecturas; las descargas escriben en borradores.
  'gdrive_search', 'gdrive_get', 'gsheets_metadata', 'gsheets_read',
  'onedrive_search', 'onedrive_get', 'excel_worksheets', 'excel_read_range',
  'gmail_search', 'gmail_get', 'outlook_search', 'outlook_get',
  'github_workflow_runs', 'github_run_get',
  // Descriptores de datos.
  'padron_describe', 'volantes_describe',
]);

function isReadOnlyTool(spec) {
  if (!spec || typeof spec.name !== 'string' || !spec.name) return false;
  if (spec.name === SCRIPT_TOOL) return false;
  if (spec.kind === 'backend' || spec.kind === 'mcp') {
    return spec.gated !== true && spec.replay_safe === true;
  }
  if (spec.kind !== 'native' || spec.gated === true) return false;
  return READ_ONLY_NATIVE_TOOLS.has(spec.name);
}

function jsonText(value) {
  try {
    const text = JSON.stringify(value === undefined ? null : value);
    return typeof text === 'string' ? text : 'null';
  } catch {
    return null;
  }
}

function errorMessage(error, max = 1_000) {
  return String((error && (error.stack || error.message)) || error || 'Error desconocido').slice(0, max);
}

function boundedOutput(text, limit) {
  const value = String(text || '');
  return value.length > limit ? `${value.slice(0, Math.max(0, limit - 1))}…` : value;
}

async function writeResultFile({
  dir, output, outputTotalChars, resultJson, error, timedOut, calls, durationMs, resultTruncated, outputTruncated,
}) {
  const folder = path.resolve(String(dir));
  await fs.promises.mkdir(folder, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `script-${stamp}-${crypto.randomUUID().slice(0, 8)}.json`;
  const target = path.join(folder, filename);
  let result = null;
  if (typeof resultJson === 'string' && resultJson) {
    try { result = JSON.parse(resultJson); } catch { result = resultJson; }
  }
  const payload = {
    kind: 'antares.agent.script',
    version: 1,
    created_at: new Date().toISOString(),
    duration_ms: durationMs,
    calls,
    timed_out: timedOut,
    error: error || null,
    output,
    output_chars: output.length,
    output_total_chars: Number.isFinite(outputTotalChars) ? outputTotalChars : output.length,
    output_truncated: outputTruncated === true,
    result,
    result_truncated: resultTruncated === true,
    file_truncated: false,
  };
  let text = JSON.stringify(payload, null, 2);
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
    payload.file_truncated = true;
    payload.output_truncated = true;
    let limit = output.length;
    while (limit > 0) {
      limit = Math.floor(limit * 0.8);
      payload.output = output.slice(0, limit);
      payload.output_chars = limit;
      text = JSON.stringify(payload, null, 2);
      if (Buffer.byteLength(text, 'utf8') <= MAX_FILE_BYTES) break;
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
      payload.result = { truncated: true, note: 'El resultado excedió el límite del archivo' };
      payload.result_truncated = true;
      text = JSON.stringify(payload, null, 2);
    }
  }
  await fs.promises.writeFile(target, text, { flag: 'wx' });
  return { saved_path: target, filename, file_truncated: payload.file_truncated === true };
}

function toolFailure(parsed) {
  return !!(parsed && typeof parsed === 'object' && (parsed.error !== undefined || parsed.isError === true));
}

function toolResultText(result) {
  const parts = Array.isArray(result.content)
    ? result.content.filter((part) => part && part.type === 'text').map((part) => String(part.text || ''))
    : [String(result.content || '')];
  for (const text of parts) {
    try { return { text, parsed: JSON.parse(text) }; } catch { }
  }
  return { text: parts.join(' ').trim(), parsed: null };
}

// La llamada interna reutiliza el mismo beforeTool/executeTool del agente. El
// id sintético aísla su aprobación y sus contadores de la llamada a script_run.
async function runScriptedTool(toolSpec, args, api, context, options = {}) {
  const { callId, signal, beforeTool, executeTool, abortError } = options;
  if (typeof beforeTool !== 'function' || typeof executeTool !== 'function' || typeof abortError !== 'function') {
    throw new Error('runScriptedTool necesita beforeTool, executeTool y abortError');
  }
  if (!toolSpec || toolSpec.name === SCRIPT_TOOL || !isReadOnlyTool(toolSpec)) {
    throw new Error(`Herramienta no permitida en ${SCRIPT_TOOL}: ${toolSpec ? toolSpec.name : 'desconocida'}`);
  }
  if (signal && signal.aborted) throw abortError();
  const nestedApi = Object.create(api);
  Object.defineProperty(nestedApi, 'callId', { value: callId, enumerable: true });
  const nestedContext = signal ? (await loadChordContext()).withAbortSignal(signal, context) : context;
  const blocked = await beforeTool({ id: callId, name: toolSpec.name, arguments: args }, nestedApi, nestedContext);
  if (blocked && blocked.block) throw new Error(blocked.block);
  if (signal && signal.aborted) throw abortError();
  const result = await executeTool(toolSpec, args, nestedApi, nestedContext);
  const { text, parsed } = toolResultText(result);
  const failed = result.isError || toolFailure(parsed);
  if (failed) {
    const detail = parsed && typeof parsed === 'object'
      ? (parsed.error && typeof parsed.error === 'object' ? parsed.error.message : parsed.error)
        || parsed.message || text
      : text;
    throw new Error(String(detail || 'La herramienta falló').slice(0, 500));
  }
  return parsed !== null ? parsed : text;
}

// El host aporta el catálogo y el ejecutor del agente; este módulo solo decide
// qué lecturas entran al sandbox y cómo se serializa su resultado.
async function dispatchScript(args, sessionId, api, context, host = {}) {
  const { toolSpecs, conversation, profileToolFilter, requireSession, draftsDir, runTool } = host;
  const conv = await conversation(sessionId);
  const enabled = new Set((await conv.agent(context || {})).tools.map((tool) => tool.name));
  const allows = await profileToolFilter(await requireSession(sessionId));
  const tools = [...toolSpecs.values()]
    .filter((tool) => tool.name !== SCRIPT_TOOL && enabled.has(tool.name)
      && (!allows || allows(tool.name)) && isReadOnlyTool(tool))
    .map((tool) => ({
      name: tool.name,
      module: tool.module || null,
      description: String(tool.description || '').slice(0, 160),
    }));
  let sequence = 0;
  const callBase = api.callId || `script-${crypto.randomUUID().slice(0, 8)}`;
  const callTool = (name, callArgs, { signal } = {}) => runTool(
    toolSpecs.get(name), callArgs, api, context,
    { callId: `${callBase}#script-${++sequence}`, signal },
  );
  const result = await runScript({
    dir: draftsDir(sessionId),
    code: (args || {}).script,
    tools,
    callTool,
    signal: context && context.abortSignal,
    maxOutputChars: (args || {}).max_output_chars,
  });
  return { text: JSON.stringify(result) };
}

async function runScript(options = {}) {
  const code = String(options.code || '');
  if (!code.trim()) throw new Error('Indica el script de JavaScript que quieres ejecutar');
  if (code.length > SCRIPT_MAX_CHARS) throw new Error(`El script excede ${SCRIPT_MAX_CHARS} caracteres`);
  if (typeof options.callTool !== 'function') throw new Error('script_run necesita el puente de herramientas');

  const requestedOutput = Number(options.maxOutputChars) || DEFAULT_MAX_OUTPUT_CHARS;
  const maxOutputChars = Math.max(100, Math.min(MAX_OUTPUT_CHARS, Math.floor(requestedOutput)));
  const maxStoredChars = Math.max(maxOutputChars, Math.min(MAX_STORED_CHARS, Math.floor(Number(options.maxStoredChars) || MAX_STORED_CHARS)));
  const maxCalls = Math.max(1, Math.min(MAX_CALLS, Math.floor(Number(options.maxCalls) || MAX_CALLS)));
  const maxConcurrent = Math.max(1, Math.min(MAX_CONCURRENT_CALLS, Math.floor(Number(options.maxConcurrentCalls) || MAX_CONCURRENT_CALLS)));
  const timeoutMs = Math.max(500, Math.min(15 * 60 * 1000, Math.floor(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS)));
  const dir = options.dir;
  if (!dir) throw new Error('script_run necesita el directorio de borradores de la conversación');
  const catalog = (Array.isArray(options.tools) ? options.tools : [])
    .filter((tool) => tool && typeof tool.name === 'string' && tool.name)
    .map((tool) => ({
      name: tool.name,
      module: tool.module || null,
      description: String(tool.description || '').slice(0, 160),
    }));
  const allowed = new Set(catalog.map((tool) => tool.name));
  const catalogJson = JSON.stringify(catalog);
  if (catalogJson.length > MAX_ARGS_CHARS) throw new Error('El catálogo de herramientas del script excede el límite');

  const startedAt = Date.now();
  let worker;
  try {
    // El worker vive aparte para que el sandbox no cargue el orquestador del
    // agente; el flag evita que el hilo hijo ejecute la lógica del padre.
    worker = new Worker(workerEntry(), {
      workerData: {
        [WORKER_FLAG]: true,
        code,
        catalog_json: catalogJson,
        sync_timeout_ms: SYNC_TIMEOUT_MS,
        max_result_chars: MAX_RESULT_JSON_CHARS,
      },
      resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 },
    });
  } catch (error) {
    throw new Error(`No se pudo iniciar el sandbox: ${errorMessage(error)}`);
  }

  return new Promise((resolve) => {
    let settled = false;
    let output = '';
    let outputTotal = 0;
    let outputTruncated = false;
    let resultJson = null;
    let resultTruncated = false;
    let error = null;
    let timedOut = false;
    let calls = 0;
    let active = 0;
    const queue = [];
    const controller = new AbortController();
    const parentSignal = options.signal;
    let timer;

    const respond = (id, ok, text) => {
      if (settled || !worker) return;
      try { worker.postMessage({ type: 'result', id, ok, text }); } catch { }
    };

    const runCall = async (job) => {
      try {
        if (!allowed.has(job.name)) throw new Error(`Herramienta no permitida en script_run: ${job.name}`);
        const value = await options.callTool(job.name, job.args, { signal: controller.signal });
        const text = jsonText(value);
        if (text === null) throw new Error('La herramienta devolvió un resultado no serializable');
        respond(job.id, true, text.length > MAX_TOOL_RESULT_CHARS
          ? JSON.stringify({ truncated: true, total_chars: text.length, preview: text.slice(0, MAX_TOOL_RESULT_CHARS) })
          : text);
      } catch (failure) {
        const message = failure && failure.message ? String(failure.message) : String(failure || 'La herramienta falló');
        respond(job.id, false, message.slice(0, 1_000));
      }
    };

    const pump = () => {
      while (!settled && active < maxConcurrent && queue.length) {
        const job = queue.shift();
        active += 1;
        runCall(job).finally(() => {
          active -= 1;
          pump();
        });
      }
    };

    const finish = async () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener('abort', onAbort);
      controller.abort();
      try { worker.removeAllListeners(); } catch { }
      try { await worker.terminate(); } catch { }
      const durationMs = Date.now() - startedAt;
      let saved = { saved_path: null, filename: null, file_truncated: false, saved_error: null };
      try {
        saved = await writeResultFile({
          dir, output, outputTotalChars: outputTotal, resultJson, error, timedOut, calls, durationMs,
          resultTruncated, outputTruncated,
        });
      } catch (failure) {
        saved.saved_error = errorMessage(failure, 300);
      }
      let result;
      let resultPreview;
      if (typeof resultJson === 'string' && resultJson) {
        if (resultJson.length <= 2_000) {
          try { result = JSON.parse(resultJson); } catch { result = resultJson; }
        } else {
          resultPreview = resultJson.slice(0, 2_000);
        }
      }
      const displayedOutput = boundedOutput(output, maxOutputChars);
      const response = {
        saved_path: saved.saved_path,
        filename: saved.filename,
        file_truncated: saved.file_truncated === true,
        output: displayedOutput,
        output_chars: displayedOutput.length,
        output_total_chars: outputTotal,
        output_truncated: outputTruncated || outputTotal > displayedOutput.length,
        calls,
        duration_ms: durationMs,
        ...(saved.saved_error ? { saved_error: saved.saved_error } : {}),
        ...(timedOut ? { timed_out: true } : {}),
        ...(resultTruncated ? { result_truncated: true } : {}),
        ...(result !== undefined ? { result } : {}),
        ...(resultPreview ? { result_preview: resultPreview, result_in_file: !!saved.saved_path } : {}),
        ...(error ? { error } : {}),
      };
      resolve(response);
    };

    const onAbort = () => {
      if (settled) return;
      error = 'Ejecución cancelada';
      finish().catch(() => {});
    };

    worker.on('message', (message) => {
      if (settled || !message || typeof message !== 'object') return;
      if (message.type === 'print') {
        const text = String(message.text || '');
        if (!text) return;
        outputTotal += text.length;
        const room = maxStoredChars - output.length;
        if (room > 0) {
          output += text.slice(0, room);
          if (text.length > room) outputTruncated = true;
        } else {
          outputTruncated = true;
        }
        return;
      }
      if (message.type === 'call') {
        const id = Number(message.id);
        const name = String(message.name || '');
        if (!Number.isInteger(id)) return;
        if (!name) {
          respond(id, false, 'El nombre de la herramienta no puede estar vacío');
          return;
        }
        calls += 1;
        if (calls > maxCalls) {
          respond(id, false, `El script excedió el límite de ${maxCalls} llamadas a herramientas`);
          return;
        }
        if (String(message.args_json || '').length > MAX_ARGS_CHARS) {
          respond(id, false, 'Los argumentos de la herramienta exceden el límite');
          return;
        }
        let args;
        try { args = JSON.parse(String(message.args_json || '{}')); } catch {
          respond(id, false, 'Los argumentos de la herramienta no son válidos');
          return;
        }
        queue.push({ id, name, args });
        pump();
        return;
      }
      if (message.type === 'done') {
        let payload = null;
        try { payload = JSON.parse(String(message.payload_json || '{}')); } catch { }
        if (!payload || typeof payload !== 'object') {
          error = 'El sandbox devolvió un resultado no válido';
        } else {
          if (payload.error) error = String(payload.error).slice(0, 4_000);
          if (typeof payload.result_json === 'string') resultJson = payload.result_json;
          resultTruncated = payload.result_truncated === true;
        }
        finish().catch(() => {});
      }
    });
    worker.on('error', (failure) => {
      if (settled) return;
      error = errorMessage(failure);
      finish().catch(() => {});
    });
    worker.on('messageerror', () => {
      if (settled) return;
      error = 'El sandbox no pudo leer un mensaje';
      finish().catch(() => {});
    });
    worker.on('exit', (code) => {
      if (settled) return;
      error = `El sandbox terminó sin devolver un resultado (código ${code})`;
      finish().catch(() => {});
    });
    if (parentSignal) {
      if (parentSignal.aborted) {
        onAbort();
        return;
      }
      parentSignal.addEventListener('abort', onAbort, { once: true });
    }
    timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      error = `El script excedió el tiempo máximo de ${Math.round(timeoutMs / 1000)} s`;
      finish().catch(() => {});
    }, timeoutMs);
    if (timer.unref) timer.unref();
  });
}

module.exports = {
  runScript,
  dispatchScript,
  runScriptedTool,
  toolFailure,
  isReadOnlyTool,
  SCRIPT_TOOL,
  SCRIPT_MAX_CHARS,
  MAX_OUTPUT_CHARS,
};
