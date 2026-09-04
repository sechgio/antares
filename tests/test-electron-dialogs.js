const fsForDialog = require('fs');
const osForDialog = require('os');
const pathForDialog = require('path');
const {
  handleDialogCall,
  _clearAllowedWriteRoots,
  _resetPdfRenderPool,
  registerFileInputPath,
} = require('../electron/dialog-handlers.js');
const { clearAllowedReadPaths, isAllowedReadPath } = require('../electron/path-allowlist.js');

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

async function run() {
  console.log('Testing dialog handlers...\n');
  clearAllowedReadPaths();
  _clearAllowedWriteRoots();

  const selectedInputDir = pathForDialog.join(osForDialog.tmpdir(), `antares-dialog-input-${process.pid}`);
  const selectedInputPath = pathForDialog.join(selectedInputDir, 'data.xlsx');
  fsForDialog.mkdirSync(selectedInputDir, { recursive: true });
  fsForDialog.writeFileSync(selectedInputPath, 'test input');
  process.on('exit', () => {
    try { fsForDialog.rmSync(selectedInputDir, { recursive: true, force: true }); } catch {}
  });

  const calls = [];
  const dialog = {
    async showOpenDialog(win, options) {
      calls.push({ kind: 'open', win, options });
      return { canceled: false, filePaths: [selectedInputPath] };
    },
    async showSaveDialog(win, options) {
      calls.push({ kind: 'save', win, options });
      return { canceled: false, filePath: 'C:/tmp/export.xlsx' };
    },
  };
  const win = { id: 1 };

  const files = await handleDialogCall('dialog_files', {}, dialog, win);
  assert(files.handled === true, 'dialog_files should be handled by Electron');
  assert(files.result.paths[0] === selectedInputPath, 'dialog_files should return selected file path');
  assert(Array.isArray(files.result.file_tokens), 'dialog_files should return read capability tokens');
  assert(files.result.file_tokens.length === files.result.paths.length, 'dialog_files should return one token per selected path');
  assert(/^antares-read_/.test(files.result.file_tokens[0]), 'dialog_files token should be a read capability');
  assert(calls[0].options.properties.includes('openFile'), 'dialog_files should use openFile');
  assert(calls[0].options.filters[0].extensions.includes('mp4'), 'dialog_files should accept MP4 videos');
  assert(calls[0].options.filters[0].extensions.includes('mkv'), 'dialog_files should accept MKV videos');

  const save = await handleDialogCall('dialog_save', {}, dialog, win);
  assert(save.result.paths[0] === 'C:/tmp/export.xlsx', 'dialog_save should return saved file path');
  assert(calls[1].options.title === 'Guardar archivo', 'dialog_save should set a save title');

  const folderFs = require('fs');
  const folderOs = require('os');
  const folderPath = require('path');
  const tempFolderDir = await folderFs.promises.mkdtemp(folderPath.join(folderOs.tmpdir(), 'antares-folder-test-'));
  try {
    await folderFs.promises.mkdir(folderPath.join(tempFolderDir, 'sub'), { recursive: true });
    await folderFs.promises.writeFile(folderPath.join(tempFolderDir, 'photo.jpg'), 'x');
    await folderFs.promises.writeFile(folderPath.join(tempFolderDir, 'clip.mp4'), 'x');
    await folderFs.promises.writeFile(folderPath.join(tempFolderDir, 'notes.txt'), 'x');
    await folderFs.promises.writeFile(folderPath.join(tempFolderDir, 'sub', 'deep.png'), 'x');

    const folderDialog = {
      async showOpenDialog(win, options) {
        calls.push({ kind: 'folder', win, options });
        assert(options.properties.includes('openDirectory'), 'dialog_folder should use openDirectory');
        return { canceled: false, filePaths: [tempFolderDir] };
      },
      async showSaveDialog() { return { canceled: true }; },
    };

    const folderResult = await handleDialogCall('dialog_folder', {}, folderDialog, win);
    assert(folderResult.handled === true, 'dialog_folder should be handled by Electron');
    assert(folderResult.result.paths.length === 3, 'dialog_folder should return 3 supported files (jpg, mp4, png) and skip txt');
    assert(folderResult.result.paths.some((p) => p.endsWith('photo.jpg')), 'dialog_folder should include top-level jpg');
    assert(folderResult.result.paths.some((p) => p.endsWith('clip.mp4')), 'dialog_folder should include top-level mp4');
    assert(folderResult.result.paths.some((p) => folderPath.basename(p) === 'deep.png'), 'dialog_folder should include nested png from subfolder');
    assert(!folderResult.result.paths.some((p) => p.endsWith('notes.txt')), 'dialog_folder should exclude unsupported txt');
    assert(folderResult.result.file_tokens.length === folderResult.result.paths.length, 'dialog_folder should return one token per scanned file');
    assert(folderResult.result.file_tokens.every((token) => /^antares-read_/.test(token)), 'dialog_folder tokens should be read capabilities');

    const canceledFolder = await handleDialogCall('dialog_folder', {}, {
      async showOpenDialog() { return { canceled: true, filePaths: [] }; },
      async showSaveDialog() { return { canceled: true }; },
    }, win);
    assert(canceledFolder.handled === true, 'dialog_folder should handle cancellation');
    assert(canceledFolder.result.paths.length === 0, 'dialog_folder should return empty paths on cancel');
    assert(canceledFolder.result.file_tokens.length === 0, 'dialog_folder should return no tokens on cancel');

    const pickOnlyDialog = {
      async showOpenDialog(win, options) {
        calls.push({ kind: 'pickOnly', win, options });
        return { canceled: false, filePaths: ['C:/tmp/out'] };
      },
      async showSaveDialog() { return { canceled: true }; },
    };
    const pickOnlyResult = await handleDialogCall('dialog_folder', { pickOnly: true }, pickOnlyDialog, win);
    assert(pickOnlyResult.handled === true, 'dialog_folder with pickOnly should be handled');
    assert(pickOnlyResult.result.paths.length === 0, 'dialog_folder with pickOnly should not scan files');
    assert(pickOnlyResult.result.folder === 'C:/tmp/out', 'dialog_folder with pickOnly should return the raw folder path');
    assert(pickOnlyResult.result.file_tokens.length === 0, 'dialog_folder with pickOnly should return no file tokens');
  } finally {
    await folderFs.promises.rm(tempFolderDir, { recursive: true, force: true });
  }

  const ignored = await handleDialogCall('db_columns', {}, dialog, win);
  assert(ignored.handled === false, 'non-dialog methods should not be handled');

  class FakeBrowserWindow {
    static instances = [];

    constructor(options) {
      this.options = options;
      this.closed = false;
      this.listeners = {};
      this.lastFilter = null;
      this.webContents = {
        session: {
          webRequest: {
            onBeforeRequest: (filter, callback) => {
              this.lastFilter = filter;
              if (callback) {
                this.onBeforeRequest = callback;
              }
            },
          },
        },
        once: (event, callback) => {
          this.listeners[event] = callback;
        },
        printToPDF: async (options) => {
          this.printOptions = options;
          return Buffer.from('%PDF-test');
        },
      };
      FakeBrowserWindow.instances.push(this);
    }

    async loadFile(filePath) {
      this.loadedFile = filePath;
      this.loadedHtml = await require('fs').promises.readFile(filePath, 'utf8');
      if (this.listeners['did-finish-load']) this.listeners['did-finish-load']();
    }

    async loadURL(url) {
      this.loadedUrl = url;
      if (this.listeners['did-finish-load']) this.listeners['did-finish-load']();
    }

    isDestroyed() {
      return this.closed;
    }

    close() {
      this.closed = true;
    }

    destroy() {
      this.closed = true;
    }
  }

  const pdf = await handleDialogCall(
    'html_to_pdf',
    {
      html: '<!doctype html><html><head><style>.x{background:url(file:///etc/passwd)}</style></head><body><script>alert(1)</script>PDF</body></html>',
      filename: 'reporte.pdf',
      return_base64: true,
    },
    dialog,
    win,
    { BrowserWindow: FakeBrowserWindow },
  );
  const pdfWindow = FakeBrowserWindow.instances[0];
  assert(pdf.handled === true, 'html_to_pdf should be handled by Electron');
  assert(pdf.result.filename === 'reporte.pdf', 'html_to_pdf should return requested filename');
  assert(pdf.result.pdf_base64 === Buffer.from('%PDF-test').toString('base64'), 'html_to_pdf should return PDF bytes as base64 when return_base64 is set');
  assert(typeof pdf.result.saved_path === 'string' && pdf.result.saved_path.length > 0, 'html_to_pdf should always persist PDF to disk');
  assert(typeof pdf.result.file_token === 'string' && pdf.result.file_token.startsWith('antares-read'), 'html_to_pdf should return a read file_token');
  assert(pdfWindow.options.show === false, 'html_to_pdf should render in a hidden window');
  assert(pdfWindow.loadedFile.endsWith('render.html'), 'html_to_pdf should render from a temporary HTML file');
  assert(pdfWindow.printOptions.printBackground === true, 'html_to_pdf should print backgrounds');
  assert(pdfWindow.printOptions.preferCSSPageSize === true, 'html_to_pdf should respect CSS page size');
  assert(pdfWindow.closed === false, 'html_to_pdf keeps the pooled hidden window alive for reuse (no spin-up on next render)');
  assert(!pdfWindow.loadedHtml.includes('<script'), 'html_to_pdf should strip script tags');
  assert(!pdfWindow.loadedHtml.includes('file:///etc/passwd'), 'html_to_pdf should block local file URLs');
  assert(pdfWindow.loadedUrl === 'about:blank', 'html_to_pdf unloads DOM to about:blank on pooled window to prevent memory leaks');

  {
    _resetPdfRenderPool();
    FakeBrowserWindow.instances.length = 0;
    const pdfDiskOnly = await handleDialogCall(
      'html_to_pdf',
      {
        html: '<!doctype html><html><body>PDF</body></html>',
        filename: 'auto.pdf',
      },
      dialog,
      win,
      { BrowserWindow: FakeBrowserWindow },
    );
    assert(pdfDiskOnly.handled === true, 'html_to_pdf auto-disk should be handled');
    assert(typeof pdfDiskOnly.result.saved_path === 'string', 'html_to_pdf auto-disk should return saved_path');
    assert(typeof pdfDiskOnly.result.file_token === 'string', 'html_to_pdf auto-disk should return file_token');
    assert(pdfDiskOnly.result.pdf_base64 === undefined, 'html_to_pdf without return_base64 must omit pdf_base64');
    assert(FakeBrowserWindow.instances.length === 1, 'html_to_pdf with a reset pool creates exactly one window');
  }

  const fsForImage = require('fs');
  const osForImage = require('os');
  const pathForImage = require('path');
  const {
    createFileCapability,
    createStagedSession,
    appendStagedChunk,
    completeStagedSession,
    resolveCapability,
  } = require('../electron/file-capabilities');
  const imageTempDir = await fsForImage.promises.mkdtemp(pathForImage.join(osForImage.tmpdir(), 'antares-pdf-img-'));
  const realImagePath = pathForImage.join(imageTempDir, 'foto.jpg');
  await fsForImage.promises.writeFile(realImagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  clearAllowedReadPaths();
  assert(
    registerFileInputPath(realImagePath) === true && isAllowedReadPath(realImagePath),
    'registerFileInputPath grants read access for a File-derived path',
  );
  assert(registerFileInputPath(imageTempDir) === false, 'registerFileInputPath rejects directories');
  assert(registerFileInputPath('') === false, 'registerFileInputPath rejects empty paths');

  let registerDeprecated = false;
  try {
    await handleDialogCall('register_local_path', { path: realImagePath }, dialog, win);
  } catch (err) {
    registerDeprecated = /deprecated|file tokens/i.test(err.message);
  }
  assert(registerDeprecated, 'register_local_path should be rejected as deprecated');

  const imageCap = createFileCapability({
    filePath: realImagePath,
    mode: 'read',
    webContentsId: null,
  });

  _resetPdfRenderPool();
  FakeBrowserWindow.instances.length = 0;
  const pdfWithLocalImage = await handleDialogCall(
    'html_to_pdf',
    {
      html: '<!doctype html><html><body><img src="antares-local-image:row-1-img-0"><img src="file:///etc/passwd"></body></html>',
      filename: 'local.pdf',
      localImagePaths: { 'antares-local-image:row-1-img-0': imageCap.token },
    },
    dialog,
    win,
    { BrowserWindow: FakeBrowserWindow },
  );
  const localImageWindow = FakeBrowserWindow.instances[0];
  const { pathToFileURL } = require('url');
  const expectedFileUrl = pathToFileURL(realImagePath).toString();
  assert(pdfWithLocalImage.handled === true, 'html_to_pdf should accept disk-backed image references');
  assert(!localImageWindow.loadedHtml.includes('antares-local-image:row-1-img-0'), 'html_to_pdf should remove local image tokens before rendering');
  assert(
    localImageWindow.loadedHtml.includes(expectedFileUrl),
    'html_to_pdf should keep allowlisted file:// image URLs after sanitization',
  );
  assert(
    !localImageWindow.loadedHtml.includes('file:///etc/passwd'),
    'html_to_pdf should still strip unregistered file:// URLs',
  );

  let allowedDecision = null;
  localImageWindow.onBeforeRequest({ url: expectedFileUrl }, (decision) => { allowedDecision = decision; });
  assert(allowedDecision.cancel === false, 'html_to_pdf should allow only registered local image files');

  let blockedDecision = null;
  localImageWindow.onBeforeRequest({ url: 'file:///etc/passwd' }, decision => { blockedDecision = decision; });
  assert(blockedDecision.cancel === true, 'html_to_pdf should block unregistered local file URLs');

  const stagedImage = createStagedSession({ name: 'staged.jpg', size: 4, webContentsId: null });
  await appendStagedChunk(stagedImage.token, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), null);
  const stagedImageCap = await completeStagedSession(stagedImage.token, null);
  const stagedImagePath = stagedImageCap.path;
  await handleDialogCall(
    'html_to_pdf',
    {
      html: '<!doctype html><html><body><img src="antares-local-image:staged"></body></html>',
      filename: 'staged.pdf',
      localImagePaths: { 'antares-local-image:staged': stagedImageCap.token },
    },
    dialog,
    win,
    { BrowserWindow: FakeBrowserWindow },
  );
  assert(!fsForImage.existsSync(stagedImagePath), 'html_to_pdf cleans staged image files after rendering');
  let stagedRevoked = false;
  try {
    resolveCapability(stagedImageCap.token, 'read', null);
  } catch {
    stagedRevoked = true;
  }
  assert(stagedRevoked, 'html_to_pdf revokes staged image capabilities after rendering');

  try {
    await fsForImage.promises.rm(imageTempDir, { recursive: true, force: true });
  } catch {}

  class DeferredBrowserWindow {
    static instances = [];

    constructor(options) {
      this.options = options;
      this.closed = false;
      this.listeners = {};
      this.webContents = {
        session: {
          webRequest: { onBeforeRequest: () => {} },
        },
        once: (event, callback) => { this.listeners[event] = callback; },
        printToPDF: () => new Promise((resolve) => { this.resolvePrint = resolve; }),
      };
      DeferredBrowserWindow.instances.push(this);
    }

    async loadFile() {
      if (this.listeners['did-finish-load']) this.listeners['did-finish-load']();
    }

    async loadURL(url) {
      this.loadedUrl = url;
      if (this.listeners['did-finish-load']) this.listeners['did-finish-load']();
    }

    isDestroyed() {
      return this.closed;
    }

    close() {
      this.closed = true;
    }

    destroy() {
      this.closed = true;
    }
  }

  _resetPdfRenderPool();
  const firstQueuedPdf = handleDialogCall(
    'html_to_pdf',
    { html: '<!doctype html><html><body>first</body></html>', filename: 'first.pdf' },
    dialog,
    win,
    { BrowserWindow: DeferredBrowserWindow },
  );
  await new Promise(resolve => setTimeout(resolve, 100));
  assert(DeferredBrowserWindow.instances.length === 1, 'first queued PDF render should create one window (slot 0)');
  assert(typeof DeferredBrowserWindow.instances[0].resolvePrint === 'function', 'first queued PDF render should reach printToPDF');

  const secondQueuedPdf = handleDialogCall(
    'html_to_pdf',
    { html: '<!doctype html><html><body>second</body></html>', filename: 'second.pdf' },
    dialog,
    win,
    { BrowserWindow: DeferredBrowserWindow },
  );
  await new Promise(resolve => setTimeout(resolve, 100));
  assert(DeferredBrowserWindow.instances.length === 2, 'second PDF render should run concurrently in its own pool slot');
  assert(typeof DeferredBrowserWindow.instances[1].resolvePrint === 'function', 'second queued PDF render should reach printToPDF in parallel');

  DeferredBrowserWindow.instances[0].resolvePrint(Buffer.from('%PDF-first'));
  DeferredBrowserWindow.instances[1].resolvePrint(Buffer.from('%PDF-second'));
  await firstQueuedPdf;
  await secondQueuedPdf;

  const thirdQueuedPdf = handleDialogCall(
    'html_to_pdf',
    { html: '<!doctype html><html><body>third</body></html>', filename: 'third.pdf' },
    dialog,
    win,
    { BrowserWindow: DeferredBrowserWindow },
  );
  await new Promise(resolve => setTimeout(resolve, 100));
  assert(DeferredBrowserWindow.instances.length === 2, 'third PDF render should reuse the pooled window (no new BrowserWindow)');
  assert(typeof DeferredBrowserWindow.instances[0].resolvePrint === 'function', 'third queued PDF render should reach printToPDF on the reused window');
  DeferredBrowserWindow.instances[0].resolvePrint(Buffer.from('%PDF-third'));
  await thirdQueuedPdf;

  {
    class HungBrowserWindow {
      static instances = [];

      constructor(options) {
        this.options = options;
        this.closed = false;
        this.destroyed = false;
        this.listeners = {};
        this.webContents = {
          session: { webRequest: { onBeforeRequest: () => {} } },
          once: (event, callback) => { this.listeners[event] = callback; },
          printToPDF: async () => Buffer.from('%PDF-never'),
        };
        HungBrowserWindow.instances.push(this);
      }

      async loadFile() {
      }

      isDestroyed() {
        return this.destroyed;
      }

      close() {
        this.destroyed = true;
      }

      destroy() {
        this.destroyed = true;
      }
    }

    let hungRejected = false;
    _resetPdfRenderPool();
    FakeBrowserWindow.instances.length = 0;
    try {
      await handleDialogCall(
        'html_to_pdf',
        { html: '<!doctype html><html><body>colgado</body></html>', filename: 'hung.pdf', timeoutMs: 80 },
        dialog,
        win,
        { BrowserWindow: HungBrowserWindow },
      );
    } catch (e) {
      hungRejected = /Tiempo agotado/.test(e.message);
    }
    assert(hungRejected, 'render colgado en load debe abortar por timeout');
    assert(
      HungBrowserWindow.instances[0] && HungBrowserWindow.instances[0].destroyed === true,
      'la ventana colgada debe destruirse al agotar el tiempo (destroy, no close)',
    );

    const afterHung = await handleDialogCall(
      'html_to_pdf',
      { html: '<!doctype html><html><body>after</body></html>', filename: 'after.pdf' },
      dialog,
      win,
      { BrowserWindow: FakeBrowserWindow },
    );
    assert(
      afterHung.handled === true && typeof afterHung.result.saved_path === 'string',
      'el render posterior a un timeout debe completar',
    );

    const recreated = await handleDialogCall(
      'html_to_pdf',
      { html: '<!doctype html><html><body>recreate</body></html>', filename: 'recreate.pdf' },
      dialog,
      win,
      { BrowserWindow: FakeBrowserWindow },
    );
    assert(
      recreated.handled === true && typeof recreated.result.saved_path === 'string',
      'el slot destruido debe recrear su ventana en el siguiente render',
    );
    assert(
      FakeBrowserWindow.instances.length === 2,
      'el slot destruido debe crear una ventana nueva (recreación tras destroy)',
    );
  }

  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'antares-dialog-test-'));
  try {
    const outputPath = path.join(tempDir, 'salida.pdf');
    await handleDialogCall(
      'dialog_save',
      {},
      {
        async showOpenDialog() { return { canceled: true }; },
        async showSaveDialog() {
          return { canceled: false, filePath: outputPath };
        },
      },
      win,
    );

    const pdfToDisk = await handleDialogCall(
      'html_to_pdf',
      {
        html: '<!doctype html><html><body>PDF directo</body></html>',
        filename: 'ignored.pdf',
        outputPath,
      },
      dialog,
      win,
      { BrowserWindow: FakeBrowserWindow },
    );

    assert(pdfToDisk.handled === true, 'html_to_pdf should handle direct-to-disk export');
    assert(pdfToDisk.result.saved_path === outputPath, 'html_to_pdf should return the saved PDF path');
    assert(pdfToDisk.result.pdf_base64 === undefined, 'html_to_pdf should skip base64 when saving to disk');
    assert((await fs.promises.readFile(outputPath, 'utf8')) === '%PDF-test', 'html_to_pdf should write PDF bytes to disk');

    const outsidePdfDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'antares-pdf-outside-'));
    const symlinkPdfDir = path.join(tempDir, 'pdf-escape');
    let symlinkCreated = false;
    try {
      await fs.promises.symlink(outsidePdfDir, symlinkPdfDir, 'junction');
      symlinkCreated = true;
    } catch {
      assert(true, 'PDF symlink escape test skipped when junctions are unavailable');
    }
    if (symlinkCreated) {
      let rejectedSymlinkPdf = false;
      try {
        await handleDialogCall(
          'html_to_pdf',
          {
            html: '<!doctype html><html><body>symlink escape</body></html>',
            filename: 'escape.pdf',
            outputPath: path.join(symlinkPdfDir, 'escape.pdf'),
          },
          dialog,
          win,
          { BrowserWindow: FakeBrowserWindow },
        );
      } catch (err) {
        rejectedSymlinkPdf = /no está permitida|symlink|ruta de salida/i.test(err.message);
      }
      assert(rejectedSymlinkPdf, 'html_to_pdf should reject a PDF path through an escaping junction');
      assert(
        !(await fs.promises.access(path.join(outsidePdfDir, 'escape.pdf')).then(() => true).catch(() => false)),
        'html_to_pdf should not write through an escaping junction',
      );
    }
    await fs.promises.rm(outsidePdfDir, { recursive: true, force: true });

    let rejectedDisallowedPdf = false;
    try {
      await handleDialogCall(
        'html_to_pdf',
        {
          html: '<!doctype html><html><body>nope</body></html>',
          filename: 'bad.pdf',
          outputPath: path.join(os.tmpdir(), 'antares-disallowed', 'bad.pdf'),
        },
        dialog,
        win,
        { BrowserWindow: FakeBrowserWindow },
      );
    } catch (err) {
      rejectedDisallowedPdf = /no está permitida|not allowed/i.test(err.message);
    }
    assert(rejectedDisallowedPdf, 'html_to_pdf should reject PDF output outside allowed directories');
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }

  console.log('\nTesting local_thumbnail path validation and nativeImage path...\n');
  const { assertSafeLocalPath } = require('../electron/local-thumbnail.js');

  let rejectedRelative = false;
  try {
    assertSafeLocalPath('relative/photo.jpg');
  } catch (err) {
    rejectedRelative = /absolute|invalid path/i.test(err.message);
  }
  assert(rejectedRelative, 'assertSafeLocalPath should reject relative paths');

  let rejectedEmpty = false;
  try {
    assertSafeLocalPath('   ');
  } catch (err) {
    rejectedEmpty = /invalid path/i.test(err.message);
  }
  assert(rejectedEmpty, 'assertSafeLocalPath should reject empty paths');

  let rejectedNullByte = false;
  try {
    assertSafeLocalPath((process.platform === 'win32' ? 'C:\\tmp\\a\0.jpg' : '/tmp/a\0.jpg'));
  } catch (err) {
    rejectedNullByte = /invalid path/i.test(err.message);
  }
  assert(rejectedNullByte, 'assertSafeLocalPath should reject null-byte paths');

  let rejectedMissing = false;
  try {
    assertSafeLocalPath(process.platform === 'win32' ? 'C:\\definitely-missing-antares-thumb-xyz.jpg' : '/tmp/definitely-missing-antares-thumb-xyz.jpg');
  } catch (err) {
    rejectedMissing = /not a file/i.test(err.message);
  }
  assert(rejectedMissing, 'assertSafeLocalPath should reject non-existent files');

  const thumbTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'antares-thumb-test-'));
  try {
    const imgPath = path.join(thumbTempDir, 'tiny.jpg');
    await fs.promises.writeFile(imgPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const { createFileCapability } = require('../electron/file-capabilities');
    const thumbCap = createFileCapability({
      filePath: imgPath,
      mode: 'read',
      webContentsId: null,
    });

    const fakeNativeImage = {
      createThumbnailFromPath: async () => {
        throw new Error('createThumbnailFromPath unavailable in test');
      },
      createFromPath: (p) => {
        assert(p === path.resolve(imgPath), 'createFromPath should receive resolved absolute path');
        return {
          isEmpty: () => false,
          getSize: () => ({ width: 800, height: 600 }),
          resize: ({ width, height }) => ({
            isEmpty: () => false,
            getSize: () => ({ width, height }),
            toJPEG: (q) => {
              assert(q === 60, 'toJPEG quality should be 60');
              return Buffer.from('fake-jpeg');
            },
          }),
          toJPEG: () => Buffer.from('fake-jpeg-full'),
        };
      },
    };

    const thumb = await handleDialogCall(
      'local_thumbnail',
      { file_token: thumbCap.token, maxEdge: 256 },
      dialog,
      win,
      { nativeImage: fakeNativeImage },
    );
    assert(thumb.handled === true, 'local_thumbnail should be handled by Electron');
    assert(
      thumb.result.dataUrl === `data:image/jpeg;base64,${Buffer.from('fake-jpeg').toString('base64')}`,
      'local_thumbnail should return a JPEG data URL',
    );

    let badPathHandled = false;
    try {
      await handleDialogCall('local_thumbnail', { path: '../etc/passwd' }, dialog, win, {
        nativeImage: fakeNativeImage,
      });
    } catch (err) {
      badPathHandled = /absolute|invalid path|raw absolute|file token/i.test(err.message);
    }
    assert(badPathHandled, 'local_thumbnail should reject relative path params');

    let unregisteredHandled = false;
    try {
      await handleDialogCall('local_thumbnail', { path: process.platform === 'win32' ? 'C:\\missing-antares.jpg' : '/tmp/missing-antares.jpg' }, dialog, win, {
        nativeImage: fakeNativeImage,
      });
    } catch (err) {
      unregisteredHandled = /not allowed|not a file|capability|file token|raw absolute/i.test(err.message);
    }
    assert(unregisteredHandled, 'local_thumbnail should reject unregistered paths');

    const fullJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x01, 0x02]);
    await fs.promises.writeFile(imgPath, fullJpeg);
    const fullCap = createFileCapability({
      filePath: imgPath,
      mode: 'read',
      webContentsId: null,
    });
    const full = await handleDialogCall(
      'local_image_data_url',
      { file_token: fullCap.token },
      dialog,
      win,
    );
    assert(full.handled === true, 'local_image_data_url should be handled by Electron');
    assert(
      full.result.dataUrl === `data:image/jpeg;base64,${fullJpeg.toString('base64')}`,
      'local_image_data_url should return unmodified JPEG bytes as data URL',
    );

    let badFullPath = false;
    try {
      await handleDialogCall('local_image_data_url', { path: '../etc/passwd' }, dialog, win);
    } catch (err) {
      badFullPath = /absolute|invalid path|raw absolute|file token/i.test(err.message);
    }
    assert(badFullPath, 'local_image_data_url should reject relative paths');
  } finally {
    await fs.promises.rm(thumbTempDir, { recursive: true, force: true });
  }

  {
    const osB4 = require('os');
    const pathB4 = require('path');
    const { createFileCapability, resolveCapability } = require('../electron/file-capabilities.js');
    const tmpDir = await fs.promises.mkdtemp(pathB4.join(osB4.tmpdir(), 'antares-b4-'));
    try {
      const smallPath = pathB4.join(tmpDir, 'small.json');
      await fs.promises.writeFile(smallPath, JSON.stringify({ ok: true }), 'utf8');
      const smallCap = createFileCapability({ filePath: smallPath, mode: 'read' });
      const smallRes = await handleDialogCall('file_token_read_json', { token: smallCap.token }, dialog, win);
      assert(smallRes.handled === true, 'file_token_read_json maneja tokens válidos');
      assert(smallRes.result.ok === true, 'file_token_read_json parsea el JSON pequeño');

      const bigPath = pathB4.join(tmpDir, 'big.json');
      const fh = await fs.promises.open(bigPath, 'w');
      await fh.truncate(64 * 1024 * 1024 + 1024);
      await fh.close();
      const bigCap = createFileCapability({ filePath: bigPath, mode: 'read' });

      const realReadFile = fs.promises.readFile;
      let bigReadAttempted = false;
      fs.promises.readFile = async (p, ...rest) => {
        if (String(p) === bigPath) bigReadAttempted = true;
        return realReadFile(p, ...rest);
      };

      let rejected = false;
      try {
        await handleDialogCall('file_token_read_json', { token: bigCap.token }, dialog, win);
      } catch (err) {
        rejected = /demasiado grande/i.test(err.message);
      } finally {
        fs.promises.readFile = realReadFile;
      }
      assert(rejected, 'un spill > 64 MB debe ser rechazado');
      assert(!bigReadAttempted, 'el archivo grande no debe leerse a memoria (stat primero)');

      let revokedOk = false;
      try {
        resolveCapability(bigCap.token, 'read', null);
      } catch {
        revokedOk = true;
      }
      assert(revokedOk, 'el token debe revocarse incluso al rechazar por tamaño');
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
