import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import turnLog from '../../electron/turn-log.js';

const { appendTurn, listTurns } = turnLog;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let tmpDir;
let logPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbs-turns-'));
  logPath = path.join(tmpDir, 'turns.jsonl');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readLines(filePath = logPath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

function seed(entry, overrides = {}) {
  return appendTurn(
    {
      session_id: 's1',
      agent: 'orbs-bot',
      started_at: '2026-10-24T10:00:00Z',
      ended_at: '2026-10-24T10:00:05Z',
      status: 'ok',
      tool_calls: [{ name: 'noop', applied: true, verified: { kind: 'exit_code', value: 0 } }],
      input_summary: 'hola',
      output_summary: 'hecho',
      error: null,
      ...entry,
    },
    { logPath, ...overrides },
  );
}

describe('appendTurn', () => {
  it('escribe una entrada estructurada como una línea JSONL', () => {
    const returned = seed({ turn_id: 'turn_1' });

    const lines = readLines();
    expect(lines).toHaveLength(1);
    const stored = JSON.parse(lines[0]);
    expect(stored).toMatchObject({
      turn_id: 'turn_1',
      session_id: 's1',
      agent: 'orbs-bot',
      started_at: '2026-10-24T10:00:00.000Z',
      ended_at: '2026-10-24T10:00:05.000Z',
      status: 'ok',
      input_summary: 'hola',
      output_summary: 'hecho',
      error: null,
    });
    expect(stored.tool_calls).toEqual([
      { name: 'noop', applied: true, verified: { kind: 'exit_code', value: 0 } },
    ]);
    expect(returned.turn_id).toBe('turn_1');
  });

  it('usa TURN_LOG_PATH del entorno cuando no hay override', () => {
    process.env.TURN_LOG_PATH = logPath;
    try {
      appendTurn({ session_id: 's-env', status: 'failed', error: 'boom' });
      expect(readLines()).toHaveLength(1);
    } finally {
      delete process.env.TURN_LOG_PATH;
    }
  });

  it('nunca infiere éxito: estado ausente o inválido es error', () => {
    const missing = seed({ status: undefined });
    expect(missing.status).toBe('error');

    const invalid = seed({ status: 'success' });
    expect(invalid.status).toBe('error');
    expect(invalid.error).toContain('invalid status');

    const failed = seed({ status: 'failed', error: 'explosion' });
    expect(failed.status).toBe('failed');
  });

  it('degrada ok a error cuando una tool call no tiene evidencia verificada', () => {
    const unverified = seed({
      tool_calls: [{ name: 'shell.run', applied: true }],
    });
    expect(unverified.status).toBe('error');
    expect(unverified.error).toContain('unverified tool call: shell.run');

    const emptyEvidence = seed({
      tool_calls: [{ name: 'shell.run', applied: true, verified: {} }],
    });
    expect(emptyEvidence.status).toBe('error');
  });

  it('redacta secretos por clave y por patrón antes de escribir', () => {
    const entry = seed({
      session_id: 's-sec',
      tool_calls: [
        {
          name: 'http.post',
          applied: true,
          verified: { kind: 'capture', value: '200' },
          args: {
            password: 'hunter2',
            api_key: 'sk-abcdef1234567890abcd',
            authorization: 'Bearer topsecrettoken123',
            note: 'Bearer anothertoken1234567890',
            count: 3,
          },
        },
      ],
      input_summary: 'login con password=secret123 y token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12',
      output_summary: 'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV',
    });

    const raw = fs.readFileSync(logPath, 'utf8');
    expect(raw).not.toContain('hunter2');
    expect(raw).not.toContain('sk-abcdef1234567890abcd');
    expect(raw).not.toContain('topsecrettoken123');
    expect(raw).not.toContain('anothertoken1234567890');
    expect(raw).not.toContain('secret123');
    expect(raw).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12');
    expect(raw).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(raw).toContain('[redacted]');
    expect(raw).toContain('Bearer [redacted]');
    expect(raw).toContain('password=[redacted]');
    expect(entry.session_id).toBe('s-sec');
    expect(entry.tool_calls[0].args.count).toBe(3);
  });
});

describe('listTurns', () => {
  it('ignora líneas corruptas o truncadas al leer', () => {
    seed({ turn_id: 'turn_1', ended_at: '2026-10-24T10:00:01Z' });
    fs.appendFileSync(logPath, '{"turn_id":"turn_2","session_id":"s1","stat\n');
    seed({ turn_id: 'turn_3', ended_at: '2026-10-24T10:00:03Z' });

    return expect(listTurns({}, { logPath })).resolves.toEqual([
      expect.objectContaining({ turn_id: 'turn_1' }),
      expect.objectContaining({ turn_id: 'turn_3' }),
    ]);
  });

  it('filtra por sesión, estado y fecha en orden cronológico', async () => {
    seed({ turn_id: 't1', session_id: 'sa', ended_at: '2026-10-24T10:00:01Z' });
    seed({ turn_id: 't2', session_id: 'sb', status: 'error', ended_at: '2026-10-24T10:00:02Z' });
    seed({ turn_id: 't3', session_id: 'sa', ended_at: '2026-10-24T10:00:03Z' });
    seed({ turn_id: 't4', session_id: 'sa', status: 'error', ended_at: '2026-10-24T10:00:04Z' });

    const bySession = await listTurns({ session: 'sa' }, { logPath });
    expect(bySession.map((t) => t.turn_id)).toEqual(['t1', 't3', 't4']);

    const byStatus = await listTurns({ status: 'error' }, { logPath });
    expect(byStatus.map((t) => t.turn_id)).toEqual(['t2', 't4']);

    const both = await listTurns({ session: 'sa', status: 'error' }, { logPath });
    expect(both.map((t) => t.turn_id)).toEqual(['t4']);

    const since = await listTurns({ session: 'sa', since: '2026-10-24T10:00:02Z' }, { logPath });
    expect(since.map((t) => t.turn_id)).toEqual(['t3', 't4']);

    const all = await listTurns({}, { logPath });
    expect(all.map((t) => t.turn_id)).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('incluye los rotados y rota sin borrar nada al superar TURN_LOG_MAX_MB', async () => {
    const first = seed({ turn_id: 't1' }, { maxMb: 0.0002 });
    const second = seed({ turn_id: 't2' }, { maxMb: 0.0002 });

    const files = fs.readdirSync(tmpDir);
    const rotated = files.filter((name) => /^turns-.*\.jsonl$/.test(name));
    expect(rotated).toHaveLength(1);

    const rotatedLines = readLines(path.join(tmpDir, rotated[0]));
    expect(JSON.parse(rotatedLines[0]).turn_id).toBe(first.turn_id);

    const currentLines = readLines();
    expect(JSON.parse(currentLines[0]).turn_id).toBe(second.turn_id);

    const listed = await listTurns({}, { logPath });
    expect(listed.map((t) => t.turn_id)).toEqual([first.turn_id, second.turn_id]);
  });

  it('aplica limit sin cargar el resto del historial', async () => {
    seed({ turn_id: 't1', ended_at: '2026-10-24T10:00:01Z' });
    seed({ turn_id: 't2', ended_at: '2026-10-24T10:00:02Z' });
    seed({ turn_id: 't3', ended_at: '2026-10-24T10:00:03Z' });

    const limited = await listTurns({ limit: 2 }, { logPath });
    expect(limited.map((t) => t.turn_id)).toEqual(['t1', 't2']);
  });

  it('omite rotados anteriores a --since por su sello y tolera ficheros ilegibles', async () => {
    const oldRotated = path.join(tmpDir, 'turns-2020-01-01T00-00-00-000Z.jsonl');
    fs.writeFileSync(
      oldRotated,
      `${JSON.stringify({ turn_id: 't-viejo', session_id: 's1', ended_at: '2026-10-24T11:00:00Z' })}\n`,
    );
    fs.mkdirSync(path.join(tmpDir, 'turns-2030-01-01T00-00-00-000Z.jsonl'));
    seed({ turn_id: 't-actual', ended_at: '2026-10-24T10:00:05Z' });

    const filtered = await listTurns({ since: '2026-10-24T10:00:03Z' }, { logPath });
    expect(filtered.map((t) => t.turn_id)).toEqual(['t-actual']);

    const everything = await listTurns({}, { logPath });
    expect(everything.map((t) => t.turn_id)).toEqual(['t-viejo', 't-actual']);
  });

  it('devuelve lista vacía cuando no hay log', () => {
    return expect(listTurns({}, { logPath })).resolves.toEqual([]);
  });
});

describe('CLI orbs turns list', () => {
  function runCli(args) {
    return spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'orbs.js'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, TURN_LOG_PATH: logPath },
    });
  }

  it('lista por sesión en formato JSON', () => {
    seed({ turn_id: 't1', session_id: 'sa' });
    seed({ turn_id: 't2', session_id: 'sb' });

    const result = runCli(['turns', 'list', '--session', 'sa', '--json']);
    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).turn_id).toBe('t1');
  });

  it('imprime resumen human-readable y total', () => {
    seed({ turn_id: 't1', session_id: 'sa', output_summary: 'listo' });

    const result = runCli(['turns', 'list', '--session', 'sa']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('t1');
    expect(result.stdout).toContain('agent=orbs-bot');
    expect(result.stdout).toContain('session=sa');
    expect(result.stdout).toContain('out: listo');
    expect(result.stdout).toContain('1 turno(s)');
  });

  it('aplica --limit y rechaza valores no válidos', () => {
    seed({ turn_id: 't1', session_id: 'sa', ended_at: '2026-10-24T10:00:01Z' });
    seed({ turn_id: 't2', session_id: 'sa', ended_at: '2026-10-24T10:00:02Z' });

    const limited = runCli(['turns', 'list', '--session', 'sa', '--limit', '1', '--json']);
    expect(limited.status).toBe(0);
    const lines = limited.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).turn_id).toBe('t1');

    expect(runCli(['turns', 'list', '--limit', '0']).status).toBe(2);
    expect(runCli(['turns', 'list', '--limit', 'x']).status).toBe(2);
    expect(runCli(['turns', 'list', '--limit']).status).toBe(2);
  });

  it('rechaza argumentos inválidos con código 2', () => {
    expect(runCli(['bogus']).status).toBe(2);
    expect(runCli(['turns', 'list', '--status', 'win']).status).toBe(2);
    expect(runCli(['turns', 'list', '--since', 'ayer']).status).toBe(2);
    expect(runCli(['turns', 'list', '--session']).status).toBe(2);
  });
});
