'use strict';

const fs = require('fs');
const path = require('path');
const { strict: assert } = require('assert');

const { finish } = require('./helpers/harness');
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
    evict(path.join(__dirname, '..', 'electron', 'editor-recorder'));
    const { RecordingSessionManager } = require('../electron/editor-recorder');
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-rec-cap-'));
    const manager = new RecordingSessionManager({ directory: dir });
    for (let i = 0; i < 8; i++) manager.create(`sess_${i}`);
    assert.throws(() => manager.create('sess_8'), /demasiadas sesiones de grabación/, 'novena grabación se rechaza');
    for (let i = 0; i < 8; i++) manager.abort(`sess_${i}`);
    manager.create('sess_despues');
  }

  {
    const policy = require('../electron/ipc-file-policy');
    const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc-file-policy.js'), 'utf8');
    for (const ext of ['.py', '.pyw', '.xlsm', '.docm', '.chm', '.pif', '.gadget']) {
      assert.match(source, new RegExp(`'${ext.replace('.', '\\.')}'`), `denylist cubre ${ext}`);
    }
    void policy;
  }

  finish();
}

main().catch((err) => { console.error('[FAIL] destructive IPC gates:', err); process.exit(1); });
