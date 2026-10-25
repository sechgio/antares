'use strict';

const cloud = require('./cloud-connector-common');

const API = 'https://api.github.com/repos';
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const RUN_RE = /^\d{1,20}$/;
const HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
const SCOPES = ['repo', 'public_repo'];

const TOOLS = {
  github_workflow_runs: ['Consultar ejecuciones recientes de GitHub Actions', {
    type: 'object', properties: {
      repo: { type: 'string', description: 'owner/repositorio' },
      branch: { type: 'string', description: 'Rama cuyas ejecuciones listar' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: ['repo'],
  }, false, SCOPES],
  github_run_get: ['Consultar una ejecución concreta de GitHub Actions', {
    type: 'object', properties: {
      repo: { type: 'string', description: 'owner/repositorio' },
      run_id: { type: 'string', description: 'ID de la ejecución' },
    },
    required: ['repo', 'run_id'],
  }, false, SCOPES],
};

function _repo(value) {
  const repo = String(value || '').trim();
  if (!REPO_RE.test(repo)) throw new Error('Repositorio de GitHub no válido; usa owner/repositorio');
  return repo;
}

function _runId(value) {
  const id = String(value || '').trim();
  if (!RUN_RE.test(id)) throw new Error('ID de ejecución de GitHub no válido');
  return id;
}

function _request(url) {
  if (!url.startsWith(`${API}/`)) throw new Error('Dirección de GitHub no permitida');
  return cloud.request('github', 'GitHub', url, { headers: HEADERS });
}

async function context(name) {
  return cloud.accountContext('github', 'GitHub', TOOLS[name][3]);
}

function _run(run) {
  return {
    id: run.id ?? null,
    name: String(run.name || ''),
    workflow_id: run.workflow_id ?? null,
    head_branch: String(run.head_branch || ''),
    head_sha: String(run.head_sha || ''),
    event: String(run.event || ''),
    status: String(run.status || ''),
    conclusion: run.conclusion ? String(run.conclusion) : null,
    html_url: String(run.html_url || ''),
    created_at: String(run.created_at || ''),
    updated_at: String(run.updated_at || ''),
    run_attempt: run.run_attempt ?? null,
  };
}

async function runs(params = {}) {
  const repo = _repo(params.repo);
  const limit = Math.max(1, Math.min(50, Number(params.limit) || 10));
  const query = new URLSearchParams({ per_page: String(limit) });
  if (params.branch) query.set('branch', String(params.branch).slice(0, 200));
  const body = await _request(`${API}/${repo}/actions/runs?${query}`);
  return { repo, runs: (body.workflow_runs || []).map(_run) };
}

async function get(params = {}) {
  const repo = _repo(params.repo);
  const runId = _runId(params.run_id);
  return { repo, run: _run(await _request(`${API}/${repo}/actions/runs/${runId}`)) };
}

async function run(name, params = {}) {
  if (name === 'github_workflow_runs') return runs(params);
  if (name === 'github_run_get') return get(params);
  throw new Error(`Herramienta de GitHub no disponible: ${name}`);
}

module.exports = { TOOLS, context, run, runs, get };
