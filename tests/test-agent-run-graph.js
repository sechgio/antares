'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRunGraph } = require('../electron/agent-run-graph');

function session(id, extra) {
  return { id, title: `Conv ${id}`, created_at: 1000, updated_at: 1100, ...extra };
}

test('una conversación raíz sin delegaciones produce un único nodo raíz', () => {
  const graph = buildRunGraph([session('a')], new Map());
  assert.equal(graph.nodes.length, 1);
  assert.deepEqual(graph.roots, ['a']);
  assert.equal(graph.nodes[0].kind, 'session');
  assert.equal(graph.nodes[0].state, 'done');
  assert.deepEqual(graph.nodes[0].children, []);
});

test('el lineage padre-hijo se enlaza y las raíces solo incluyen conversaciones sin padre', () => {
  const child = session('b', {
    created_at: 2000,
    delegation: { parent_session_id: 'a', status: 'working', depth: 1, round: 2, content: 'Investiga el tema' },
  });
  const graph = buildRunGraph([session('a'), child], new Map());
  assert.deepEqual(graph.roots, ['a']);
  const parent = graph.nodes.find((node) => node.id === 'a');
  const delegated = graph.nodes.find((node) => node.id === 'b');
  assert.deepEqual(parent.children, ['b']);
  assert.equal(delegated.parent_id, 'a');
  assert.equal(delegated.kind, 'delegation');
  assert.equal(delegated.state, 'running');
  assert.equal(delegated.round, 2);
  assert.equal(delegated.task, 'Investiga el tema');
});

test('un padre ausente o borrado convierte al hijo en raíz sin esconderlo', () => {
  const orphan = session('b', {
    delegation: { parent_session_id: 'x', status: 'pending', depth: 1 },
  });
  const deletedParent = session('x', { deleted: true });
  const graph = buildRunGraph([orphan, deletedParent], new Map());
  assert.deepEqual(graph.roots, ['b']);
  assert.equal(graph.nodes[0].parent_id, null);
  assert.equal(graph.nodes[0].state, 'queued');
});

test('el estado en vivo manda sobre el estado almacenado', () => {
  const live = new Map([['a', { run: { id: 'turn-1' }, inboxPending: false }]]);
  const graph = buildRunGraph([session('a')], live);
  assert.equal(graph.nodes[0].state, 'running');
  const queued = buildRunGraph([session('a')], new Map([['a', { run: null, inboxPending: true }]]));
  assert.equal(queued.nodes[0].state, 'queued');
});

test('los estados de delegación se mapean al vocabulario del grafo', () => {
  const cases = {
    pending: 'queued',
    working: 'running',
    done: 'done',
    failed: 'failed',
    cancelled: 'cancelled',
    uncertain: 'uncertain',
  };
  for (const [status, expected] of Object.entries(cases)) {
    const graph = buildRunGraph(
      [session('b', { delegation: { parent_session_id: 'a', status } }), session('a')],
      new Map(),
    );
    assert.equal(graph.nodes.find((node) => node.id === 'b').state, expected, `estado ${status}`);
  }
});

test('un error en la conversación raíz se refleja como failed', () => {
  const graph = buildRunGraph([session('a', { last_error: 'provider caído' })], new Map());
  assert.equal(graph.nodes[0].state, 'failed');
  assert.equal(graph.nodes[0].error, 'provider caído');
});

test('la ordenación es estable por creación y los hijos van ordenados', () => {
  const c1 = session('c1', { created_at: 3000, delegation: { parent_session_id: 'a', status: 'done' } });
  const c2 = session('c2', { created_at: 2000, delegation: { parent_session_id: 'a', status: 'done' } });
  const graph = buildRunGraph([c1, session('a', { created_at: 1000 }), c2], new Map());
  const parent = graph.nodes.find((node) => node.id === 'a');
  assert.deepEqual(parent.children, ['c1', 'c2'].sort());
});
