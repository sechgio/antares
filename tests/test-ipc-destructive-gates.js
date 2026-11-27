'use strict';

const fs = require('fs');
const path = require('path');
const { strict: assert } = require('assert');

const { finish, stubModule, evictModule } = require('./helpers/harness');
const { loadIpcRouter } = require('./helpers/ipc-router');

function evict(name) {
  const resolved = require.resolve(name);
  delete require.cache[resolved];
}

async function main() {
  console.log('Testing destructive IPC gates...\n');

  {
    const dialogs = [];
    const router = loadIpcRouter({
      electron: {
        dialog: { showMessageBox: async (win, opts) => { dialogs.push(opts); return { response: 1 }; } },
      },
      windowManager: { getMainWindow: () => ({ destroyed: false }) },
      ready: true,
    });
    const confirmations = [];
    try {
      try {
        await router._callBackend('db_clear', {});
        assert.fail('la cancelación debe cortar db_clear');
      } catch (err) {
        assert(String(err && err.message || err).includes('cancelado'), 'cancelación surface: ' + err);
      }
      assert.strictEqual(dialogs.length, 1, 'el diálogo se mostró una vez');
      assert.strictEqual(dialogs[0].buttons[0], 'Borrar todo');

      let sawCancelAgain = false;
      try {
        await router._callBackend('db_clear', {});
      } catch (err) {
        sawCancelAgain = true;
        assert(String(err && err.message || err).includes('rapidez'), 'rate limit inmediato: ' + err);
      }
      assert(sawCancelAgain, 'el segundo intento inmediato topa con el límite de ritmo');
      assert.strictEqual(dialogs.length, 1, 'el límite de ritmo no reabre el diálogo');

      dialogs.length = 0;
      try {
        await router._callBackend('documents_list', {});
      } catch (err) {
        assert(!String(err && err.message || err).includes('cancelado'));
      }
      assert.strictEqual(dialogs.length, 0, 'el diálogo es exclusivo de db_clear');
    } finally {
      void router;
    }
    void confirmations;
  }

  {
    evict(path.join(__dirname, '..', 'electron', 'file-capabilities'));
    const caps = require('../electron/file-capabilities');
    let created = 0;
    for (let i = 0; i < 4; i++) {
      const s = caps.createStagedSession({ name: 'a.pdf', webContentsId: 7 });
      created += 1;
      void s;
    }
    assert.throws(
      () => caps.createStagedSession({ name: 'a.pdf', webContentsId: 7 }),
      /limit reached for this window/,
      'quinta sesión de la misma ventana se rechaza',
    );
    for (let i = 0; i < 8; i++) {
      caps.createStagedSession({ name: 'b.pdf', webContentsId: 8 + i });
      created += 1;
    }
    assert.strictEqual(created, 12, 'doce sesiones en total');
    assert.throws(
      () => caps.createStagedSession({ name: 'c.pdf', webContentsId: 99 }),
      /staged session limit reached/,
      'la decimotercera sesión se rechaza por techo global',
    );

    const sourceText = fs.readFileSync(path.join(__dirname, '..', 'electron', 'file-capabilities.js'), 'utf8');
    assert.match(sourceText, /stagedBytes \+ buf\.length > MAX_STAGED_TOTAL_BYTES/, 'presupuesto global en append');
    assert.match(sourceText, /now - v\.createdAt >= MAX_STAGED_AGE_MS/, 'edad absoluta en el barrido');
    assert.match(sourceText, /_now\(\) - session\.createdAt >= MAX_STAGED_AGE_MS/, 'edad absoluta en append');
  }

  {
    evict(path.join(__dirname, '..', 'electron', 'file-capabilities'));
    const caps = require('../electron/file-capabilities');
    assert.doesNotThrow(() => caps._assertNoRawAbsolutePaths({ path: 'C:\\aceptable\\bajo\\clave.pdf' },
      { allowRawAbsolutePathKeys: new Set(['path']) }));
    assert.doesNotThrow(() => caps._assertNoRawAbsolutePaths({ path: 'carpeta/plano.txt' }), 'relativa plana permitida');
    assert.throws(
      () => caps._assertNoRawAbsolutePaths({ path: 'C:escaped.txt' }, { allowRawAbsolutePathKeys: new Set() }),
      /drive-relative/,
      'C:escapado.txt se rechaza',
    );
    assert.throws(
      () => caps._assertNoRawAbsolutePaths({ path: 'C:escaped.txt' }, { allowRawAbsolutePathKeys: new Set(['path']) }),
      /drive-relative/,
      'C:escapado.txt se rechaza aun cuando la clave admite absolutas crudas',
    );
  }

  {
    const policy = require('../electron/ipc-file-policy');
    const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc-file-policy.js'), 'utf8');
    for (const ext of ['.py', '.pyw', '.xlsm', '.docm', '.chm', '.pif', '.gadget']) {
      assert.match(source, new RegExp(`'${ext.replace('.', '\\.')}'`), `denylist cubre ${ext}`);
    }
    void policy;
  }

  {
    const dialogs = [];
    const router = loadIpcRouter({
      electron: {
        dialog: { showMessageBox: async (win, opts) => { dialogs.push(opts); return { response: 1 }; } },
      },
      windowManager: { getMainWindow: () => ({ destroyed: false }) },
      ready: true,
    });
    const params = {
      name: 'Local',
      transport: 'stdio',
      command: 'powershell.exe',
      args: ['-NoProfile', '-Command', 'Write-Output x'],
    };
    await assert.rejects(
      () => router._callBackend('mcp_server_add', params),
      /cancelado/,
      'cancelar la confirmación nativa bloquea el registro MCP stdio',
    );
    assert.strictEqual(dialogs.length, 1, 'mcp_server_add stdio pide confirmación nativa');
    assert.match(dialogs[0].detail, /powershell\.exe -NoProfile -Command Write-Output x/, 'el diálogo muestra el comando completo');
    dialogs.length = 0;
    await assert.rejects(
      () => router._callBackend('mcp_server_add', { ...params, transport: 'http', url: 'https://example.com/mcp' }),
      /Backend process not available/,
      'un servidor MCP http no usa el gate de ejecución nativa',
    );
    assert.strictEqual(dialogs.length, 0, 'http no abre confirmación de proceso nativo');
  }

  {
    const calls = [];
    const dialogs = [];
    const loadAgentHandlers = (dialogResponse) => {
      calls.length = 0;
      dialogs.length = 0;
      stubModule('electron', {
        dialog: { showMessageBox: async (win, opts) => { dialogs.push(opts); return { response: dialogResponse }; } },
      });
      stubModule('electron/window-manager', { getMainWindow: () => ({}) });
      stubModule('electron/agent-runtime', {
        open: async () => {},
        handlers: {
          agent_sessions_list: async () => ({ sessions: [{ id: 's1', permission_mode: 'ask' }] }),
          agent_session_permissions_set: async (params) => { calls.push(['permissions', params]); return { ok: true }; },
          agent_policy_rules_set: async (params) => { calls.push(['policy', params]); return { ok: true }; },
        },
      });
      evictModule('electron/agent-handlers');
      return require('../electron/agent-handlers');
    };

    let handlers = loadAgentHandlers(1);
    await handlers.handleAgentCall('agent_session_permissions_set', { id: 's1', permission_mode: 'full' });
    await handlers.handleAgentCall('agent_session_permissions_set', { id: 's1', permission_mode: 'ask' });
    assert.deepStrictEqual(calls, [
      ['permissions', { id: 's1', permission_mode: 'full' }],
      ['permissions', { id: 's1', permission_mode: 'ask' }],
    ]);
    assert.strictEqual(dialogs.length, 0, 'seleccionar Acceso completo y volver a Solicitar aprobación no abre diálogos');

    handlers = loadAgentHandlers(1);
    await assert.rejects(
      () => handlers.handleAgentCall('agent_session_permissions_set', { id: 's1', permission_mode: 'auto' }),
      /cancelada/,
      'cancelar la confirmación nativa bloquea elevar la sesión a Aprobar por mí',
    );
    assert.strictEqual(calls.length, 0, 'la elevación cancelada no llega al runtime');
    assert.strictEqual(dialogs.length, 1, 'elevar a auto pide confirmación nativa');
    assert.strictEqual(dialogs[0].noLink, true, 'el diálogo usa botones estándar, no enlaces de comando');
    assert.match(dialogs[0].message, /«Aprobar por mí»/, 'el diálogo nombra el modo con su etiqueta visible');
    assert.match(dialogs[0].detail, /Modo actual: Solicitar aprobación/, 'el diálogo muestra el modo actual legible');

    handlers = loadAgentHandlers(0);
    await handlers.handleAgentCall('agent_session_permissions_set', { id: 's1', permission_mode: 'auto' });
    assert.strictEqual(calls.length, 1, 'aceptar la confirmación nativa permite elevar la sesión');

    handlers = loadAgentHandlers(1);
    await handlers.handleAgentCall('agent_policy_rules_set', { rules: { files: 'deny' } });
    assert.strictEqual(calls.length, 1, 'una rebaja de permisos no necesita confirmación');
    assert.strictEqual(dialogs.length, 0, 'una regla deny no abre diálogo');

    handlers = loadAgentHandlers(1);
    await assert.rejects(
      () => handlers.handleAgentCall('agent_policy_rules_set', { scoped_rules: [{ scope: 'path', value: 'C:\\Docs', decision: 'allow' }] }),
      /cancelada/,
      'una regla allow persistente también exige confirmación nativa',
    );
    assert.strictEqual(calls.length, 0, 'la regla allow cancelada no llega al runtime');
    assert.match(dialogs[0].detail, /C:\\Docs/, 'el diálogo muestra el alcance permitido');
  }

  finish();
}

main().catch((err) => { console.error('[FAIL] destructive IPC gates:', err); process.exit(1); });
