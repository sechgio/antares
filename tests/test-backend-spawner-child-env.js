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

function run() {
  console.log('Testing backend child env whitelist...\n');

  const backendCommandPath = require.resolve('../electron/backend-command.js');
  require.cache[backendCommandPath] = {
    id: backendCommandPath,
    filename: backendCommandPath,
    loaded: true,
    exports: { getBackendCommand: () => ({ cmd: 'python', args: [] }) },
  };

  const spawnerPath = require.resolve('../electron/backend-spawner.js');
  delete require.cache[spawnerPath];
  const { _buildChildEnv } = require('../electron/backend-spawner.js');

  const prev = {
    ANTARES_MAP_PROVIDER: process.env.ANTARES_MAP_PROVIDER,
    ANTARES_MAPS_API_KEY: process.env.ANTARES_MAPS_API_KEY,
    COMSPEC: process.env.COMSPEC,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    SSL_CERT_FILE: process.env.SSL_CERT_FILE,
  };

  process.env.ANTARES_MAP_PROVIDER = 'osm';
  process.env.ANTARES_MAPS_API_KEY = 'test-key';
  process.env.COMSPEC = process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe';
  process.env.XDG_DATA_HOME = '/tmp/xdg-test';
  process.env.HTTPS_PROXY = 'http://proxy.test:8080';
  process.env.SSL_CERT_FILE = '/tmp/cert.pem';
  process.env.PYTHONPATH = 'C:\\should-not-reach-frozen';
  process.env.VIRTUAL_ENV = 'C:\\venv-dev-only';
  process.env.UNRELATED_SECRET_TOKEN = 'should-not-appear';

  try {
    const packaged = _buildChildEnv(false);
    assert(packaged.PYTHONIOENCODING === 'utf-8', 'forces PYTHONIOENCODING=utf-8');
    assert(packaged.PYTHONUTF8 === '1', 'forces PYTHONUTF8=1');
    assert(packaged.ANTARES_IPC_TELEMETRY === '1', 'forces ANTARES_IPC_TELEMETRY=1 (sampled telemetry)');
    assert(packaged.ANTARES_MAP_PROVIDER === 'osm', 'passes ANTARES_MAP_PROVIDER');
    assert(packaged.ANTARES_MAPS_API_KEY === 'test-key', 'passes ANTARES_MAPS_API_KEY');
    assert(packaged.COMSPEC === process.env.COMSPEC, 'passes COMSPEC');
    assert(packaged.XDG_DATA_HOME === '/tmp/xdg-test', 'passes XDG_DATA_HOME');
    assert(packaged.HTTPS_PROXY === 'http://proxy.test:8080', 'passes HTTPS_PROXY');
    assert(packaged.SSL_CERT_FILE === '/tmp/cert.pem', 'passes SSL_CERT_FILE');
    assert(packaged.UNRELATED_SECRET_TOKEN === undefined, 'does not clone unrelated secrets');
    assert(packaged.PYTHONPATH === undefined, 'packaged child must not inherit PYTHONPATH');
    assert(packaged.VIRTUAL_ENV === undefined, 'packaged child must not inherit VIRTUAL_ENV');
    assert(packaged.PATH !== undefined, 'passes PATH');
    assert(packaged.LOCALAPPDATA !== undefined || packaged.HOME !== undefined || packaged.USERPROFILE !== undefined,
      'passes at least one user-data root');

    const dev = _buildChildEnv(true);
    assert(dev.PYTHONPATH === 'C:\\should-not-reach-frozen', 'dev child passes PYTHONPATH');
    assert(dev.VIRTUAL_ENV === 'C:\\venv-dev-only', 'dev child passes VIRTUAL_ENV');
    assert(dev.ANTARES_IPC_TELEMETRY === '1', 'dev child also forces ANTARES_IPC_TELEMETRY=1');
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete process.env.UNRELATED_SECRET_TOKEN;
    delete process.env.PYTHONPATH;
    delete process.env.VIRTUAL_ENV;
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));
  if (failed > 0) process.exit(1);
}

run();
