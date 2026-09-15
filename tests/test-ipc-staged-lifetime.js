const os = require('os');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function loadRouterWithHandler({ documentsDir, downloadsDir, userDataDir, fakeProc, fakeWin }) {
  const handlers = new Map();
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      ipcMain: {
        handle: (channel, fn) => handlers.set(channel, fn),
        removeHandler: () => {},
      },
      dialog: {},
      app: {
        isPackaged: true,
        getPath: (name) => {
          if (name === 'documents') return documentsDir;
          if (name === 'downloads') return downloadsDir;
          if (name === 'userData') return userDataDir;
          throw new Error(`unknown path: ${name}`);
        },
      },
      BrowserWindow: class {},
      session: {},
      nativeImage: {},
    },
  };

  const spawnerPath = require.resolve('../electron/backend-spawner');
  require.cache[spawnerPath] = {
    id: spawnerPath,
    filename: spawnerPath,
    loaded: true,
    exports: {
      getProcess: () => fakeProc,
      isReady: () => true,
      waitForReady: async () => true,
      getState: () => 'ready',
      getLastError: () => null,
      getStderrTail: () => '',
      manualRestart: async () => true,
      incrementPendingRequests: () => {},
      decrementPendingRequests: () => {},
      noteJobActivity: () => {},
      clearJobActivity: () => {},
      STATE: { READY: 'ready', FATAL: 'fatal', STARTING: 'starting', EXITED: 'exited' },
    },
  };

  const wmPath = require.resolve('../electron/window-manager');
  require.cache[wmPath] = {
    id: wmPath,
    filename: wmPath,
    loaded: true,
    exports: {
      getMainWindow: () => fakeWin,
      buildAppMenu: () => ({ popup: () => {} }),
      getIsDev: () => true,
    },
  };

  const routerPath = require.resolve('../electron/ipc-router');
  delete require.cache[routerPath];
  const router = require(routerPath);
  router.registerIpcHandlers();
  return { router, handlers };
}

function makeFakeProc(respond) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stdin = new EventEmitter();
  proc.killed = false;
  proc.stdin.write = (line) => {
    const request = JSON.parse(line);
    setImmediate(() => {
      proc.stdout.emit('data', `${JSON.stringify(respond(request))}\n`);
    });
    return true;
  };
  return proc;
}

async function main() {
  console.log('Testing staged token lifetime across ipc-call...\n');

  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'antares-staged-life-'));
  const docsDir = path.join(tmpRoot, 'docs');
  const dlDir = path.join(tmpRoot, 'downloads');
  const userDataDir = path.join(tmpRoot, 'userData');
  const outDir = path.join(docsDir, 'salidas');
  for (const d of [docsDir, dlDir, userDataDir, outDir]) {
    await fs.promises.mkdir(d, { recursive: true });
  }

  const fakeWin = { isDestroyed: () => false, webContents: { id: 1, send: () => {} } };
  const fakeProc = makeFakeProc((request) => ({
    jsonrpc: '2.0',
    id: request.id,
    result: request.method === 'process_start'
      ? { started: true, job_id: 'job-1' }
      : { page_count: 3, filename: 'doc.pdf' },
  }));

  const { handlers } = loadRouterWithHandler({
    documentsDir: docsDir,
    downloadsDir: dlDir,
    userDataDir,
    fakeProc,
    fakeWin,
  });

  const {
    createStagedSession,
    appendStagedChunk,
    completeStagedSession,
    resolveCapability,
    cleanupAllStaged,
  } = require('../electron/file-capabilities');
  const { handleDialogCall } = require('../electron/dialog-handlers');

  const frame = { url: 'http://localhost:5173/', parent: null };
  const event = { senderFrame: frame, sender: { id: 1, mainFrame: frame } };
  const ipcCall = handlers.get('ipc-call');

  try {
    assert(typeof ipcCall === 'function', 'ipc-call handler registrado');

    const staged = createStagedSession({ name: 'sellado.pdf', size: 4, webContentsId: 1 });
    await appendStagedChunk(staged.token, Buffer.from('%PDF'), 1);
    const cap = await completeStagedSession(staged.token, 1);

    const inspect = await ipcCall(event, 'sellador_inspect_pdf', { pdf_path: cap.token });
    assert(inspect.page_count === 3, 'sellador_inspect_pdf resuelve con token staged');

    assert(
      fs.existsSync(cap.path),
      'el archivo staged sobrevive al finalizar la primera llamada IPC',
    );
    const resolved = resolveCapability(cap.token, 'read', 1);
    assert(resolved.path === cap.path, 'la capability staged sigue vigente tras la primera llamada');

    const render = await ipcCall(event, 'sellador_render_page', { pdf_path: cap.token, page: 2 });
    assert(render.page_count === 3, 'sellador_render_page reutiliza el mismo token staged');
    assert(fs.existsSync(cap.path), 'el archivo staged sigue existiendo para llamadas posteriores');

    const stagedInput = createStagedSession({ name: 'entrada.jpg', size: 4, webContentsId: 1 });
    await appendStagedChunk(stagedInput.token, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 1);
    const inputCap = await completeStagedSession(stagedInput.token, 1);
    const started = await ipcCall(event, 'process_start', {
      files: [inputCap.token],
      destino: outDir,
    });
    assert(started.started === true, 'process_start acepta entrada staged');
    assert(
      fs.existsSync(inputCap.path),
      'los inputs staged de process_start sobreviven mientras el trabajo corre en segundo plano',
    );

    const cleaned = await handleDialogCall(
      'file_token_cleanup',
      { token: cap.token },
      {},
      fakeWin,
      {},
    );
    assert(cleaned.result.cleaned === true, 'file_token_cleanup libera la capability explícitamente');
    assert(!fs.existsSync(cap.path), 'la liberación explícita elimina el archivo temporal');

    await cleanupAllStaged();
  } finally {
    await cleanupAllStaged().catch(() => {});
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
    const stagedRoot = path.join(os.tmpdir(), `antares-staged-${process.pid}`);
    await fs.promises.rm(stagedRoot, { recursive: true, force: true }).catch(() => {});
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
