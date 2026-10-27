const os = require('os');
const fs = require('fs');
const path = require('path');

const { assert, finish, counters } = require('./helpers/harness');
const { loadIpcRouter } = require('./helpers/ipc-router');
const { clearAllowedReadPaths, registerAllowedReadPath } = require('../electron/path-allowlist');
const { handleDialogCall, _clearAllowedWriteRoots } = require('../electron/dialog-handlers');

function makeRouter(tmpRoot, docsDir) {
  return loadIpcRouter({
    electron: {
      app: {
        isPackaged: true,
        getPath: (name) => {
          if (name === 'documents') return docsDir;
          if (name === 'downloads') return path.join(tmpRoot, 'dl');
          if (name === 'userData') return tmpRoot;
          throw new Error(`unknown path: ${name}`);
        },
      },
    },
  });
}

async function run() {
  console.log('Testing raw-output blocklist on registered read paths...\n');

  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'antares-read-blocklist-'));
  const docsDir = path.join(tmpRoot, 'docs');
  const readDir = path.join(tmpRoot, 'origen');
  const customDir = path.join(tmpRoot, 'custom');
  for (const d of [docsDir, readDir, customDir]) await fs.promises.mkdir(d, { recursive: true });

  const router = makeRouter(tmpRoot, docsDir);

  try {
    _clearAllowedWriteRoots();
    clearAllowedReadPaths();

    const toolExe = path.join(readDir, 'herramienta.exe');
    await fs.promises.writeFile(toolExe, 'x');
    registerAllowedReadPath(toolExe);

    let fileBlocked = '';
    try {
      router._validateAndResolveWriteParams({ outputPath: toolExe }, null);
    } catch (e) {
      fileBlocked = e.message;
    }
    assert(
      /no permitido/.test(fileBlocked),
      'sobrescribir un ejecutable registrado para lectura se rechaza',
    );

    const inform = path.join(readDir, 'informe.xlsx');
    let siblingBlocked = '';
    try {
      router._validateAndResolveWriteParams({ outputPath: inform }, null);
    } catch (e) {
      siblingBlocked = e.message;
    }
    assert(
      /no está permitida/.test(siblingBlocked),
      'registrar un archivo para lectura no habilita escribir sus hermanos',
    );

    registerAllowedReadPath(readDir);
    const accepted = router._validateAndResolveWriteParams({ outputPath: inform }, null);
    assert(
      accepted.outputPath === inform,
      'documento de los que produce Antares bajo directorio registrado se acepta',
    );

    let dirBlocked = '';
    try {
      router._validateAndResolveWriteParams({ outputPath: path.join(readDir, 'setup.bat') }, null);
    } catch (e) {
      dirBlocked = e.message;
    }
    assert(
      /no permitido/.test(dirBlocked),
      'ejecutable bajo directorio registrado para lectura se rechaza',
    );

    const dialog = {
      async showOpenDialog() {
        return { canceled: false, filePaths: [customDir] };
      },
      async showSaveDialog() {
        return { canceled: true };
      },
    };
    await handleDialogCall('dialog_folder', { pickOnly: true }, dialog, { id: 1 });
    const writeRoot = router._validateAndResolveWriteParams(
      { outputPath: path.join(customDir, 'script.js') },
      null,
    );
    assert(
      writeRoot.outputPath === path.join(customDir, 'script.js'),
      'write root concedido por diálogo sigue sin veto de extensiones',
    );
  } finally {
    _clearAllowedWriteRoots();
    clearAllowedReadPaths();
  }

  console.log(`\n${counters.passed} passed, ${counters.failed} failed`);
  finish();
}

run();
