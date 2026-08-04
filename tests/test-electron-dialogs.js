// Tests for Electron dialog IPC handling without requiring Electron at import time.
const { handleDialogCall, _clearAllowedWriteRoots } = require('../electron/dialog-handlers.js');
const { clearAllowedReadPaths } = require('../electron/path-allowlist.js');

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

  const calls = [];
  const dialog = {
    async showOpenDialog(win, options) {
      calls.push({ kind: 'open', win, options });
      return { canceled: false, filePaths: ['C:/tmp/data.xlsx'] };
    },
    async showSaveDialog(win, options) {
      calls.push({ kind: 'save', win, options });
      return { canceled: false, filePath: 'C:/tmp/export.xlsx' };
    },
  };
  const win = { id: 1 };

  const files = await handleDialogCall('dialog_files', {}, dialog, win);
  assert(files.handled === true, 'dialog_files should be handled by Electron');
  assert(files.result.paths[0] === 'C:/tmp/data.xlsx', 'dialog_files should return selected file path');
  assert(calls[0].options.properties.includes('openFile'), 'dialog_files should use openFile');
  assert(calls[0].options.filters[0].extensions.includes('mp4'), 'dialog_files should accept MP4 videos');
  assert(calls[0].options.filters[0].extensions.includes('mkv'), 'dialog_files should accept MKV videos');

  const save = await handleDialogCall('dialog_save', {}, dialog, win);
  assert(save.result.paths[0] === 'C:/tmp/export.xlsx', 'dialog_save should return saved file path');
  assert(calls[1].options.title === 'Guardar archivo', 'dialog_save should set a save title');

  // dialog_folder: should open a directory picker and recursively return
  // only files with supported extensions.
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

    const canceledFolder = await handleDialogCall('dialog_folder', {}, {
      async showOpenDialog() { return { canceled: true, filePaths: [] }; },
      async showSaveDialog() { return { canceled: true }; },
    }, win);
    assert(canceledFolder.handled === true, 'dialog_folder should handle cancellation');
    assert(canceledFolder.result.paths.length === 0, 'dialog_folder should return empty paths on cancel');

    // dialog_folder with pickOnly: returns the raw folder path without
    // scanning its contents. Used by the optimizer's "save to folder" flow
    // so we don't recursively list files we're about to overwrite anyway.
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
  } finally {
    await folderFs.promises.rm(tempFolderDir, { recursive: true, force: true });
  }

  const ignored = await handleDialogCall('db_records', {}, dialog, win);
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
              // Support both register (callback=fn) and unregister
              // (callback=null) calls. We keep the last non-null callback
              // so tests can still invoke it directly.
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
      this.listeners['did-finish-load']();
    }

    isDestroyed() {
      return this.closed;
    }

    close() {
      this.closed = true;
    }
  }

  const pdf = await handleDialogCall(
    'html_to_pdf',
    {
      html: '<!doctype html><html><head><style>.x{background:url(file:///etc/passwd)}</style></head><body><script>alert(1)</script>PDF</body></html>',
      filename: 'reporte.pdf',
    },
    dialog,
    win,
    { BrowserWindow: FakeBrowserWindow },
  );
  const pdfWindow = FakeBrowserWindow.instances[0];
  assert(pdf.handled === true, 'html_to_pdf should be handled by Electron');
  assert(pdf.result.filename === 'reporte.pdf', 'html_to_pdf should return requested filename');
  assert(pdf.result.pdf_base64 === Buffer.from('%PDF-test').toString('base64'), 'html_to_pdf should return PDF bytes as base64');
  assert(pdfWindow.options.show === false, 'html_to_pdf should render in a hidden window');
  assert(pdfWindow.loadedFile.endsWith('render.html'), 'html_to_pdf should render from a temporary HTML file');
  assert(pdfWindow.printOptions.printBackground === true, 'html_to_pdf should print backgrounds');
  assert(pdfWindow.printOptions.preferCSSPageSize === true, 'html_to_pdf should respect CSS page size');
  assert(pdfWindow.closed === true, 'html_to_pdf should close the hidden window');
  assert(!pdfWindow.loadedHtml.includes('<script'), 'html_to_pdf should strip script tags');
  assert(!pdfWindow.loadedHtml.includes('file:///etc/passwd'), 'html_to_pdf should block local file URLs');

  const fsForImage = require('fs');
  const osForImage = require('os');
  const pathForImage = require('path');
  const imageTempDir = await fsForImage.promises.mkdtemp(pathForImage.join(osForImage.tmpdir(), 'antares-pdf-img-'));
  const realImagePath = pathForImage.join(imageTempDir, 'foto.jpg');
  await fsForImage.promises.writeFile(realImagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await handleDialogCall('register_local_path', { path: realImagePath }, dialog, win);

  const pdfWithLocalImage = await handleDialogCall(
    'html_to_pdf',
    {
      html: '<!doctype html><html><body><img src="antares-local-image:row-1-img-0"><img src="file:///etc/passwd"></body></html>',
      filename: 'local.pdf',
      localImagePaths: { 'antares-local-image:row-1-img-0': realImagePath },
    },
    dialog,
    win,
    { BrowserWindow: FakeBrowserWindow },
  );
  const localImageWindow = FakeBrowserWindow.instances[1];
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

  try {
    await fsForImage.promises.rm(imageTempDir, { recursive: true, force: true });
  } catch { /* ignore */ }

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

  // ─── local_thumbnail (Path A) ─────────────────────────────────────────────
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
    await fs.promises.writeFile(imgPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9])); // minimal JPEG marker pair

    await handleDialogCall('register_local_path', { path: imgPath }, dialog, win);

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
      { path: imgPath, maxEdge: 256 },
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
      badPathHandled = /absolute|invalid path/i.test(err.message);
    }
    assert(badPathHandled, 'local_thumbnail should reject relative path params');

    let unregisteredHandled = false;
    try {
      await handleDialogCall('local_thumbnail', { path: process.platform === 'win32' ? 'C:\\missing-antares.jpg' : '/tmp/missing-antares.jpg' }, dialog, win, {
        nativeImage: fakeNativeImage,
      });
    } catch (err) {
      unregisteredHandled = /not allowed|not a file/i.test(err.message);
    }
    assert(unregisteredHandled, 'local_thumbnail should reject unregistered paths');
  } finally {
    await fs.promises.rm(thumbTempDir, { recursive: true, force: true });
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
