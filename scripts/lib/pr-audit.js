/**
 * Capa de lectura/escritura del PR sobre la API de GitHub, compartida por las auditorías de revisión.
 *
 * Todo se resuelve con `gh` para no pedir tokens propios. Las colecciones se paginan por REST en
 * ráfagas acotadas: el listado de archivos de un PR de cientos de cambios es lo más lento de auditar,
 * y GraphQL responde 499 de forma intermitente cuando GitHub aún está calculando ese diff.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ghAsync, ghApiAsync } = require('./loop-utils');

const FETCH_TIMEOUT_MS = 20000;
const FETCH_ATTEMPTS = 3;
const LIST_PER_PAGE = 100;
const LIST_CONCURRENCY = 6;
const MAX_FILE_PAGES = 30;
const MAX_COMMENT_PAGES = 3;
const COMMENT_MARKER = 'antares-review-policy:';

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function settle(promise) {
  return promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
}

// Los reintentos absorben los 499/5xx transitorios: costar más tiempo vale menos que tumbar la puerta.
async function withRetry(fn, attempts = FETCH_ATTEMPTS, baseDelayMs = 500) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await sleep(baseDelayMs * attempt);
    }
  }
  throw lastError;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

function ghErrorMessage(err) {
  const detail = err && (err.stderr || err.stdout) ? String(err.stderr || err.stdout) : '';
  return `${String((err && err.message) || err || '')} ${detail}`.trim();
}

function isMissingGh(message) {
  return /ENOENT|command not found|Unknown command|Requires authentication|not logged on to/i.test(message);
}

function normalizeFile(file) {
  return {
    path: file.filename || file.path,
    additions: Number(file.additions) || 0,
    deletions: Number(file.deletions) || 0,
    status: String(file.status || '').toLowerCase(),
  };
}

function normalizeComment(comment) {
  return { id: comment.id, author: comment.user, body: comment.body, createdAt: comment.created_at };
}

function listUrl(base, page) {
  return `${base}?per_page=${LIST_PER_PAGE}&page=${page}`;
}

async function fetchListPage(url) {
  const raw = await withRetry(() => ghApiAsync([url], { timeout: FETCH_TIMEOUT_MS, maxBuffer: 24 * 1024 * 1024 }));
  return JSON.parse(raw || '[]');
}

async function fetchListPages(urls) {
  const pages = await mapLimit(urls, LIST_CONCURRENCY, (url) => settle(fetchListPage(url)));
  const items = [];
  let partial = false;
  for (const page of pages) {
    if (page.error) partial = true;
    else items.push(...page.value);
  }
  return { items, partial };
}

async function fetchPrMeta(repo, number) {
  const raw = await withRetry(() => ghApiAsync([`repos/${repo}/pulls/${number}`], { timeout: FETCH_TIMEOUT_MS }));
  const meta = JSON.parse(raw || 'null');
  if (!meta || !meta.number) throw new Error(`No se encontró el PR ${repo}#${number}`);
  return {
    number: meta.number,
    title: meta.title,
    body: meta.body,
    state: String(meta.state || '').toUpperCase(),
    isDraft: Boolean(meta.draft),
    url: meta.html_url,
    headRefOid: (meta.head && meta.head.sha) || '',
    baseRefName: (meta.base && meta.base.ref) || '',
    headRefName: (meta.head && meta.head.ref) || '',
    additions: Number(meta.additions) || 0,
    deletions: Number(meta.deletions) || 0,
    changedFiles: Number(meta.changed_files) || 0,
    author: meta.user || null,
    labels: (meta.labels || []).map((l) => l && l.name).filter(Boolean),
  };
}

async function fetchReviews(repo, number) {
  const { items } = await fetchListPages([listUrl(`repos/${repo}/pulls/${number}/reviews`, 1)]);
  return items.map((r) => ({ author: r.user, state: r.state, submittedAt: r.submitted_at, body: r.body }));
}

// El PR no anuncia cuántos comentarios tiene: se amplía sólo si la primera página viene llena.
async function fetchComments(repo, number) {
  const base = `repos/${repo}/issues/${number}/comments`;
  const first = await settle(fetchListPage(listUrl(base, 1)));
  if (first.error) return { items: [], failed: true };
  let items = first.value;
  let failed = false;
  if (items.length === LIST_PER_PAGE) {
    const urls = [];
    for (let page = 2; page <= MAX_COMMENT_PAGES; page++) urls.push(listUrl(base, page));
    const rest = await fetchListPages(urls);
    items = items.concat(rest.items);
    failed = rest.partial;
  }
  return { items: items.map(normalizeComment), failed };
}

// Meta, primera página de archivos, revisiones y comentarios salen en paralelo; el resto de
// páginas de archivos se pide después, también en paralelo.
async function fetchPrData(number, repo) {
  const filesBase = `repos/${repo}/pulls/${number}/files`;
  const [meta, firstFiles, reviews, comments] = await Promise.all([
    settle(fetchPrMeta(repo, number)),
    settle(fetchListPage(listUrl(filesBase, 1))),
    settle(fetchReviews(repo, number)),
    settle(fetchComments(repo, number)),
  ]);
  if (meta.error) throw meta.error;

  const pr = meta.value;
  const wantedPages = Math.min(Math.ceil(pr.changedFiles / LIST_PER_PAGE) || 1, MAX_FILE_PAGES);
  const commentData = comments.value || { items: [], failed: true };
  let partial =
    Boolean(firstFiles.error) ||
    Boolean(reviews.error) ||
    commentData.failed ||
    wantedPages * LIST_PER_PAGE < pr.changedFiles;
  let files = firstFiles.error ? [] : firstFiles.value;

  if (wantedPages > 1 || firstFiles.error) {
    const urls = [];
    for (let page = firstFiles.error ? 1 : 2; page <= wantedPages; page++) urls.push(listUrl(filesBase, page));
    const rest = await fetchListPages(urls);
    files = files.concat(rest.items);
    partial = partial || rest.partial;
  }

  return {
    pr: {
      ...pr,
      reviews: reviews.error ? [] : reviews.value,
      comments: commentData.items,
      files: files.map(normalizeFile),
    },
    partial,
  };
}

async function currentBranchPr(repo) {
  try {
    const out = await ghAsync(['pr', 'view', '--json', 'number', ...(repo ? ['--repo', repo] : [])], {
      timeout: FETCH_TIMEOUT_MS,
    });
    return JSON.parse(out).number;
  } catch {
    return null;
  }
}

// `execFile` asíncrono pierde el stdin ante `gh` en Windows, así que el cuerpo viaja por archivo.
async function sendBody(method, endpoint, body) {
  const file = path.join(os.tmpdir(), `antares-pr-audit-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ body }));
  try {
    return await ghApiAsync(['-X', method, endpoint, '--input', file], { timeout: FETCH_TIMEOUT_MS });
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function selectPolicyComment(comments) {
  const marked = (comments || [])
    .filter((c) => c && c.id && String(c.body || '').includes(COMMENT_MARKER))
    .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  return { update: marked[marked.length - 1] || null, remove: marked.slice(0, -1) };
}

// Un único informe por PR: actualiza en el sitio y borra duplicados, sin volver a paginar la conversación.
async function upsertPolicyComment(repo, pr, report) {
  const { update, remove } = selectPolicyComment(pr.comments);
  for (const stale of remove) {
    await ghApiAsync(['-X', 'DELETE', `repos/${repo}/issues/comments/${stale.id}`], {
      timeout: FETCH_TIMEOUT_MS,
    }).catch(() => null);
  }
  if (update) {
    await sendBody('PATCH', `repos/${repo}/issues/comments/${update.id}`, report);
    return 'actualizado';
  }
  await sendBody('POST', `repos/${repo}/issues/${pr.number}/comments`, report);
  return 'creado';
}

module.exports = {
  COMMENT_MARKER,
  currentBranchPr,
  fetchPrData,
  upsertPolicyComment,
  selectPolicyComment,
  normalizeFile,
  normalizeComment,
  ghErrorMessage,
  isMissingGh,
  mapLimit,
  withRetry,
  settle,
};
