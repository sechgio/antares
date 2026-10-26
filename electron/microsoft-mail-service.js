'use strict';

const cloud = require('./cloud-connector-common');

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'Mail.Read';
const MAX_RESULTS = 50;
const MAX_BODY_CHARS = 6000;
const ID_RE = /^[A-Za-z0-9!_.-]{3,300}$/;
const FIELDS = 'id,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview,hasAttachments,isRead';

const TOOLS = {
  outlook_search: ['Buscar correos de Microsoft y leer sus metadatos', {
    type: 'object', properties: {
      from: { type: 'string', description: 'Dirección exacta del remitente' },
      subject_contains: { type: 'string', description: 'Texto que debe aparecer en el asunto' },
      since: { type: 'string', description: 'Fecha ISO 8601; solo correos recibidos después' },
      max_results: { type: 'integer', minimum: 1, maximum: MAX_RESULTS },
    },
  }, false, [SCOPE]],
  outlook_get: ['Leer un correo de Microsoft sin adjuntos', {
    type: 'object', properties: { id: { type: 'string', description: 'ID devuelto por outlook_search' } },
    required: ['id'],
  }, false, [SCOPE]],
};

function _id(value) {
  const id = String(value || '').trim();
  if (!ID_RE.test(id)) throw new Error('ID de correo de Microsoft no válido');
  return id;
}

function _literal(value) {
  return String(value).replace(/'/g, "''");
}

function _request(url) {
  if (!url.startsWith(`${GRAPH}/me/messages`)) throw new Error('Dirección de Microsoft Graph no permitida');
  return cloud.request('microsoft', 'Microsoft', url);
}

async function context(name) {
  return cloud.accountContext('microsoft', 'Microsoft', TOOLS[name][3]);
}

function _received(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
}

function _meta(message) {
  const from = message.from?.emailAddress || {};
  return {
    id: message.id,
    conversation_id: message.conversationId,
    subject: String(message.subject || ''),
    from: String(from.name ? `${from.name} <${from.address || ''}>` : from.address || ''),
    to: (message.toRecipients || []).map((recipient) => recipient.emailAddress?.address || '').filter(Boolean),
    received: String(message.receivedDateTime || ''),
    received_ms: _received(message.receivedDateTime),
    snippet: String(message.bodyPreview || '').slice(0, 500),
    has_attachments: message.hasAttachments === true,
    is_read: message.isRead === true,
  };
}

async function search(params = {}) {
  const max = Math.max(1, Math.min(MAX_RESULTS, Number(params.max_results) || 20));
  const query = new URLSearchParams({ '$top': String(max), '$orderby': 'receivedDateTime desc', '$select': FIELDS });
  const filters = [];
  if (params.since || params.from) {
    const since = new Date(String(params.since || '0001-01-01T00:00:00Z'));
    if (!Number.isFinite(since.getTime())) throw new Error('La fecha since no es válida');
    filters.push(`receivedDateTime ge ${since.toISOString()}`);
  }
  if (params.from) filters.push(`from/emailAddress/address eq '${_literal(params.from)}'`);
  if (filters.length) query.set('$filter', filters.join(' and '));
  const body = await _request(`${GRAPH}/me/messages?${query}`);
  const wanted = String(params.subject_contains || '').trim().toLowerCase();
  const messages = (body.value || []).map(_meta).filter((message) => !wanted || message.subject.toLowerCase().includes(wanted));
  return { messages, from: params.from || null, subject_contains: wanted || null };
}

async function get(params = {}) {
  const url = `${GRAPH}/me/messages/${encodeURIComponent(_id(params.id))}?$select=${FIELDS},body`;
  const message = await _request(url);
  const content = String(message.body?.content || '');
  const text = message.body?.contentType === 'html'
    ? content.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
    : content;
  return {
    ..._meta(message),
    body: text.slice(0, MAX_BODY_CHARS),
    truncated: text.length > MAX_BODY_CHARS,
  };
}

async function run(name, params = {}) {
  if (name === 'outlook_search') return search(params);
  if (name === 'outlook_get') return get(params);
  throw new Error(`Herramienta de Microsoft no disponible: ${name}`);
}

module.exports = { TOOLS, context, run, search };
