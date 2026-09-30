const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');

const { renderHtmlToPdf, _resetPdfRenderPool } = require('../electron/pdf-render');

class EventEmitterBrowserWindow {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.destroyed = false;
    this.webContents = Object.assign(new EventEmitter(), {
      session: { webRequest: { onBeforeRequest: () => {} } },
      executeJavaScript: async () => true,
      printToPDF: async () => Buffer.from('%PDF-test'),
    });
    EventEmitterBrowserWindow.instances.push(this);
  }

  async loadFile() {
    this.webContents.emit('did-finish-load');
  }

  async loadURL() {
    this.webContents.emit('did-finish-load');
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
  }
}

class FailingBrowserWindow extends EventEmitterBrowserWindow {
  async loadFile() {
    this.webContents.emit('did-fail-load', {}, -2, 'fixture load failed');
  }
}

async function run() {
  _resetPdfRenderPool();
  EventEmitterBrowserWindow.instances.length = 0;
  try {
    const first = await renderHtmlToPdf(
      { html: '<html><body>first</body></html>', filename: 'listener-first.pdf' },
      { BrowserWindow: EventEmitterBrowserWindow },
    );
    const window = EventEmitterBrowserWindow.instances[0];
    assert.equal(window.webContents.listenerCount('did-fail-load'), 0);
    assert.equal(window.webContents.listenerCount('did-finish-load'), 0);
    await fs.rm(first.saved_path, { force: true });

    const second = await renderHtmlToPdf(
      { html: '<html><body>second</body></html>', filename: 'listener-second.pdf' },
      { BrowserWindow: EventEmitterBrowserWindow },
    );
    await fs.rm(second.saved_path, { force: true });

    assert.equal(EventEmitterBrowserWindow.instances.length, 2);
    for (const pooledWindow of EventEmitterBrowserWindow.instances) {
      assert.equal(pooledWindow.webContents.listenerCount('did-fail-load'), 0);
      assert.equal(pooledWindow.webContents.listenerCount('did-finish-load'), 0);
    }

    const third = await renderHtmlToPdf(
      { html: '<html><body>third</body></html>', filename: 'listener-third.pdf' },
      { BrowserWindow: EventEmitterBrowserWindow },
    );
    assert.equal(EventEmitterBrowserWindow.instances.length, 2);
    for (const pooledWindow of EventEmitterBrowserWindow.instances) {
      assert.equal(pooledWindow.webContents.listenerCount('did-fail-load'), 0);
      assert.equal(pooledWindow.webContents.listenerCount('did-finish-load'), 0);
      pooledWindow.destroy();
    }
    await fs.rm(third.saved_path, { force: true });

    _resetPdfRenderPool();
    FailingBrowserWindow.instances.length = 0;
    await assert.rejects(
      renderHtmlToPdf(
        { html: '<html><body>failure</body></html>', filename: 'listener-fail.pdf' },
        { BrowserWindow: FailingBrowserWindow },
      ),
      /fixture load failed/,
    );
    const failed = FailingBrowserWindow.instances;
    assert.equal(failed.length, 1);
    assert.equal(failed[0].webContents.listenerCount('did-fail-load'), 0);
    assert.equal(failed[0].webContents.listenerCount('did-finish-load'), 0);
  } finally {
    _resetPdfRenderPool();
  }
}

run().then(() => {
  console.log('PDF render listener tests passed.');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
