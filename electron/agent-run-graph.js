'use strict';

// Ensamblador puro del grafo de ejecución: toma las conversaciones durables y
// el estado en vivo y produce un bosque de nodos operable (ver, cancelar,
// inspeccionar). No conoce SQLite ni el harness; las dependencias llegan por
// parámetro para que las pruebas lo ejerciten sin arrancar el runtime.

const GRAPH_STATES = new Set([
  'queued',
  'running',
  'waiting_approval',
  'blocked',
  'done',
  'failed',
  'cancelled',
  'uncertain',
]);

function delegationState(status) {
  switch (status) {
    case 'pending':
      return 'queued';
    case 'working':
      return 'running';
    case 'done':
      return 'done';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'uncertain':
      return 'uncertain';
    default:
      return 'blocked';
  }
}

function sessionState(session, live) {
  if (live && live.run) return 'running';
  if (live && live.inboxPending) return 'queued';
  if (session.delegation) return delegationState(session.delegation.status);
  if (session.last_error) return 'failed';
  return 'done';
}

function nodeFor(session, live) {
  const delegation = session.delegation || null;
  const node = {
    id: session.id,
    kind: delegation ? 'delegation' : 'session',
    title: session.title || '',
    state: sessionState(session, live),
    parent_id: delegation ? delegation.parent_session_id || null : null,
    depth: delegation ? Number(delegation.depth ?? 1) : 0,
    created_at: session.created_at || null,
    updated_at: session.updated_at || null,
    error: session.last_error || null,
  };
  if (delegation) {
    node.agent = delegation.agent || (session.profile ? { id: session.profile.id, name: session.profile.name } : null);
    node.role = delegation.role || null;
    node.round = Number(delegation.round) || 1;
    node.started_at = delegation.started_at || null;
    node.root_parent_request_id = delegation.root_parent_request_id || null;
    if (delegation.delivery) node.delivery = { state: delegation.delivery.state || null, attempts: Number(delegation.delivery.attempts) || 0 };
    if (delegation.content) node.task = String(delegation.content).slice(0, 200);
  } else if (session.profile) {
    node.agent = { id: session.profile.id, name: session.profile.name };
  }
  return node;
}

function buildRunGraph(sessions, liveStates) {
  const live = liveStates || new Map();
  const nodes = [];
  const ids = new Set();
  for (const session of sessions) {
    if (!session || session.deleted) continue;
    const node = nodeFor(session, live.get(session.id));
    if (!GRAPH_STATES.has(node.state)) node.state = 'blocked';
    nodes.push(node);
    ids.add(node.id);
  }
  // Un padre borrado o ausente convierte al hijo en raíz: el grafo nunca
  // esconde trabajo por un hueco en el lineage.
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (node.parent_id && !byId.has(node.parent_id)) node.parent_id = null;
  }
  const children = new Map();
  for (const node of nodes) {
    if (!node.parent_id) continue;
    if (!children.has(node.parent_id)) children.set(node.parent_id, []);
    children.get(node.parent_id).push(node.id);
  }
  for (const node of nodes) node.children = (children.get(node.id) || []).sort();
  const order = (a, b) => (a.created_at || 0) - (b.created_at || 0) || String(a.id).localeCompare(String(b.id));
  nodes.sort(order);
  const roots = nodes.filter((node) => !node.parent_id).map((node) => node.id);
  return { nodes, roots };
}

module.exports = { buildRunGraph, GRAPH_STATES };
