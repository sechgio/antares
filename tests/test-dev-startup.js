const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { assert, finish } = require('./helpers/harness');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'dev.js');
const pkg = require('../package.json');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

async function main() {
  assert(pkg.scripts.dev === 'node scripts/dev.js', 'npm run dev starts with Node even without node_modules');

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'antares dev & test-'));
  let runningElectron;
  try {
    fs.mkdirSync(path.join(fixture, 'scripts'));
    fs.copyFileSync(script, path.join(fixture, 'scripts', 'dev.js'));
    write(path.join(fixture, 'package.json'), JSON.stringify({
      dependencies: { '@fixture/runtime': '1' },
      devDependencies: { concurrently: '1', 'wait-on': '1', electron: '1' },
    }));
    write(path.join(fixture, 'frontend', 'package.json'), JSON.stringify({
      dependencies: { react: '1' }, devDependencies: { vite: '1' },
    }));
    const fakeNpm = path.join(fixture, 'npm.cjs');
    write(fakeNpm, `
      const fs = require('node:fs');
      const path = require('node:path');
      const root = __dirname;
      const args = process.argv.slice(2);
      fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
      if (args[0] === 'run') process.exit(Number(process.env.FIXTURE_LAUNCH_STATUS || 0));
      if (process.env.FIXTURE_INSTALL_FAIL) { console.error('npm error EPERM: archivo bloqueado'); process.exit(7); }
      if (process.env.FIXTURE_INSTALL_NOOP) process.exit(0);
      if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) process.exit(9);
      const pkg = require(path.join(process.cwd(), 'package.json'));
      for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
        const dir = path.join(process.cwd(), 'node_modules', name);
        fs.mkdirSync(dir, { recursive: true });
        const bin = name.startsWith('@') || name === 'react' ? undefined : { [name]: 'cli.js' };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, bin }));
        if (bin) {
          fs.writeFileSync(path.join(dir, 'cli.js'), '');
          const shim = path.join(process.cwd(), 'node_modules', '.bin', name + (process.platform === 'win32' ? '.cmd' : ''));
          fs.mkdirSync(path.dirname(shim), { recursive: true });
          fs.writeFileSync(shim, '');
        }
        if (name === 'electron') {
          fs.writeFileSync(path.join(dir, 'install.js'), \`
            const fs = require('node:fs');
            const path = require('node:path');
            if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) process.exit(9);
            if (process.env.FIXTURE_DOWNLOAD_FAIL) { console.error('download failed'); process.exit(8); }
            fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
            fs.writeFileSync(path.join(__dirname, 'path.txt'), 'electron.exe');
            fs.writeFileSync(path.join(__dirname, 'dist', 'electron.exe'), 'fixture');
          \`);
        }
      }
    `);
    const log = path.join(fixture, 'calls.jsonl');
    const calls = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
    const run = (env = {}) => {
      if (fs.existsSync(log)) fs.unlinkSync(log);
      return spawnSync(process.execPath, [path.join(fixture, 'scripts', 'dev.js')], {
        cwd: os.tmpdir(), encoding: 'utf8', timeout: 15000,
        env: { ...process.env, npm_execpath: fakeNpm, ELECTRON_SKIP_BINARY_DOWNLOAD: '1', ...env },
      });
    };

    let result = run();
    assert(result.status === 0, `missing dependencies are installed before launch: ${result.stderr}`);
    assert(calls().filter((call) => call.args[0] === 'ci').length === 2, 'fresh checkout installs root and frontend');
    assert(calls().filter((call) => call.args[0] === 'ci').every((call) =>
      call.args.includes('--include=dev') && call.args.includes('--bin-links=true') && call.args.includes('--ignore-scripts=false')),
    'repair includes dev dependencies, command shims and install scripts');
    assert(calls().at(-1)?.args.join(' ') === 'run dev:app', 'application launches only after preparation');

    result = run({ FIXTURE_LAUNCH_STATUS: '3' });
    assert(result.status === 3 && calls().length === 1, 'healthy install skips network and preserves application exit code');

    fs.unlinkSync(path.join(fixture, 'frontend', 'node_modules', 'react', 'package.json'));
    result = run();
    assert(result.status === 0 && calls().length === 2 && calls()[0].cwd === path.join(fixture, 'frontend'),
      'missing frontend runtime dependency repairs only frontend');

    const shim = path.join(fixture, 'node_modules', '.bin', `concurrently${process.platform === 'win32' ? '.cmd' : ''}`);
    fs.unlinkSync(shim);
    result = run({ FIXTURE_INSTALL_FAIL: '1' });
    assert(result.status !== 0 && calls().length === 1 && !calls().some((call) => call.args[0] === 'run'),
      'failed repair stops before starting application');
    assert(result.stderr.includes('Cierra Antares') && result.stderr.includes('EPERM'), 'locked-file failure gives actionable guidance and keeps npm error');
    result = run({ FIXTURE_INSTALL_NOOP: '1' });
    assert(result.status !== 0 && calls().length === 1, 'unsuccessful repair is rechecked and never retried indefinitely');
    assert(run().status === 0, 'missing command shim is restored');

    const binary = path.join(fixture, 'node_modules', 'electron', 'dist', 'electron.exe');
    fs.unlinkSync(binary);
    result = run({ FIXTURE_DOWNLOAD_FAIL: '1' });
    assert(result.status !== 0 && calls().length === 0 && result.stderr.includes('No se pudo instalar el binario'),
      'failed Electron download stops before application launch');
    result = run();
    assert(result.status === 0 && fs.existsSync(binary) && calls().length === 1, 'missing Electron binary downloads without reinstalling packages');

    if (process.platform === 'win32') {
      fs.copyFileSync(process.execPath, binary);
      runningElectron = spawn(binary, ['-e', "console.log('ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'] });
      await once(runningElectron.stdout, 'data');
      fs.unlinkSync(shim);
      result = run();
      assert(result.status !== 0 && calls().length === 0 && result.stderr.includes('Cierra Antares'),
        'running Electron blocks destructive reinstall before npm ci');
      runningElectron.kill();
      await once(runningElectron, 'exit');
      runningElectron = null;
    }
  } finally {
    if (runningElectron) {
      runningElectron.kill();
      await once(runningElectron, 'exit');
    }
    fs.rmSync(fixture, { recursive: true, force: true });
  }
  finish();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
