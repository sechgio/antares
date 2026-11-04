'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { TASKS, parseArgs, finalAssistant, stepsOf, traceOf, usageOf } = require('../scripts/agent-eval');

const NOW = 1_000_000;
const assistantMsg = (text, ts, extra = {}) => ({ ...extra, role: 'assistant', content: text, ts });

const cases = {
  'las tareas fijas son autocontenidas y con id único': () => {
    assert(TASKS.length >= 4, 'la evaluación fija necesita un catálogo mínimo de tareas');
    const ids = new Set(TASKS.map((task) => task.id));
    assert.equal(ids.size, TASKS.length, 'ids de tarea duplicados');
    for (const task of TASKS) {
      assert(String(task.prompt).trim().length > 20, `prompt demasiado corto en ${task.id}`);
      assert(Array.isArray(task.seedFiles), `seedFiles faltante en ${task.id}`);
      for (const file of task.seedFiles) {
        assert.equal(typeof file.name, 'string', 'nombre de archivo inválido');
        assert.equal(typeof file.content, 'string', `contenido inválido en ${task.id}/${file.name}`);
      }
    }
  },
  'finalAssistant toma la última respuesta visible posterior al envío': () => {
    const messages = [
      assistantMsg('antigua', NOW - 30_000),
      { role: 'assistant', content: 'partial', partial: true, ts: NOW },
      { role: 'assistant', content: 'aviso', notice: true, ts: NOW },
      assistantMsg('con trabajo', NOW, { tool_calls: [{ id: 'c1', name: 'fs_list', status: 'done' }] }),
      assistantMsg('respuesta final', NOW + 5_000),
    ];
    assert.equal(finalAssistant(messages, NOW - 2_000)?.content, 'respuesta final');
    assert.equal(finalAssistant(messages, NOW + 30_000), null, 'nada posterior al instante pedido');
  },
  'stepsOf empareja llamadas con resultados y numera pasos': () => {
    const messages = [
      { role: 'assistant', content: '', ts: NOW, tool_calls: [
        { id: 'c1', name: 'fs_list', status: 'done' },
        { id: 'c2', name: 'fs_read' },
      ] },
      { role: 'tool_result', tool_use_id: 'c1', content: 'listado', ts: NOW + 1_200 },
    ];
    assert.deepEqual(stepsOf(messages), [
      { name: 'fs_list', status: 'done', ms: 1_200 },
      { name: 'fs_read', status: 'queued', ms: null },
    ]);
  },
  'usageOf normaliza la contabilidad y tolera ausencias': () => {
    assert.equal(usageOf(null), null);
    assert.deepEqual(usageOf({ input: '12', output: 5, cost: '0.5' }), {
      input: 12, output: 5, cached: 0, context: 0, cost: 0.5, compactions: 0,
    });
  },
  'traceOf marca éxito solo cuando el turno completó con respuesta': () => {
    const task = TASKS[0];
    const base = { startedAt: NOW, elapsedMs: 900, usage: null, lastError: null };
    const ok = traceOf(task, { ...base, status: 'completed', messages: [assistantMsg('Listo.', NOW + 1_000)] });
    assert.equal(ok.success, true);
    assert.equal(ok.status, 'completed');
    assert.equal(ok.answer, 'Listo.');
    const empty = traceOf(task, { ...base, status: 'completed', messages: [] });
    assert.equal(empty.success, false, 'una tarea sin respuesta visible no es éxito');
    const errored = traceOf(task, { ...base, status: 'error', messages: [assistantMsg('x', NOW + 1_000)] });
    assert.equal(errored.success, false);
    assert.equal(traceOf(task, { ...base, status: 'timeout', messages: [] }).success, false);
  },
  'traceOf recorta la respuesta a un máximo razonable': () => {
    const trace = traceOf(TASKS[0], {
      startedAt: NOW, elapsedMs: 1, status: 'completed', usage: null, lastError: null,
      messages: [assistantMsg('x'.repeat(5_000), NOW + 1_000)],
    });
    assert(trace.answer.length <= 4_000 && trace.answer.length > 3_500, 'la respuesta de la traza debe acotarse');
  },
  'parseArgs acepta los flags de la CLI y rechaza desconocidos': () => {
    const args = parseArgs(['--provider', 'openai', '--tasks', 'a, b', '--timeout', '5', '--dry-run']);
    assert.equal(args.provider, 'openai');
    assert.deepEqual(args.tasks, ['a', 'b']);
    assert.equal(args.timeout, 5_000);
    assert.equal(args.dryRun, true);
    assert.throws(() => parseArgs(['--no-existe']), /--no-existe/);
  },
  'sin proveedor ni env, la evaluación no arranca ni adivina el proveedor': () => {
    // Era un default mágico a «openai» en silencio; ahora es un error antes de arrancar el backend.
    const { spawnSync } = require('node:child_process');
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'agent-eval.js')], {
      encoding: 'utf8',
      env: { ...process.env, ANTARES_AGENT_EVAL_PROVIDER: '' },
      windowsHide: true,
    });
    assert.notEqual(result.status, 0, 'sin proveedor la evaluación debe fallar');
    assert.match(result.stderr, /Falta el proveedor/);
  },
};

async function main() {
  let failed = false;
  for (const [name, run] of Object.entries(cases)) {
    try { await run(); console.log(`[PASS] ${name}`); }
    catch (error) { failed = true; console.error(`[FAIL] ${name}`, error); }
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
