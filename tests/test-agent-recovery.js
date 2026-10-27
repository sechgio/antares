'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stubModule } = require('./helpers/harness');

// El fixture cuenta con todas sus herramientas habilitadas: cua-driver queda fuera
// para no pasar de las 100 por defecto (tiene sus pruebas en test-agent-cua.js).
stubModule('electron/agent-cua.js', { TOOLS: new Map(), run: async () => ({}), approvalContext: () => ({}), close: () => {} });
const runtime = require('../electron/agent-runtime');
const { conversation, ctx } = require('../electron/agent-shared');

async function until(check) {
  const deadline = Date.now() + 10000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error('La condición no se cumplió a tiempo');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function main() {
  const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
  const { LiveDoc } = await import('@earendil-works/pi-durable');
  const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai');
  async function fixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-agent-recovery-'));
    const faux = fauxProvider();
    const state = { reads: 0, requests: 0, holdRead: false, waiting: false, fail: null };
    const bridge = async (method, params) => {
      if (method === 'agent_internal_tools') {
        if (state.fail === 'tools') { state.fail = null; throw new Error('Catálogo temporalmente no disponible'); }
        return { tools: [{ name: 'canvas_list', kind: 'backend', gated: false, replay_safe: true,
          inputSchema: { type: 'object', properties: { page: { type: 'integer' } } } }] };
      }
      if (method === 'agent_internal_provider') {
        if (state.fail === 'provider') { state.fail = null; throw new Error('Proveedor temporalmente no disponible'); }
        return { provider: 'faux', style: 'openai_chat', base_url: 'http://unused', api_key: 'test' };
      }
      if (method === 'agent_internal_dispatch') {
        state.reads += 1;
        return { result: state.holdRead ? null : state.result ?? JSON.stringify({ page: params.params.page }) };
      }
      if (method === 'agent_internal_dispatch_result') return { result: state.holdRead ? null : '{}' };
      if (method === 'agent_internal_dispatch_cancel') return { cancelled: true };
      if (method === 'agent_internal_approvals_pending') return { approvals: [] };
      if (method === 'agent_internal_mentions') return { modules: [], unknown: [], ambiguous: [] };
      if (method === 'agent_internal_memory_context') return { context: '' };
      if (method === 'agent_internal_artifacts') return { artifacts: [], questions: [], context: {} };
      if (method === 'agent_internal_activity') return { attention: {} };
      throw new Error(`Puente inesperado: ${method}`);
    };
    runtime._internal._providerOverrides.set('faux', faux.provider);
    const open = async () => {
      await runtime.open({ storage: await openNodeSqliteStorage(path.join(dir, 'agent.sqlite')), dir, bridge, skipImport: true });
      await require('../electron/agent-tasks').stop();
    };
    await open();
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    return {
      state, faux, session, open,
      send: (content) => runtime.handlers.agent_message_send({ session_id: session.id, content }),
      idle: async () => (await conversation(session.id)).waitForIdle(ctx()),
      messages: () => runtime.handlers.agent_messages_list({ session_id: session.id }),
      read: (page, invalid = false, parallel = false) => () => {
        state.requests += 1;
        return fauxAssistantMessage([fauxToolCall('canvas_list', { page: invalid ? 'invalid' : page }),
          ...(parallel ? [fauxToolCall('canvas_list', { page: page + 100 })] : [])], { stopReason: 'toolUse' });
      },
      hold: (_context, options) => new Promise((resolve) => {
        state.waiting = true;
        state.release = resolve;
        options.signal.addEventListener('abort', () => resolve(fauxAssistantMessage('Cierre de prueba')), { once: true });
      }),
      close: async () => {
        await runtime.shutdown();
        assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(dir, { recursive: true, force: true });
      },
    };
  }
  const cases = {
    async cancelled_delivery() {
      for (const [action, boundary] of ['cancel', 'delete'].flatMap((action) => ['notice', 'result', 'delivered'].map((boundary) => [action, boundary]))) {
        const f = await fixture();
        const state = runtime._internal.state();
        const original = state.harness.conversation;
        let release;
        let releaseAbort;
        let cancellation;
        let deliveryWaiting = false;
        let abortWaiting = false;
        let returned = 0;
        try {
          const { profile } = await runtime.handlers.agent_profile_save({ name: 'Auditor', instructions: 'Revisa el encargo', tools: null });
          f.faux.setResponses([
            fauxAssistantMessage([fauxToolCall('agent_delegate', { agent: profile.id, task: 'Comprueba los datos' })], { stopReason: 'toolUse' }),
            fauxAssistantMessage('Delegado'),
          ]);
          await f.send('Delega la comprobación');
          await f.idle();
          const parentConversationId = (await conversation(f.session.id)).id;
          const child = (await runtime.handlers.agent_sessions_list()).sessions.find((s) => s.delegation?.parent_session_id === f.session.id);
          state.harness.conversation = async function (...args) {
            const conv = await original.apply(this, args);
            if (args[0] !== parentConversationId) return conv;
            return new Proxy(conv, { get(target, key) {
              if (key === 'abort' && boundary === 'delivered') return async (...args) => {
                const result = await target.abort(...args);
                if (!abortWaiting) {
                  abortWaiting = true;
                  await new Promise((resolve) => { releaseAbort = resolve; });
                }
                return result;
              };
              if (key === 'submit') return async (draft, context) => {
                if (draft.requestId === `delegate:${child.id}:${boundary === 'delivered' ? 'result' : boundary}`) {
                  deliveryWaiting = true;
                  await new Promise((resolve) => { release = resolve; });
                }
                return target.submit(draft, context);
              };
              const value = Reflect.get(target, key);
              return typeof value === 'function' ? value.bind(target) : value;
            } });
          };
          f.faux.setResponses([fauxAssistantMessage('Datos comprobados'), (context, options) => {
            returned += 1;
            if (boundary !== 'notice') return f.hold(context, options);
            return fauxAssistantMessage('Resultado recibido después de detener');
          }]);
          require('../electron/agent-tasks').start();
          await until(() => deliveryWaiting);
          cancellation = action === 'cancel'
            ? runtime.handlers.agent_turn_cancel({ session_id: f.session.id })
            : runtime.handlers.agent_session_delete({ id: f.session.id });
          if (boundary === 'delivered') {
            await until(() => abortWaiting);
            release();
            await until(async () => ['cancelled', 'delivered'].includes((await state.harness.snapshot(state.SessionsDoc, ctx())).sessions[child.id].delegation.status));
            releaseAbort();
          } else {
            await until(async () => (await state.harness.snapshot(state.SessionsDoc, ctx())).sessions[child.id].delegation.status === 'cancelled');
            release();
          }
          await cancellation;
          const live = await state.harness.snapshot(LiveDoc, parentConversationId, ctx());
          assert.equal(live?.run, undefined, `${action}/${boundary}: no queda un turno activo después de detener`);
          if (boundary === 'notice') assert.equal(returned, 0, `${action}: una entrega cancelada no reactiva al padre`);
        } finally {
          release?.();
          releaseAbort?.();
          f.state.release?.(fauxAssistantMessage('Cierre de prueba'));
          await cancellation;
          state.harness.conversation = original;
          await f.close();
        }
      }
    },
    async error_summary() {
      const f = await fixture();
      try {
        f.state.result = JSON.stringify({ truncated: true, total_chars: 10000, preview: 'Error largo', isError: true });
        f.faux.setResponses([f.read(1), (context) => {
          assert.equal(context.messages.find((m) => m.role === 'toolResult').isError, true,
            'el modelo recibe la señal de fallo del resumen del backend');
          return fauxAssistantMessage('La herramienta falló');
        }]);
        await f.send('Consulta Canvas');
        await f.idle();
        const call = (await f.messages()).messages.flatMap((m) => m.tool_calls || []).find((c) => c.name === 'canvas_list');
        assert.equal(call.status, 'failed', 'la proyección de UI mantiene el mismo estado de error');
      } finally { await f.close(); }
    },
    async budget() {
      for (const mode of ['valid', 'invalid', 'parallel']) {
        const f = await fixture();
        try {
          f.faux.setResponses([...Array.from({ length: 50 }, (_, page) => f.read(page, mode === 'invalid', mode === 'parallel')), () => {
            f.state.requests += 1;
            return fauxAssistantMessage('No debe pedirse otra respuesta');
          }]);
          await f.send('Consulta todas las páginas');
          await f.idle();
          assert.equal(f.state.requests, 40, 'el motor se detiene, incluso si las llamadas son inválidas');
          assert.equal(f.state.reads, mode === 'invalid' ? 0 : mode === 'parallel' ? 80 : 40);
          await until(async () => (await f.messages()).messages.some((m) => /punto de continuación/.test(m.content)));
          assert.equal((await f.messages()).resumable, true);
          f.faux.setResponses([f.read(51), fauxAssistantMessage('Completado después de reanudar')]);
          await f.send('Continúa el encargo');
          await f.idle();
          assert.equal((await f.messages()).resumable, false, 'un nuevo run recibe su propio presupuesto');
        } finally { await f.close(); }
      }
    },
    async queued_follow_up() {
      const f = await fixture();
      try {
        f.state.holdRead = true;
        f.faux.setResponses([...Array.from({ length: 40 }, (_, page) => f.read(page)),
          (context) => {
            assert.match(JSON.stringify(context.messages), /Segundo encargo en cola/);
            return fauxAssistantMessage('Segundo encargo completado');
          }]);
        await f.send('Primer encargo largo');
        await until(() => f.state.reads === 1);
        await f.send('Segundo encargo en cola');
        f.state.holdRead = false;
        await until(async () => (await f.messages()).messages.some((m) => m.content === 'Segundo encargo completado'));
        await f.idle();
        assert.equal(f.state.requests, 40, 'el segundo encargo no ejecuta las rondas restantes del primero');
        assert.equal((await f.messages()).resumable, false);
      } finally { await f.close(); }
    },
    async persistent_budget() {
      const f = await fixture();
      try {
        f.faux.setResponses([...Array.from({ length: 15 }, (_, page) => f.read(page)), f.hold]);
        await f.send('Lee las páginas');
        await until(() => f.state.waiting);
        assert.equal(f.state.reads, 15);
        await runtime.shutdown();
        runtime._internal.shared.rounds.clear();
        runtime._internal.shared.turns.clear();
        f.faux.setResponses([...Array.from({ length: 30 }, (_, page) => f.read(page + 15)), fauxAssistantMessage('Fin')]);
        await f.open();
        await f.idle();
        assert.equal(f.state.reads, 40, 'reabrir SQLite conserva las rondas gastadas por el mismo run');
        assert.equal((await f.messages()).resumable, true);
      } finally { await f.close(); }
    },
    async restore_dependencies() {
      for (const dependency of ['tools', 'provider']) {
        const f = await fixture();
        try {
          f.state.holdRead = true;
          f.faux.setResponses([f.read(1)]);
          await f.send('Consulta Canvas');
          await until(() => f.state.reads === 1);
          await runtime.shutdown();
          f.state.holdRead = false;
          f.state.fail = dependency;
          if (dependency === 'provider') runtime._internal._providerOverrides.delete('faux');
          f.faux.setResponses([fauxAssistantMessage('Consulta recuperada')]);
          await assert.rejects(f.open(), /temporalmente no disponible/);
          assert.equal(runtime._internal.state(), null, 'una apertura fallida no deja un motor incompleto utilizable');
          assert.equal(f.state.reads, 1, 'el fallo de restauración no ejecuta tareas');
          runtime._internal._providerOverrides.set('faux', f.faux.provider);
          await f.open();
          await f.idle();
          assert.equal(f.state.reads, 2, 'el reintento todavía puede recuperar la lectura segura');
          const result = (await f.messages()).messages.flatMap((m) => m.tool_calls || []).find((call) => call.name === 'canvas_list');
          assert.equal(result.status, 'done');
          assert.doesNotMatch(result.result, /interrupted|interrumpida/);
        } finally { await f.close(); }
      }
    },
    async recovered_activity() {
      const f = await fixture();
      try {
        f.faux.setResponses([f.hold]);
        await f.send('Espera la respuesta');
        await until(() => f.state.waiting);
        await runtime.shutdown();
        f.state.waiting = false;
        f.faux.setResponses([f.hold]);
        await f.open();
        await until(() => f.state.waiting);
        assert.equal((await runtime.activitySnapshot()).find((s) => s.id === f.session.id).status, 'running',
          'la bandeja detecta el run recuperado antes de abrir la conversación');
        f.state.release(fauxAssistantMessage('Respuesta recuperada'));
        await f.idle();
        await until(async () => (await runtime.activitySnapshot()).find((s) => s.id === f.session.id).status === 'completed');
      } finally { await f.close(); }
    },
  };
  if (process.argv[2]) assert.ok(Object.hasOwn(cases, process.argv[2]), 'caso de prueba desconocido');
  let failed = false;
  for (const [name, run] of Object.entries(cases)) {
    if (process.argv[2] && process.argv[2] !== name) continue;
    try { await run(); console.log(`[PASS] ${name}`); }
    catch (error) { failed = true; console.error(`[FAIL] ${name}`, error); }
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
