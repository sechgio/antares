'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const runtime = read('electron/agent-runtime.js');
const tasks = read('electron/agent-tasks.js');
const rooms = read('electron/agent-rooms.js');
const catalog = JSON.parse(read('shared/ipc-method-catalog.json'));

assert.match(runtime, /private_memory: !session\.delegation/);
assert.match(runtime, /incognito: session\.incognito === true/);
assert.match(
  runtime,
  /if \(checkpoint && profile\?\.memory_scope !== 'none' && !session\.incognito && !session\.delegation\)/,
);
assert.match(runtime, /if \(session\.incognito === true \|\| session\.delegation\) return;/);
assert.match(tasks, /memoryContext\(child, child\.delegation\.content\)/);
assert.match(tasks, /!tool\.name\.startsWith\('memory_'\)/);
assert.doesNotMatch(rooms, /memoryContext/);

assert.equal(typeof catalog.methods.agent_session_incognito_set, 'object');
assert.equal(typeof catalog.methods.agent_memory_explain, 'object');
assert.match(JSON.stringify(catalog.methods.agent_internal_memory_context.inputSchema.properties), /private_memory/);
assert.match(JSON.stringify(catalog.methods.agent_internal_memory_context.inputSchema.properties), /incognito/);

console.log('agent memory privacy contracts ok');
