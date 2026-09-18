const fs = require('fs');
const path = require('path');

const { assert, finish, counters } = require('./helpers/harness');

function run() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'window-manager.js'),
    'utf8',
  );

  const readyHandler = source.indexOf("mainWindow.once('ready-to-show'");
  const readyHandlerEnd = source.indexOf('\n  });', readyHandler);
  const readyBlock = source.slice(readyHandler, readyHandlerEnd);
  const failedLoadHandler = source.indexOf("mainWindow.webContents.on('did-fail-load'");
  const failedLoadHandlerEnd = source.indexOf('\n  });', failedLoadHandler);
  const failedLoadBlock = source.slice(failedLoadHandler, failedLoadHandlerEnd);
  const firstMaximize = source.indexOf('mainWindow.maximize()');

  assert(/\bshow:\s*false\b/.test(source), 'main window stays hidden until content is ready');
  assert(readyHandler >= 0, 'window registers a ready-to-show handler');
  assert(firstMaximize > readyHandler, 'window maximizes from the ready-to-show handler');
  assert(readyBlock.includes('mainWindow.show()'), 'window is shown from the ready-to-show handler');
  assert(failedLoadHandler >= 0, 'window observes main-frame load failures');
  assert(
    failedLoadBlock.includes('mainWindow.show()'),
    'window becomes visible when the initial load fails',
  );
  assert(
    failedLoadBlock.includes('loadMainWindowContent') || failedLoadBlock.includes('showLoadFailurePage'),
    'window attempts bounded recovery after a load failure',
  );

  console.log(`\n${counters.passed} passed, ${counters.failed} failed`);
  finish();
}

run();
