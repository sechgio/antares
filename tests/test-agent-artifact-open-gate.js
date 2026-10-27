'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assert, finish, evictModule } = require('./helpers/harness');
const { stubIpcDependencies } = require('./helpers/ipc-router');

try {
  stubIpcDependencies();
  evictModule('electron/ipc-file-policy');
  const { FORBIDDEN_FALLBACK_EXTENSIONS } = require('../electron/ipc-file-policy');

  assert(FORBIDDEN_FALLBACK_EXTENSIONS.has('.exe') && FORBIDDEN_FALLBACK_EXTENSIONS.has('.bat')
    && FORBIDDEN_FALLBACK_EXTENSIONS.has('.url') && FORBIDDEN_FALLBACK_EXTENSIONS.has('.lnk'),
    'la blocklist cubre ejecutables y accesos directos');
  assert(!FORBIDDEN_FALLBACK_EXTENSIONS.has('.pdf') && !FORBIDDEN_FALLBACK_EXTENSIONS.has('.xlsx'),
    'la blocklist no bloquea documentos habituales');

  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'agent-handlers.js'), 'utf8');
  const gateAt = source.indexOf('FORBIDDEN_FALLBACK_EXTENSIONS.has(extension)');
  const openAt = source.indexOf('shell.openPath(file.path)');
  assert(gateAt !== -1 && openAt !== -1 && gateAt < openAt,
    'la acción «open» consulta la blocklist antes de shell.openPath');

  finish();
} catch (error) {
  finish(error);
}
