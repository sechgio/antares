const assert = require('assert');
const fs = require('fs');

const { renderHtmlToPdf, _resetPdfRenderPool } = require('../electron/pdf-render');
const {
  appendStagedChunk,
  cleanupAllStaged,
  completeStagedSession,
  createStagedSession,
  resolveCapability,
} = require('../electron/file-capabilities');

class DeferredBrowserWindow {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.closed = false;
    this.listeners = new Map();
    this.printResolvers = [];
    this.webContents = {
      session: options.webPreferences.session,
      once: (event, callback) => this.listeners.set(event, callback),
      removeListener: (event, callback) => {
        if (this.listeners.get(event) === callback) this.listeners.delete(event);
      },
      executeJavaScript: async () => true,
      printToPDF: () => new Promise((resolve) => this.printResolvers.push(resolve)),
    };
    DeferredBrowserWindow.instances.push(this);
  }

  async loadFile(filePath) {
    await fs.promises.readFile(filePath, 'utf8');
    this.listeners.get('did-finish-load')?.();
  }

  async loadURL() {
    this.listeners.get('did-finish-load')?.();
  }

  resolvePrint(buffer) {
    const resolve = this.printResolvers.shift();
    assert(resolve);
    resolve(buffer);
  }

  isDestroyed() {
    return this.closed;
  }

  destroy() {
    this.closed = true;
  }
}

function waitFor(predicate) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt > 5000) return reject(new Error('PDF render did not reach the expected state'));
      setTimeout(check, 10);
    };
    check();
  });
}

async function run() {
  _resetPdfRenderPool();
  DeferredBrowserWindow.instances.length = 0;
  const session = { fromPartition: () => ({ webRequest: { onBeforeRequest: () => {} } }) };
  const electronModules = { BrowserWindow: DeferredBrowserWindow, session };
  const params = (name) => ({
    html: `<html><body>${name}</body></html>`,
    filename: `${name}.pdf`,
    timeoutMs: 10_000,
  });

  try {
    const first = renderHtmlToPdf(params('first'), electronModules);
    const second = renderHtmlToPdf(params('second'), electronModules);
    await waitFor(() => DeferredBrowserWindow.instances.length === 2
      && DeferredBrowserWindow.instances.every((window) => window.printResolvers.length === 1));

    const originalByteLength = Buffer.byteLength;
    Buffer.byteLength = (value, encoding) => value === 'oversized'
      ? 64 * 1024 * 1024 + 1
      : originalByteLength(value, encoding);
    try {
      await assert.rejects(
        renderHtmlToPdf({ ...params('large'), html: 'oversized' }, electronModules),
        /Cola de render PDF ocupada/,
      );
    } finally {
      Buffer.byteLength = originalByteLength;
    }

    const third = renderHtmlToPdf(params('third'), electronModules);
    const fourth = renderHtmlToPdf(params('fourth'), electronModules);
    const staged = createStagedSession({ name: 'queued-image.png', size: 5 });
    await appendStagedChunk(staged.token, Buffer.from('image'), null);
    const capability = await completeStagedSession(staged.token, null);
    const stagedPath = resolveCapability(capability.token, 'read', null).path;
    await assert.rejects(
      renderHtmlToPdf({
        ...params('fifth'),
        localImagePaths: { 'antares-local-image:queue-test': capability.token },
      }, electronModules),
      /Cola de render PDF ocupada/,
    );
    assert.strictEqual(fs.existsSync(stagedPath), false, 'queue rejection cleans staged image files');
    assert.throws(() => resolveCapability(capability.token, 'read', null), /not found|expired/);

    DeferredBrowserWindow.instances[0].resolvePrint(Buffer.from('%PDF-first'));
    DeferredBrowserWindow.instances[1].resolvePrint(Buffer.from('%PDF-second'));
    await waitFor(() => DeferredBrowserWindow.instances.every((window) => window.printResolvers.length === 1));
    DeferredBrowserWindow.instances[0].resolvePrint(Buffer.from('%PDF-third'));
    DeferredBrowserWindow.instances[1].resolvePrint(Buffer.from('%PDF-fourth'));

    const results = await Promise.all([first, second, third, fourth]);
    await Promise.all(results.map((result) => fs.promises.rm(result.saved_path, { force: true })));
  } finally {
    _resetPdfRenderPool();
    await cleanupAllStaged();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
