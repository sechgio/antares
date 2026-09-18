const path = require('path');
const { pathToFileURL } = require('url');
const { isTrustedRendererFrame } = require('../electron/renderer-trust');

const { assert, finish } = require('./helpers/harness');

const PACKAGED_RENDERER_URL = pathToFileURL(
  path.join(__dirname, '..', 'frontend', 'dist', 'index.html'),
).toString();

function makeWindow(frameUrl) {
  const mainFrame = { url: frameUrl, parent: null };
  return {
    isDestroyed: () => false,
    webContents: { id: 7, mainFrame },
    mainFrame,
  };
}

function frameEvent(win, { url, parent = null, senderId = 7 } = {}) {
  const frame =
    url === undefined && parent === null
      ? win.mainFrame
      : { url: url ?? win.mainFrame.url, parent };
  return {
    sender: { id: senderId, mainFrame: frame },
    senderFrame: frame,
  };
}

function run() {
  console.log('Testing renderer trust boundary...\n');

  const devWindow = makeWindow('http://localhost:5173/');

  console.log('URL rules (dev):');
  assert(
    isTrustedRendererFrame(frameEvent(devWindow), devWindow, true),
    'main frame on localhost:5173 accepted in dev',
  );
  assert(
    isTrustedRendererFrame(frameEvent(devWindow, { url: 'http://localhost:5173/route?x=1#h' }), devWindow, true),
    'dev URL accepts arbitrary paths and hashes',
  );

  for (const [url, why] of [
    ['', 'empty URL'],
    ['not a url', 'unparseable URL'],
    ['http://localhost:5174/', 'wrong port'],
    ['https://localhost:5173/', 'https scheme'],
    ['http://evil.localhost:5173/', 'lookalike hostname'],
    ['http://user:pass@localhost:5173/', 'URL with credentials'],
    ['file:///C:/app/frontend/dist/index.html', 'file URL in dev mode'],
  ]) {
    assert(
      !isTrustedRendererFrame(frameEvent(devWindow, { url }), devWindow, true),
      `${why} rejected in dev`,
    );
  }

  assert(
    isTrustedRendererFrame(
      frameEvent(makeWindow('http://127.0.0.1:5173/'), undefined),
      makeWindow('http://127.0.0.1:5173/'),
      true,
    ),
    'dev URL on 127.0.0.1:5173 accepted',
  );

  console.log('\nURL rules (prod):');
  const prodWindow = makeWindow(PACKAGED_RENDERER_URL);
  assert(
    isTrustedRendererFrame(frameEvent(prodWindow), prodWindow, false),
    'packaged renderer URL accepted in prod',
  );
  for (const [url, why] of [
    [`${PACKAGED_RENDERER_URL}#injected`, 'packaged URL with a fragment'],
    ['http://localhost:5173/', 'dev URL'],
    [PACKAGED_RENDERER_URL.toUpperCase(), 'case-mutated packaged URL'],
    ['file:///C:/evil/index.html', 'arbitrary file URL'],
  ]) {
    assert(
      !isTrustedRendererFrame(frameEvent(prodWindow, { url }), prodWindow, false),
      `${why} rejected in prod`,
    );
  }

  console.log('\nFrame/sender rules:');
  assert(!isTrustedRendererFrame(null, devWindow, true), 'missing event rejected');
  assert(!isTrustedRendererFrame({}, devWindow, true), 'event without frame/sender rejected');
  assert(
    !isTrustedRendererFrame(
      { sender: { id: 7 }, senderFrame: { url: 'file:///C:/evil.html', parent: null } },
      devWindow,
      true,
    ),
    'sender without mainFrame is still subject to URL validation',
  );
  assert(
    !isTrustedRendererFrame(frameEvent(devWindow, { senderId: 99 }), devWindow, true),
    'frame from a different webContents rejected',
  );
  assert(
    !isTrustedRendererFrame(
      frameEvent(devWindow, { parent: devWindow.mainFrame }),
      devWindow,
      true,
    ),
    'subframe with a parent is rejected even on the trusted URL',
  );
  const foreignFrame = { url: 'http://localhost:5173/', parent: null };
  assert(
    !isTrustedRendererFrame(
      { sender: { id: 7, mainFrame: devWindow.mainFrame }, senderFrame: foreignFrame },
      devWindow,
      true,
    ),
    'senderFrame that is not sender.mainFrame is rejected',
  );

  const destroyedWindow = { isDestroyed: () => true, webContents: devWindow.webContents };
  assert(
    !isTrustedRendererFrame(frameEvent(devWindow), destroyedWindow, true),
    'events targeting a destroyed window are rejected',
  );
  assert(!isTrustedRendererFrame(frameEvent(devWindow), null, true), 'missing main window rejected');

  const evilWindow = makeWindow('file:///C:/evil.html');
  assert(
    !isTrustedRendererFrame(frameEvent(evilWindow), evilWindow, true),
    'main renderer on an untrusted origin rejected',
  );
  assert(
    !isTrustedRendererFrame(frameEvent(devWindow), devWindow, false),
    'dev main frame rejected in prod mode',
  );

  finish();
}

run();
