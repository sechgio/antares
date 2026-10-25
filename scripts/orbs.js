#!/usr/bin/env node
'use strict';

const { listTurns, DEFAULT_LOG_PATH } = require('../electron/turn-log');

const STATUSES = ['ok', 'error', 'failed'];

const USAGE = `uso: orbs turns list --session <id> [--since <ISO8601>] [--status <ok|error|failed>] [--limit <n>] [--json]

Lee ${DEFAULT_LOG_PATH} junto a sus rotados turns-<timestamp>.jsonl, filtra en streaming
(sin cargar el historial completo en memoria) y muestra los turnos en orden cronológico.`;

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  return error;
}

function requireValue(value, flag) {
  if (value == null || value === '') {
    throw usageError(`${flag} requiere un valor`);
  }
  return value;
}

function parseArgs(argv) {
  const options = { session: null, since: null, status: null, limit: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--session':
        options.session = requireValue(argv[(i += 1)], '--session');
        break;
      case '--since':
        options.since = requireValue(argv[(i += 1)], '--since');
        break;
      case '--status':
        options.status = requireValue(argv[(i += 1)], '--status');
        break;
      case '--limit':
        options.limit = requireValue(argv[(i += 1)], '--limit');
        break;
      case '--json':
        options.json = true;
        break;
      default:
        throw usageError(`argumento desconocido: ${arg}`);
    }
  }
  return options;
}

function printTurn(turn) {
  console.log(
    `${turn.ended_at}  ${String(turn.status).padEnd(6)}  ${turn.turn_id}` +
      `  agent=${turn.agent || '-'}  session=${turn.session_id || '-'}` +
      `  tools=${Array.isArray(turn.tool_calls) ? turn.tool_calls.length : 0}`,
  );
  if (turn.input_summary) console.log(`    in:  ${turn.input_summary}`);
  if (turn.output_summary) console.log(`    out: ${turn.output_summary}`);
  if (turn.error) console.log(`    err: ${turn.error}`);
}

async function main(argv) {
  if (argv[0] === '--help' || argv[0] === '-h') {
    console.log(USAGE);
    return 0;
  }
  if (argv[0] !== 'turns' || argv[1] !== 'list') {
    process.stderr.write(`comando no soportado.\n${USAGE}\n`);
    return 2;
  }
  const options = parseArgs(argv.slice(2));
  if (options.status && !STATUSES.includes(options.status)) {
    process.stderr.write(`--status inválido: ${options.status} (valores: ${STATUSES.join(', ')})\n`);
    return 2;
  }
  if (options.since && Number.isNaN(Date.parse(options.since))) {
    process.stderr.write(`--since inválido: ${options.since} (se espera ISO8601)\n`);
    return 2;
  }
  let limit = null;
  if (options.limit != null) {
    limit = Number(options.limit);
    if (!Number.isInteger(limit) || limit <= 0) {
      process.stderr.write(`--limit inválido: ${options.limit} (se espera un entero positivo)\n`);
      return 2;
    }
  }
  const filters = {};
  if (options.session) filters.session = options.session;
  if (options.since) filters.since = options.since;
  if (options.status) filters.status = options.status;
  if (limit != null) filters.limit = limit;

  const turns = await listTurns(filters);
  if (options.json) {
    for (const turn of turns) {
      console.log(JSON.stringify(turn));
    }
  } else {
    for (const turn of turns) {
      printTurn(turn);
    }
    console.log(`\n${turns.length} turno(s)`);
  }
  return 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`${error && error.message ? error.message : String(error)}\n`);
    process.exitCode = error && error.exitCode ? error.exitCode : 1;
  });
