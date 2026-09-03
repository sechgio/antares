const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const exe = path.join(ROOT, 'dist', 'backend', 'AntaresBackend.exe');
const ipcMethods = fs.readFileSync(path.join(ROOT, 'electron', 'ipc-methods.js'), 'utf8');
const start = ipcMethods.indexOf('const BACKEND_METHODS');
const end = ipcMethods.indexOf('];', start);
const methods = [...ipcMethods.slice(start, end).matchAll(/'([a-z][a-z0-9_]*)'/g)].map((m) => m[1]);

if (!fs.existsSync(exe)) {
  console.error(`[FAIL] missing ${exe} — run npm run build:backend first`);
  process.exit(1);
}

const env = {
  PATH: process.env.PATH,
  SYSTEMROOT: process.env.SYSTEMROOT,
  WINDIR: process.env.WINDIR,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  LOCALAPPDATA: process.env.LOCALAPPDATA,
  APPDATA: process.env.APPDATA,
  USERPROFILE: process.env.USERPROFILE,
  HOMEDRIVE: process.env.HOMEDRIVE,
  HOMEPATH: process.env.HOMEPATH,
  PATHEXT: process.env.PATHEXT,
  PYTHONIOENCODING: 'utf-8',
  PYTHONUTF8: '1',
};

const proc = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true });
let stdoutBuf = '';
let stderrBuf = '';
let idx = 0;
let ready = false;
const results = [];
const TIMEOUT_MS = 180_000;

const timer = setTimeout(() => {
  console.error('[FAIL] overall timeout');
  console.error(stderrBuf.slice(-2000));
  proc.kill();
  process.exit(1);
}, TIMEOUT_MS);

function sendNext() {
  if (idx >= methods.length) {
    clearTimeout(timer);
    const fails = results.filter((r) => !r.ok);
    console.log(`\nSUMMARY total=${results.length} ok=${results.length - fails.length} fail=${fails.length}`);
    for (const f of fails) console.error(`  FAIL ${f.method}: ${f.detail}`);
    const templates = results.find((r) => r.method === 'templates_list');
    if (templates && templates.count != null) {
      console.log(`templates_list count=${templates.count}`);
      if (templates.count < 5) {
        console.error('[FAIL] templates_list too few');
        proc.kill();
        process.exit(1);
      }
    }
    proc.kill();
    process.exit(fails.length ? 1 : 0);
  }
  const method = methods[idx++];
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: method, method, params: {} })}\n`);
}

proc.stdout.on('data', (chunk) => {
  stdoutBuf += chunk.toString();
  const lines = stdoutBuf.split('\n');
  stdoutBuf = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.method === 'ready') {
      ready = true;
      console.log(`READY — probing ${methods.length} methods`);
      sendNext();
      continue;
    }
    if (msg.id === undefined) continue;
    const method = String(msg.id);
    const errMsg = msg.error && (msg.error.message || JSON.stringify(msg.error));
    const isMissing = typeof errMsg === 'string' && /No module named/.test(errMsg);
    const ok = !isMissing && (msg.result !== undefined || msg.error !== undefined);
    const entry = {
      method,
      ok,
      detail: isMissing ? errMsg : (msg.error ? `error:${msg.error.code || ''} ${errMsg}` : 'result'),
    };
    if (method === 'templates_list' && msg.result && Array.isArray(msg.result.templates)) {
      entry.count = msg.result.templates.length;
    }
    results.push(entry);
    const tag = ok ? 'OK' : 'FAIL';
    console.log(`${tag} ${method} ${entry.detail}${entry.count != null ? ` count=${entry.count}` : ''}`);
    sendNext();
  }
});

proc.stderr.on('data', (c) => {
  stderrBuf += c.toString();
});

proc.on('error', (err) => {
  clearTimeout(timer);
  console.error(err);
  process.exit(1);
});

proc.on('close', (code) => {
  if (results.length < methods.length) {
    clearTimeout(timer);
    console.error(`[FAIL] process exited early code=${code} after ${results.length}/${methods.length}`);
    console.error(stderrBuf.slice(-2000));
    process.exit(1);
  }
});
