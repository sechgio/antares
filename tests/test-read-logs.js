const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, '..', 'scripts', 'read-logs.js');
const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-read-logs-'));

function runReadLogs(...args) {
  const result = spawnSync(process.execPath, [script, '--dir', logsDir, ...args], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

try {
  for (let index = 0; index <= 10; index += 1) {
    const rotated = index === 0 ? '' : `.${index}`;
    const event = { event: `rotation-${index}`, level: 'INFO', timestamp: `2026-09-23T00:${String(index).padStart(2, '0')}:00Z` };
    fs.writeFileSync(path.join(logsDir, `antares-2026-09-23${rotated}.jsonl`), `${JSON.stringify(event)}\n`);
  }

  assert.strictEqual(runReadLogs('--tail', '1')[0].event, 'rotation-10');

  fs.writeFileSync(
    path.join(logsDir, 'antares-2026-09-24.jsonl'),
    `${JSON.stringify({
      event: 'legacy',
      level: 'INFO',
      cookie: 'sessionid=COOKIE-SECRET; csrf=COOKIE-CSRF',
      message: 'cookie=sessionid=MESSAGE-SECRET; csrf=MESSAGE-CSRF',
      authorization: 'Bearer AUTH-SECRET',
    })}\n`,
  );
  const output = runReadLogs('--tail', '20');
  const text = JSON.stringify(output);
  for (const secret of ['COOKIE-SECRET', 'COOKIE-CSRF', 'MESSAGE-SECRET', 'MESSAGE-CSRF', 'AUTH-SECRET']) {
    assert(!text.includes(secret), `read-logs leaked ${secret}`);
  }
  assert(output.some((event) => event.event === 'legacy'));
} finally {
  fs.rmSync(logsDir, { recursive: true, force: true });
}
