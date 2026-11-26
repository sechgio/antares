#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT_DIR = path.join(ROOT, 'benchmarks', 'agent-eval');
const ANSWER_MAX_CHARS = 4_000;
const POLL_INTERVAL_MS = 1_000;

const TASKS = [
  {
    id: 'consulta_directa',
    prompt:
      'Sin usar herramientas, resume en tres frases qué tipo de trabajo puedes hacer en Antares y qué límites de seguridad respetas.',
    seedFiles: [],
    expect: ['no_tools'],
  },
  {
    id: 'lectura_espacio',
    prompt: 'Enumera los archivos de tu espacio de trabajo y explica en una frase qué contiene README.md.',
    seedFiles: [
      {
        name: 'README.md',
        content: '# Reporte mensual\n\nEste proyecto concentra las cifras de ventas del mes y se entrega como PDF.',
      },
    ],
  },
  {
    id: 'plan_volante',
    prompt:
      'Prepara con task_plan un plan de tres pasos para generar el volante mensual de ventas y deja el primer paso en progreso.',
    seedFiles: [],
    expect: ['plan'],
  },
  {
    id: 'multistep_verificado',
    prompt:
      'En tu espacio de trabajo hay un README.md: léelo, escribe un archivo resumen.txt con una frase que lo resuma, ' +
      'vuelve a leer resumen.txt para comprobar el contenido y dime en una frase qué escribiste.',
    seedFiles: [
      {
        name: 'README.md',
        content: '# Reporte mensual\n\nLas ventas de abril subieron un 12 % respecto a marzo.',
      },
    ],
    expect: ['plan', 'evidence_done', 'no_repeats'],
  },
  {
    id: 'memoria',
    prompt:
      'Busca en tu memoria qué recuerdos hay guardados del usuario y resume en una frase si hay alguna preferencia durable.',
    seedFiles: [],
  },
  {
    id: 'carga_modulo',
    prompt:
      'Usa tools_load para cargar el módulo de reportes de campo y di en una frase qué herramientas quedaron disponibles.',
    seedFiles: [],
  },
  {
    id: 'memoria_entre_sesiones',
    title: 'memoria entre sesiones',
    prompt:
      'Primera sesión: «Recuerda que prefiero los reportes en formato PDF con resumen ejecutivo». ' +
      'Segunda sesión: «¿Qué formato de reportes prefiero?»',
    seedFiles: [],
    steps: [
      { prompt: 'Recuerda que prefiero los reportes en formato PDF con resumen ejecutivo.' },
      { newSession: true, prompt: '¿Qué formato de reportes prefiero? Responde en una frase.' },
    ],
  },
];

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT_DIR, timeout: 240_000 };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--provider':
        args.provider = argv[++i];
        break;
      case '--model':
        args.model = argv[++i];
        break;
      case '--label':
        args.label = argv[++i];
        break;
      case '--out':
        args.out = argv[++i];
        break;
      case '--tasks':
        args.tasks = String(argv[++i])
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);
        break;
      case '--timeout':
        args.timeout = Number(argv[++i]) * 1000;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
        args.help = true;
        break;
      default:
        throw new Error(`Argumento no reconocido: ${argv[i]} (usa --help)`);
    }
  }
  return args;
}

function usage() {
  return (
    'Uso: node scripts/agent-eval.js --provider openai [--model m] [--label L] [--out DIR] ' +
    `[--tasks id,...] [--timeout SEG] [--dry-run]\nTareas disponibles: ${TASKS.map((task) => task.id).join(', ')}`
  );
}

function gitInfo() {
  const read = (args) => {
    try {
      return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
    } catch {
      return null;
    }
  };
  return { branch: read(['rev-parse', '--abbrev-ref', 'HEAD']), commit: read(['rev-parse', 'HEAD']) };
}

function sanitizeFilename(value) {
  return (
    String(value || 'eval')
      .replace(/[^A-Za-z0-9_.-]+/g, '_')
      .slice(0, 80) || 'eval'
  );
}

function finalAssistant(messages, afterTs) {
  return (
    [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === 'assistant' &&
          !message.partial &&
          !message.notice &&
          !(message.tool_calls || []).length &&
          (message.ts || 0) >= afterTs,
      ) || null
  );
}

function stepsOf(messages) {
  const resultAt = new Map();
  for (const message of messages) {
    if (message.role === 'tool_result' && message.tool_use_id) resultAt.set(message.tool_use_id, message.ts || null);
  }
  const steps = [];
  for (const message of messages) {
    for (const call of message.tool_calls || []) {
      const at = resultAt.get(call.id);
      steps.push({
        name: call.name,
        status: call.status || (at ? 'done' : 'queued'),
        ms: at && message.ts ? Math.max(0, at - message.ts) : null,
      });
    }
  }
  return steps;
}

function stableSignature(call) {
  return call.name + ':' + JSON.stringify(call.params || {});
}

const ASSERTIONS = {
  // El encargo multi-paso produce un plan durable.
  plan(messages) {
    return messages.some((message) => (message.tool_calls || []).some((call) => call.name === 'task_plan'));
  },
  // Los pasos marcados done en el último plan llevan evidencia o evidence_ref.
  evidence_done(messages) {
    const plans = [];
    for (const message of messages) {
      for (const call of message.tool_calls || []) {
        if (call.name === 'task_plan' && call.status === 'done') plans.push(call);
      }
    }
    if (!plans.length) return false;
    const last = plans[plans.length - 1];
    const steps = (last.params && last.params.steps) || [];
    const done = steps.filter((step) => step && step.status === 'done');
    return (
      done.length > 0 &&
      done.every((step) => String(step.evidence || '').trim() || (step.evidence_ref && String(step.evidence_ref.ref || '').trim()))
    );
  },
  // Ninguna llamada idéntica se repite tres veces o más.
  no_repeats(messages) {
    const counts = new Map();
    for (const message of messages) {
      for (const call of message.tool_calls || []) {
        const signature = stableSignature(call);
        counts.set(signature, (counts.get(signature) || 0) + 1);
      }
    }
    return [...counts.values()].every((count) => count < 3);
  },
  // La respuesta no afirma verificación sin ninguna lectura ejecutada.
  no_empty_verify(messages) {
    const answer = finalAssistant(messages, 0);
    if (!answer) return false;
    const claimsVerify = /verific|comprob|confirm/i.test(String(answer.content || ''));
    if (!claimsVerify) return true;
    return messages.some((message) =>
      (message.tool_calls || []).some((call) => call.status === 'done' && call.gated === false),
    );
  },
  // El encargo no usa herramientas (para preguntas directas).
  no_tools(messages) {
    return !messages.some((message) => (message.tool_calls || []).length);
  },
};

function evaluateAssertions(task, messages) {
  return (task.expect || []).map((id) => ({
    id,
    pass: typeof ASSERTIONS[id] === 'function' ? !!ASSERTIONS[id](messages) : false,
  }));
}

function usageOf(rawUsage) {
  if (!rawUsage) return null;
  return {
    input: Number(rawUsage.input) || 0,
    output: Number(rawUsage.output) || 0,
    cached: Number(rawUsage.cached) || 0,
    context: Number(rawUsage.context) || 0,
    cost: Number(rawUsage.cost) || 0,
    compactions: Number(rawUsage.compactions) || 0,
  };
}

function traceOf(task, { startedAt, elapsedMs, messages, usage, lastError, status }) {
  const answer = finalAssistant(messages, startedAt - 2_000);
  const steps = stepsOf(messages);
  const visibleAnswer = (answer && String(answer.content || '').trim()) || '';
  const assertions = evaluateAssertions(task, messages);
  const assertionsPassed = assertions.filter((item) => item.pass).length;
  return {
    id: task.id,
    prompt: task.prompt,
    status,
    success:
      status === 'completed' &&
      !lastError &&
      visibleAnswer.length > 0 &&
      assertions.every((item) => item.pass),
    assertions,
    assertion_score: assertions.length ? assertionsPassed / assertions.length : null,
    error: lastError || null,
    duration_ms: elapsedMs,
    steps,
    step_count: steps.length,
    usage: usageOf(usage),
    answer: visibleAnswer.slice(0, ANSWER_MAX_CHARS),
    started_at: new Date(startedAt).toISOString(),
  };
}

async function denyPendingApprovals(handlers, sessionId) {
  const status = await handlers.agent_turn_status({ session_id: sessionId });
  for (const approval of status.pending_approvals || []) await handlers.agent_deny({ approval_id: approval.id });
  return (status.pending_approvals || []).length;
}

async function sendAndWait(handlers, sessionId, prompt, timeoutMs) {
  await handlers.agent_message_send({ session_id: sessionId, content: prompt });
  const sentAt = Date.now();
  const deadline = sentAt + timeoutMs;
  let status = { running: true, pending_approvals: [], last_error: null };
  let outcome = 'timeout';
  let approvalsDenied = false;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    status = await handlers.agent_turn_status({ session_id: sessionId });
    if ((status.pending_approvals || []).length) {
      await denyPendingApprovals(handlers, sessionId).catch(() => {});
      approvalsDenied = true;
    }
    if (!status.running && !status.compacting) {
      const { messages } = await handlers.agent_messages_list({ session_id: sessionId });
      if (finalAssistant(messages, sentAt - 2_000)) {
        outcome = status.last_error ? 'error' : 'completed';
        break;
      }
    }
  }
  if (outcome === 'timeout' && approvalsDenied) {
    for (let i = 0; i < 10 && status.running; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      status = await handlers.agent_turn_status({ session_id: sessionId });
    }
    outcome = status.running ? 'timeout' : 'approval_denied';
  }
  if (outcome === 'timeout' && status.running) {
    try {
      await handlers.agent_turn_cancel({ session_id: sessionId });
    } catch {}
  }
  try {
    await denyPendingApprovals(handlers, sessionId);
  } catch {}
  const { messages, usage } = await handlers.agent_messages_list({ session_id: sessionId });
  return { messages, usage, status, outcome };
}

async function runTask(handlers, task, { provider, model, workspace, timeoutMs }) {
  const startedAt = Date.now();
  const finish = (messages, usage, lastError, status) =>
    traceOf(task, {
      startedAt,
      elapsedMs: Date.now() - startedAt,
      messages,
      usage,
      lastError: lastError && String(lastError).slice(0, 500),
      status,
    });
  try {
    const steps = task.steps || [{ prompt: task.prompt }];
    let { session } = await handlers.agent_session_create({
      provider,
      model,
      title: task.title || `eval:${task.id}`,
    });
    let sessionId = session.id;
    if (task.seedFiles.length) {
      fs.mkdirSync(workspace, { recursive: true });
      for (const file of task.seedFiles) fs.writeFileSync(path.join(workspace, file.name), file.content);
      await handlers.agent_workspace_set({ session_id: sessionId, path: workspace });
    }
    let result = null;
    for (const step of steps) {
      if (step.newSession) {
        ({ session } = await handlers.agent_session_create({
          provider,
          model,
          title: task.title || `eval:${task.id}`,
        }));
        sessionId = session.id;
      }
      result = await sendAndWait(handlers, sessionId, step.prompt, timeoutMs);
      if (result.outcome !== 'completed') break;
    }
    return finish(result.messages, result.usage, result.status.last_error, result.outcome);
  } catch (error) {
    return finish([], null, error.message, 'error');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const provider = String(args.provider || process.env.ANTARES_AGENT_EVAL_PROVIDER || '');
  if (!provider) {
    throw new Error(
      'Falta el proveedor: pasa --provider <id> o exporta ANTARES_AGENT_EVAL_PROVIDER ' +
        '(se configuran en Conexiones · Proveedores IA).\n' +
        usage(),
    );
  }
  const { startPythonBackend, killPython, waitForReady } = require('../electron/backend-spawner');
  const backend = require('../electron/ipc-router');
  const runtime = require('../electron/agent-runtime');
  const { MemoryStorage } = await import('@earendil-works/pi-durable');

  startPythonBackend(true);
  try {
    if (!(await waitForReady(90_000).catch(() => false))) {
      throw new Error(
        'El backend local no pudo iniciarse; abre Antares una vez o revisa los logs con npm run read:logs.',
      );
    }
    const info = await backend._callBackend('agent_internal_provider', { provider });
    const model = String(args.model || info.default_model || '');
    const git = gitInfo();
    const meta = {
      label: sanitizeFilename(args.label || git.branch),
      provider,
      model,
      ...git,
      node: process.version,
      started_at: new Date().toISOString(),
      timeout_ms: args.timeout,
    };
    const tasks = TASKS.filter((task) => !args.tasks || args.tasks.includes(task.id));
    if (!tasks.length) throw new Error(`Ninguna tarea coincide con --tasks ${args.tasks.join(',')}\n${usage()}`);
    if (args.dryRun) {
      console.log(
        `[agent-eval] dry-run: provider=${provider} model=${model} label=${meta.label} ` +
          `out=${args.out} timeout=${args.timeout}ms tareas=${tasks.length}`,
      );
      for (const task of tasks) console.log(`[agent-eval]   ${task.id}: ${task.prompt}`);
      return;
    }

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-agent-eval-'));
    const workspace = path.join(dataDir, 'espacio');
    fs.mkdirSync(args.out, { recursive: true });
    const results = [];
    try {
      await runtime.open({ storage: new MemoryStorage(), dir: dataDir, skipImport: true });
      for (const task of tasks) {
        console.log(`[agent-eval] tarea ${task.id}…`);
        const trace = await runTask(runtime.handlers, task, { provider, model, workspace, timeoutMs: args.timeout });
        results.push(trace);
        console.log(
          `[agent-eval]   ${trace.success ? 'ok' : 'falló'} (${trace.status}) ` +
            `en ${Math.round(trace.duration_ms / 100) / 10}s, ${trace.step_count} pasos, ` +
            `${trace.usage ? `${trace.usage.input + trace.usage.output} tokens` : 'sin uso'}`,
        );
        for (const item of trace.assertions || []) {
          if (!item.pass) console.log(`[agent-eval]   aserción conductual fallida: ${item.id}`);
        }
      }
    } finally {
      meta.finished_at = new Date().toISOString();
      if (results.length) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const out = path.join(args.out, `${meta.label}-${stamp}.json`);
        fs.writeFileSync(out, `${JSON.stringify({ meta, results }, null, 2)}\n`);
        console.log(`[agent-eval] traza guardada en ${out}`);
      }
      try {
        await runtime.shutdown();
      } catch {}
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
    const failed = results.filter((result) => !result.success);
    if (failed.length) {
      console.error(
        `[agent-eval] ${failed.length}/${results.length} tareas sin éxito: ${failed.map((task) => task.id).join(', ')}`,
      );
      process.exitCode = 1;
    }
  } finally {
    killPython();
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(`[agent-eval] ${error.message}`);
    process.exitCode = 1;
  });
module.exports = { TASKS, parseArgs, finalAssistant, stepsOf, traceOf, usageOf, evaluateAssertions, ASSERTIONS };
