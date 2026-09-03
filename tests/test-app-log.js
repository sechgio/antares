const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.LOCALAPPDATA = path.join(os.tmpdir(), 'alog-fix-test');
fs.rmSync(process.env.LOCALAPPDATA, { recursive: true, force: true });
const l = require('../electron/app-log.js');

const tmp = os.tmpdir();
const OLD = Date.now() - 2 * 24 * 60 * 60 * 1000;
const FRESH = Date.now() - 60 * 1000;

function makeDir(name, contentMtime) {
  const p = path.join(tmp, name);
  fs.rmSync(p, { recursive: true, force: true });
  fs.mkdirSync(p, { recursive: true });
  const f = path.join(p, 'payload.tmp');
  fs.writeFileSync(f, 'x');
  if (contentMtime) fs.utimesSync(f, contentMtime / 1000, contentMtime / 1000);
  fs.utimesSync(p, OLD / 1000, OLD / 1000);
  return p;
}

makeDir('antares-staged-99999999', OLD);
makeDir(`antares-staged-${process.pid}`, OLD);
makeDir('antares-staged-88888888', FRESH);
makeDir('antares-pdf-x1y2z3', OLD);
makeDir('antares-backend-command-abc', OLD);

const removed = l.cleanStaleTempDirs();
console.log('removed:', removed);

assert(fs.existsSync(path.join(tmp, 'antares-staged-99999999')) === false, 'A: staging muerto debe borrarse');
assert(fs.existsSync(path.join(tmp, `antares-staged-${process.pid}`)) === true, 'B: staging de pid vivo NO debe borrarse');
assert(fs.existsSync(path.join(tmp, 'antares-staged-88888888')) === true, 'C: staging con contenido reciente NO debe borrarse');
assert(fs.existsSync(path.join(tmp, 'antares-pdf-x1y2z3')) === false, 'D: pdf viejo debe borrarse');
assert(fs.existsSync(path.join(tmp, 'antares-backend-command-abc')) === false, 'E: backend-command viejo debe borrarse');
console.log('cleanStaleTempDirs: 5/5 escenarios OK');

const dir = l.initAppLogs();
l.appendLogLine('INFO', 'linea normal con\nsalto de linea inyectado');
const d = new Date();
const yyyy = d.getFullYear();
const mm = String(d.getMonth() + 1).padStart(2, '0');
const dd = String(d.getDate()).padStart(2, '0');
const logFile = path.join(dir, `antares-${yyyy}-${mm}-${dd}.log`);
const content = fs.readFileSync(logFile, 'utf8');
assert(content.includes('linea normal con salto de linea inyectado'), 'CRLF sanitizado');
assert(!content.includes('\n[') || content.split('\n').length === 2, 'una sola linea');
console.log('appendLogLine + sanitización CRLF: OK');

try {
  fs.unlinkSync(logFile);
  fs.symlinkSync(path.join(dir, 'victima.txt'), logFile, 'file');
  l.appendLogLine('INFO', 'tras symlink');
  const st = fs.lstatSync(logFile);
  assert(!st.isSymbolicLink(), 'el symlink debe haberse eliminado');
  const c2 = fs.readFileSync(logFile, 'utf8');
  assert(c2.includes('tras symlink'), 'log escrito en archivo plano');
  assert(!fs.existsSync(path.join(dir, 'victima.txt')) || fs.statSync(path.join(dir, 'victima.txt')).size === 0, 'victima no contaminada');
  console.log('symlink hardening: OK');
} catch (err) {
  if (err.code === 'EPERM' || err.code === 'EACCES') {
    console.log('symlink hardening: SKIP (Windows sin privilegios para crear symlinks)');
  } else {
    throw err;
  }
}

for (const name of ['antares-staged-99999999', `antares-staged-${process.pid}`, 'antares-staged-88888888', 'antares-pdf-x1y2z3', 'antares-backend-command-abc']) {
  fs.rmSync(path.join(tmp, name), { recursive: true, force: true });
}
fs.rmSync(process.env.LOCALAPPDATA, { recursive: true, force: true });
console.log('TODO OK');
