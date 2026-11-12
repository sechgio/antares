'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { assert, finish, counters } = require('./helpers/harness');
const { appendTurn } = require('../electron/turn-log');

// llm-prompt-output-handling-007: el turno-log vive en disco mucho tiempo;
// sus familias de redacción cubren lo mismo que app-log/compaction. Las
// muestras se componen por partes para no parecer credenciales literales.
const GH_PAT = ['github_pat_', 'B'.repeat(40)].join('');
const GOOGLE_KEY = ['AIza', 'C'.repeat(35)].join('');
const GOOGLE_TOKEN = ['ya29.', 'D'.repeat(24)].join('');
const GOOGLE_REFRESH = ['1//', 'E'.repeat(32)].join('');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-log-redact-'));
const logPath = path.join(dir, 'turns.jsonl');

appendTurn(
  {
    turn_id: 'turn-redact',
    session_id: 'sess-1',
    agent: 'main',
    status: 'ok',
    input_summary: [
      'Bearer ',
      'A'.repeat(24),
      ' pat=',
      GH_PAT,
      ' g=',
      GOOGLE_KEY,
      ' t=',
      GOOGLE_TOKEN,
      ' r=',
      GOOGLE_REFRESH,
      ' url=https://pepe:hunter2@api.example.com/v1?sig=firma123',
      ' cookie: session=sesion-larga',
    ].join(''),
    output_summary: '',
    error: null,
    tool_calls: [{ name: 'fs_read', args: { password: 'hunter2', nota: 'libre' } }],
  },
  { logPath },
);

const raw = fs.readFileSync(logPath, 'utf8');
const line = JSON.parse(raw.trim().split('\n').pop());

assert(raw.includes('[redacted]'), 'los valores sensibles se redactan en el turno-log');
for (const secret of [GH_PAT, GOOGLE_KEY, GOOGLE_TOKEN, GOOGLE_REFRESH]) {
  assert(!raw.includes(secret), 'el patrón de proveedor no sobrevive al redactor');
}
assert(!raw.includes('hunter2@api.example.com'), 'las credenciales de la URL se redactan');
assert(!raw.includes('firma123'), 'los tokens de query se redactan');
assert(!raw.includes('session=sesion-larga'), 'las cookies se redactan');
assert(!raw.includes('hunter2'), 'los valores de claves anidadas se redactan por nombre');
assert(typeof line.input_summary === 'string', 'la entrada se serializa como registro');
assert(raw.includes('"nota":"libre"'), 'los campos no sensibles pasan intactos');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${counters.passed} passed, ${counters.failed} failed`);
finish();
