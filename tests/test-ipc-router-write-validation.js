const os = require('os');
const fs = require('fs');
const path = require('path');

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

function loadRouter({ documentsDir, downloadsDir, userDataDir }) {
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      ipcMain: { handle: () => {}, removeHandler: () => {} },
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
    },
  };

  const spawnerPath = require.resolve('../electron/backend-spawner');
  require.cache[spawnerPath] = {
    id: spawnerPath,
    filename: spawnerPath,
    loaded: true,
    exports: {
      getProcess: () => null,
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
      getMainWindow: () => null,
      buildAppMenu: () => ({ popup: () => {} }),
      getIsDev: () => true,
    },
  };

  const routerPath = require.resolve('../electron/ipc-router');
  delete require.cache[routerPath];
  return require(routerPath);
}

async function run() {
  console.log('Testing IPC write-path validation (outputDir)...\n');

  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'antares-write-val-'));
  const docsDir = path.join(tmpRoot, 'docs');
  const dlDir = path.join(tmpRoot, 'downloads');
  const customDir = path.join(tmpRoot, 'custom');
  const arbitraryDir = path.join(tmpRoot, 'elsewhere');
  for (const d of [docsDir, dlDir, customDir, arbitraryDir]) {
    await fs.promises.mkdir(d, { recursive: true });
  }

  const router = loadRouter({ documentsDir: docsDir, downloadsDir: dlDir });
  const { handleDialogCall, _clearAllowedWriteRoots } = require('../electron/dialog-handlers');
  const {
    createFileCapability,
    createStagedSession,
    appendStagedChunk,
    completeStagedSession,
  } = require('../electron/file-capabilities');
  const { clearAllowedReadPaths, registerAllowedReadPath } = require('../electron/path-allowlist');

  try {
    const p1 = router._validateAndResolveWriteParams({ outputDir: path.join(docsDir, 'salidas') }, null);
    assert(p1.outputDir === path.join(docsDir, 'salidas'), 'outputDir bajo Documentos se acepta');

    const p2 = router._validateAndResolveWriteParams({ outputDir: path.join(dlDir, 'x') }, null);
    assert(p2.outputDir === path.join(dlDir, 'x'), 'outputDir bajo Descargas se acepta');

    let threw = false;
    try {
      router._validateAndResolveWriteParams({ outputDir: path.join(arbitraryDir, 'salidas') }, null);
    } catch (e) {
      threw = /no está permitida/.test(e.message);
    }
    assert(threw, 'outputDir sin autorización se rechaza');

    _clearAllowedWriteRoots();
    clearAllowedReadPaths();
    const dialog = {
      async showOpenDialog() {
        return { canceled: false, filePaths: [customDir] };
      },
      async showSaveDialog() {
        return { canceled: true };
      },
    };
    await handleDialogCall('dialog_folder', { pickOnly: true }, dialog, { id: 1 });
    const p4 = router._validateAndResolveWriteParams({ outputDir: path.join(customDir, 'salidas') }, null);
    assert(p4.outputDir === path.join(customDir, 'salidas'), 'outputDir elegido por diálogo se acepta');

    const cap = createFileCapability({ filePath: customDir, mode: 'write', webContentsId: null });
    const p5 = router._validateAndResolveWriteParams({ outputDir: cap.token }, null);
    assert(p5.outputDir === customDir, 'outputDir con token se resuelve a la ruta real');
    assert(p5._write_token === cap.token, 'outputDir con token conserva _write_token');

    const outFile = path.join(customDir, 'reporte.pdf');
    await fs.promises.writeFile(outFile, 'x');
    const cap2 = createFileCapability({ filePath: outFile, mode: 'write', webContentsId: null });
    const p6 = router._validateAndResolveWriteParams({ output_path: cap2.token }, null);
    assert(p6._resolved_output_path === outFile, 'output_path con token sigue resolviéndose a _resolved_output_path');
    assert(p6.output_path === cap2.token, 'output_path con token no muta el campo original');

    const p7 = router._validateAndResolveWriteParams({ zoom: 18, formato: 'vertical' }, null);
    assert(p7.zoom === 18 && p7._resolved_output_path === undefined, 'payload sin salida no se procesa');

    let notTokenError = '';
    try {
      router._validateAndResolveWriteParams(
        { outputDir: path.join(arbitraryDir, 'antares-write-notes') },
        null,
      );
    } catch (e) {
      notTokenError = e.message;
    }
    assert(
      /no está permitida/.test(notTokenError) && !/invalid write token/.test(notTokenError),
      'path con prefijo antares-write sin separador no se confunde con un token',
    );

    const userDataDir = path.join(tmpRoot, 'userData');
    const persistedRoot = path.join(tmpRoot, 'raiz-persistida');
    await fs.promises.mkdir(userDataDir, { recursive: true });
    await fs.promises.mkdir(persistedRoot, { recursive: true });
    await fs.promises.writeFile(
      path.join(userDataDir, 'antares-write-roots.json'),
      JSON.stringify([persistedRoot]),
    );
    const dialogHandlersPath = require.resolve('../electron/dialog-handlers');
    delete require.cache[dialogHandlersPath];
    const router2 = loadRouter({ documentsDir: docsDir, downloadsDir: dlDir, userDataDir });
    const p8 = router2._validateAndResolveWriteParams({ outputDir: path.join(persistedRoot, 'salidas') }, null);
    assert(
      p8.outputDir === path.join(persistedRoot, 'salidas'),
      'outputDir bajo raíz persistida de sesión anterior se acepta',
    );
    let rejectedOutsideRoot = false;
    try {
      router2._validateAndResolveWriteParams({ outputDir: path.join(arbitraryDir, 'otra') }, null);
    } catch (e) {
      rejectedOutsideRoot = /no está permitida/.test(e.message);
    }
    assert(rejectedOutsideRoot, 'ruta fuera de la raíz persistida sigue rechazada');

    const dialog2 = {
      async showOpenDialog() {
        return { canceled: false, filePaths: [path.join(tmpRoot, 'nueva-raiz')] };
      },
      async showSaveDialog() {
        return { canceled: true };
      },
    };
    await fs.promises.mkdir(path.join(tmpRoot, 'nueva-raiz'), { recursive: true });
    delete require.cache[dialogHandlersPath];
    const { handleDialogCall: freshHandleDialogCall } = require(dialogHandlersPath);
    await freshHandleDialogCall('dialog_folder', { pickOnly: true }, dialog2, { id: 1 });
    const persisted = JSON.parse(
      await fs.promises.readFile(path.join(userDataDir, 'antares-write-roots.json'), 'utf8'),
    );
    assert(
      persisted.includes(path.resolve(path.join(tmpRoot, 'nueva-raiz'))),
      'dialog_folder persiste la raíz de escritura en userData',
    );

    const staged = createStagedSession({ name: 'foto.jpg', size: 4, webContentsId: 1 });
    await appendStagedChunk(staged.token, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 1);
    const stagedCap = await completeStagedSession(staged.token, 1);
    const resolvedImages = router2._maybeResolveFileTokens(
      { localImagePaths: { 'antares-local-image:photo': stagedCap.token } },
      { webContents: { id: 1 } },
    );
    assert(
      resolvedImages.localImagePaths['antares-local-image:photo'] === stagedCap.path,
      'localImagePaths staged token se resuelve a ruta real',
    );

    const nestedPayload = {
      files: [stagedCap.token],
      image_paths: { 'foto.jpg': stagedCap.token },
      images: [{ path: stagedCap.token, name: '../display-name.jpg' }],
      images_by_id: {
        informe: [{ path: stagedCap.token, name: '../display-name.jpg' }],
      },
      optimizer_files: [{ filename: '../display-name.jpg', content_b64: 'Li4v' }],
      localImagePaths: {
        'antares-local-image:data': 'data:image/jpeg;base64,../not-a-filesystem-path',
      },
    };
    const nestedPayloadSnapshot = JSON.stringify(nestedPayload);
    const nestedResolved = router2._maybeResolveFileTokens(
      nestedPayload,
      { webContents: { id: 1 } },
    );
    assert(nestedResolved.files[0] === stagedCap.path, 'files[] staged token se resuelve a ruta real');
    assert(nestedResolved.image_paths['foto.jpg'] === stagedCap.path, 'image_paths token se resuelve a ruta real');
    assert(nestedResolved.images[0].path === stagedCap.path, 'images[].path staged token se resuelve a ruta real');
    assert(nestedResolved.images[0].name === '../display-name.jpg', 'nombre en images[] no se interpreta como ruta');
    assert(nestedResolved.images_by_id.informe[0].path === stagedCap.path, 'images_by_id.*.path token se resuelve a ruta real');
    assert(nestedResolved.images_by_id.informe[0].name === '../display-name.jpg', 'nombre de imagen no se interpreta como ruta');
    assert(nestedResolved.optimizer_files[0].filename === '../display-name.jpg', 'filename del optimizador no se interpreta como ruta');
    assert(
      nestedResolved.localImagePaths['antares-local-image:data'] === 'data:image/jpeg;base64,../not-a-filesystem-path',
      'data URI de localImagePaths se conserva aunque contenga traversal textual',
    );
    assert(nestedResolved !== nestedPayload, 'resolver devuelve un payload separado');
    assert(JSON.stringify(nestedPayload) === nestedPayloadSnapshot, 'resolver no muta el payload original');

    let nestedRawRejected = false;
    try {
      router2._maybeResolveFileTokens({ image_paths: { 'foto.jpg': stagedCap.path } }, { webContents: { id: 1 } });
    } catch (e) {
      nestedRawRejected = /raw absolute paths not allowed/.test(e.message);
    }
    assert(nestedRawRejected, 'raw image_paths absolute path is rejected');

    const legacyOutputPath = path.join(customDir, 'catalog-export.xlsx');
    const legacyOutputParams = router2._maybeResolveFileTokens(
      { path: legacyOutputPath },
      null,
      'db_export',
    );
    assert(
      legacyOutputParams.path === legacyOutputPath,
      'legacy db_export path remains a write target',
    );

    const stagedTokens = router2._collectStagedTokens(
      'canvas_export_cmyk_pdf',
      nestedPayload,
    );
    assert(stagedTokens.length === 1 && stagedTokens[0] === stagedCap.token, 'staged tokens are collected from nested read fields');
    await router2._cleanupStagedTokens(stagedTokens, 1);
    assert(!fs.existsSync(stagedCap.path), 'staged token nested se elimina después de la operación');

    const rawInput = path.join(arbitraryDir, 'raw.jpg');
    await fs.promises.writeFile(rawInput, 'raw');
    for (const payload of [
      { files: [rawInput], destino: customDir },
      { localImagePaths: { 'antares-local-image:raw': rawInput } },
      { images: [{ path: rawInput }] },
      { file_token: rawInput },
    ]) {
      let rejectedRaw = false;
      try {
        router2._maybeResolveFileTokens(payload, { webContents: { id: 1 } }, 'process_start');
      } catch (e) {
        rejectedRaw = /raw absolute|file token|capability/i.test(e.message);
      }
      assert(rejectedRaw, 'raw read path nested in payload is rejected');
    }

    const optimizerPayload = router2._maybeResolveFileTokens(
      { files: [{ filename: '../foto.jpg', content_b64: 'AAAA/AAAA' }] },
      { webContents: { id: 1 } },
      'image_optimizer_save_files',
    );
    assert(
      optimizerPayload.files[0].content_b64 === 'AAAA/AAAA',
      'opaque file records are not mistaken for read paths',
    );

    const registeredInput = path.join(arbitraryDir, 'approved.jpg');
    await fs.promises.writeFile(registeredInput, 'approved');
    registerAllowedReadPath(registeredInput);
    const winHandle = { webContents: { id: 1 } };
    const previewParams = router2._maybeResolveFileTokens(
      { files: [registeredInput], mapping: {} },
      winHandle,
      'preview',
    );
    assert(previewParams.files[0] === registeredInput, 'preview keeps a registered raw read path');
    const processParams = router2._maybeResolveFileTokens(
      { files: [registeredInput], mapping_path: registeredInput },
      winHandle,
      'process_start',
    );
    assert(processParams.mapping_path === registeredInput, 'process_start keeps a registered raw mapping path');
    const selladorParams = router2._maybeResolveFileTokens(
      { pdf_path: registeredInput, stamp_path: registeredInput, filename: 'out.pdf' },
      winHandle,
      'sellador_apply',
    );
    assert(
      selladorParams.pdf_path === registeredInput && selladorParams.stamp_path === registeredInput,
      'sellador_apply keeps registered raw pdf/stamp paths',
    );
    const evidenciaParams = router2._maybeResolveFileTokens(
      { image_paths: { img1: registeredInput } },
      winHandle,
      'evidencia_volanteo_render',
    );
    assert(evidenciaParams.image_paths.img1 === registeredInput, 'evidencia keeps registered raw image paths');
    const panelParams = router2._maybeResolveFileTokens(
      { image_paths: { img1: registeredInput } },
      winHandle,
      'panel_aviso_corte_render_pdf',
    );
    assert(panelParams.image_paths.img1 === registeredInput, 'panel export keeps registered raw image paths');
    const cmykParams = router2._maybeResolveFileTokens(
      { localImagePaths: { 'antares-local-image:logo': registeredInput } },
      winHandle,
      'canvas_export_cmyk_pdf',
    );
    assert(
      cmykParams.localImagePaths['antares-local-image:logo'] === registeredInput,
      'canvas export keeps registered raw localImagePaths',
    );

    const informesParams = router2._maybeResolveFileTokens(
      {
        images: [{ path: 'antares-local-image:iv2-0', name: 'foto.jpg' }],
        logo_left: 'data:image/png;base64,AAAA',
      },
      winHandle,
      'informes_v2_render_html',
    );
    assert(
      informesParams.images[0].path === 'antares-local-image:iv2-0'
        && informesParams.logo_left === 'data:image/png;base64,AAAA',
      'informes keeps logical image tokens and data URLs',
    );

    const consolidatedParams = router2._maybeResolveFileTokens(
      { images_by_id: { '3': [{ path: 'antares-local-image:x', name: 'a.jpg' }] } },
      winHandle,
      'informes_v2_render_consolidated_html',
    );
    assert(
      consolidatedParams.images_by_id['3'][0].path === 'antares-local-image:x',
      'consolidated informes keeps logical image tokens',
    );

    const nestedCap = createFileCapability({
      filePath: registeredInput,
      mode: 'read',
      webContentsId: 1,
      name: 'approved.jpg',
    });
    const nestedFilesResolved = router2._maybeResolveFileTokens(
      { files: [nestedCap.token] },
      winHandle,
      'process_start',
    );
    const nestedImagesResolved = router2._maybeResolveFileTokens(
      { image_paths: { img1: nestedCap.token } },
      winHandle,
      'evidencia_volanteo_render',
    );
    const nestedInformeResolved = router2._maybeResolveFileTokens(
      { images: [{ path: nestedCap.token }] },
      winHandle,
      'informes_v2_render_html',
    );
    assert(
      nestedFilesResolved.files[0] === registeredInput
        && nestedImagesResolved.image_paths.img1 === registeredInput
        && nestedInformeResolved.images[0].path === registeredInput,
      'read tokens resolve in nested payload fields',
    );
    const collectedNestedTokens = router2._collectStagedTokens('process_start', {
      files: [nestedCap.token],
      images: [{ path: nestedCap.token }],
      image_paths: { img1: nestedCap.token },
    });
    assert(collectedNestedTokens.includes(nestedCap.token), 'nested read tokens are collected for cleanup');
    const unrelatedTokens = router2._collectStagedTokens('canvas_save', {
      document: { metadata: { source: 'antares-read-unrelated' } },
    });
    assert(unrelatedTokens.length === 0, 'tokens in opaque payloads are not revoked as staged inputs');
    const { revokeCapability } = require('../electron/file-capabilities');
    revokeCapability(nestedCap.token);
  } finally {
    _clearAllowedWriteRoots();
    clearAllowedReadPaths();
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\n[PASS] ${passed} checks, ${failed} failures.`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
