'use strict';

const cloud = require('./cloud-connector-common');

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const MAX_QUERY_CHARS = 500;
const MAX_RESULTS = 20;
const MAX_BODY_CHARS = 6000;
const HEADERS = ['From', 'To', 'Subject', 'Date'];
const ID_RE = /^[A-Za-z0-9_-]{5,200}$/;

const TOOLS = {
  gmail_search: ['Buscar correos de Gmail y leer sus metadatos', {
    type: 'object', properties: {
      query: { type: 'string', description: 'Consulta de Gmail, p. ej. from:banco subject:estado newer_than:1d' },
      max_results: { type: 'integer', minimum: 1, maximum: MAX_RESULTS },
      page_token: { type: 'string', description: 'next_page_token de la búsqueda anterior' },
    },
  }, false, [SCOPE]],
  gmail_get: ['Leer un correo de Gmail sin adjuntos', {
    type: 'object', properties: { id: { type: 'string', description: 'ID devuelto por gmail_search' } },
    required: ['id'],
  }, false, [SCOPE]],
};

function _query(value) {
  const query = String(value || '').trim();
  if (!query) return 'in:inbox';
  if (query.length > MAX_QUERY_CHARS || /[\u0000-\u001f\u007f]/.test(query)) {
    throw new Error('Consulta de Gmail no válida');
  }
  return query;
}

function _id(value) {
  const id = String(value || '').trim();
  if (!ID_RE.test(id)) throw new Error('ID de correo de Gmail no válido');
  return id;
}

function _request(url) {
  if (!url.startsWith(`${GMAIL}/`)) throw new Error('Dirección de Gmail no permitida');
  return cloud.request('google', 'Google', url);
}

async function context(name) {
  return cloud.accountContext('google', 'Google', TOOLS[name][3]);
}

function _header(message, name) {
  const found = (message.payload?.headers || []).find((header) => String(header.name).toLowerCase() === name.toLowerCase());
  return found ? String(found.value) : '';
}

function _meta(message) {
  return {
    id: message.id,
    thread_id: message.threadId,
    internal_date: Number(message.internalDate) || 0,
    snippet: String(message.snippet || '').slice(0, 500),
    from: _header(message, 'From'),
    to: _header(message, 'To'),
    subject: _header(message, 'Subject'),
    date: _header(message, 'Date'),
    labels: message.labelIds || [],
  };
}

async function _message(id, format) {
  const url = new URL(`${GMAIL}/messages/${_id(id)}`);
  url.searchParams.set('format', format);
  if (format === 'metadata') {
    for (const header of HEADERS) url.searchParams.append('metadataHeaders', header);
  }
  return _request(url.toString());
}

function _decode(data) {
  if (typeof data !== 'string' || !data) return '';
  try {
    return Buffer.from(data, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

function _stripHtml(html) {
  return String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function _body(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  const plain = parts.find((part) => part.mimeType === 'text/plain' && part.body?.data);
  if (plain) return _decode(plain.body.data);
  const nested = parts.map((part) => _body(part)).find(Boolean);
  if (nested) return nested;
  if (payload.mimeType === 'text/plain') return _decode(payload.body?.data);
  if (payload.mimeType === 'text/html') return _stripHtml(_decode(payload.body?.data));
  return '';
}

function _attachments(payload) {
  if (!payload || typeof payload !== 'object') return 0;
  const own = payload.filename && payload.body?.attachmentId ? 1 : 0;
  return own + (Array.isArray(payload.parts) ? payload.parts.reduce((sum, part) => sum + _attachments(part), 0) : 0);
}

async function search(params = {}) {
  const query = _query(params.query);
  const max = Math.max(1, Math.min(MAX_RESULTS, Number(params.max_results) || 10));
  const url = new URL(`${GMAIL}/messages`);
  url.searchParams.set('maxResults', String(max));
  url.searchParams.set('q', query);
  if (params.page_token) url.searchParams.set('pageToken', String(params.page_token).slice(0, 500));
  const body = await _request(url.toString());
  const ids = (body.messages || []).slice(0, max);
  const messages = await Promise.all(ids.map(async (item) => _meta(await _message(item.id, 'metadata'))));
  return { query, messages, next_page_token: body.nextPageToken || null };
}

async function get(params = {}) {
  const message = await _message(params.id, 'full');
  const body = _body(message.payload);
  return {
    ..._meta(message),
    body: body.slice(0, MAX_BODY_CHARS),
    truncated: body.length > MAX_BODY_CHARS,
    has_attachments: _attachments(message.payload) > 0,
  };
}

async function run(name, params = {}) {
  if (name === 'gmail_search') return search(params);
  if (name === 'gmail_get') return get(params);
  throw new Error(`Herramienta de Gmail no disponible: ${name}`);
}

module.exports = { TOOLS, context, run, search };
