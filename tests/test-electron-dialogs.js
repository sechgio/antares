// Tests for Electron dialog IPC handling without requiring Electron at import time.
const { handleDialogCall } = require('../electron/dialog-handlers.js');

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

  const folder = await handleDialogCall('dialog_folder', {}, dialog, win);
  assert(folder.result.paths[0] === 'C:/tmp/data.xlsx', 'dialog_folder should return selected folder path');
  assert(calls[1].options.properties.includes('openDirectory'), 'dialog_folder should use openDirectory');

  const save = await handleDialogCall('dialog_save', {}, dialog, win);
  assert(save.result.paths[0] === 'C:/tmp/export.xlsx', 'dialog_save should return saved file path');
  assert(calls[2].options.title === 'Guardar archivo', 'dialog_save should set a save title');

  const ignored = await handleDialogCall('db_records', {}, dialog, win);
  assert(ignored.handled === false, 'non-dialog methods should not be handled');

  class FakeBrowserWindow {
    static instances = [];

    constructor(options) {
      this.options = options;
      this.closed = false;
      this.listeners = {};
      this.webContents = {
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

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
