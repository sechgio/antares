'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const preview = require('../electron/agent-preview');
const pages = require('../electron/agent-pages');
const { stubModule } = require('./helpers/harness');

const page = { version: 1, title: 'Trabajos', html: '<h1>Trabajos</h1><input id="filter" oninput="bad()">'
  + '<script>window.unwanted = true</script>', script: 'document.querySelector("h1").textContent = AntaresPage.rows.length;',
  data: { text: '</script><img src=x onerror=bad()>' }, rows: [{ metrado: 80 }], columns: ['metrado'] };

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-pages-'));
  try {
    const thumbnail = pages.preview(page, 'dark');
    assert.match(thumbnail, /script-src 'none'/);
    assert.match(thumbnail, /color-scheme:dark/);
    assert.match(thumbnail, /<h1>Trabajos<\/h1>/);
    assert.doesNotMatch(thumbnail, /<script|oninput=|AntaresPage|window\.unwanted/);
    assert.doesNotMatch(pages.documents(page, 'dark" onload="bad()').content, /onload=/);
    const [first, parallel] = await Promise.all([preview.openPage(page, 'dark'), preview.openPage(page, 'light')]);
    assert.equal(new URL(first).origin, new URL(parallel).origin);
    assert.equal((await fetch(parallel)).status, 200);
    assert.match(await (await fetch(new URL('content.html', parallel))).text(), /color-scheme:light/);
    preview.releasePage(parallel);
    const shell = await fetch(first);
    assert.equal(shell.status, 200);
    const shellHtml = await shell.text();
    assert.match(shellHtml, /sandbox="allow-scripts"/);
    assert.match(shellHtml, /<title>Trabajos<\/title>/);
    assert.match(shell.headers.get('content-security-policy'), /frame-src 'self'/);
    const frame = await fetch(new URL('content.html', first));
    const csp = frame.headers.get('content-security-policy');
    assert.match(csp, /connect-src 'none'/);
    assert.match(csp, /sandbox allow-scripts/);
    assert.doesNotMatch(csp, /allow-same-origin|unsafe-eval/);
    const html = await frame.text();
    assert.match(html, /color-scheme:dark/);
    assert.doesNotMatch(html, /window\.unwanted|oninput=/);
    assert.doesNotMatch(html, /script-src 'none'/);
    assert.match(html, /window\.AntaresPage/);
    assert.match(html, /import\(source\)/);
    assert.doesNotMatch(html, /<img src=x/);
    assert.equal(frame.headers.get('referrer-policy'), 'no-referrer');
    const second = await preview.openPage({ ...page, title: 'Otra' });
    assert.notEqual(first, second);
    fs.writeFileSync(path.join(root, 'index.html'), '<p>Preview</p>');
    await preview.open(path.join(root, 'index.html'));
    assert.equal((await fetch(first)).status, 200);
    assert.equal((await fetch(second)).status, 200);
    assert.equal((await fetch(new URL('secret.txt', first))).status, 404);
    assert.equal((await fetch(first.replace(/\/page\/[^/]+/, '/page/invalid'))).status, 404);
    assert.equal((await fetch(first, { method: 'POST' })).status, 405);
    await new Promise((resolve, reject) => {
      http.get(first, { headers: { Host: 'attacker.invalid' } }, (response) => {
        assert.equal(response.statusCode, 403); response.resume(); response.on('end', resolve);
      }).on('error', reject);
    });
    await assert.rejects(preview.openPage({ ...page, version: 99 }), /no es válida/);
    preview.releasePage(second);
    assert.equal((await fetch(second)).status, 404);
    assert.equal((await fetch(first)).status, 200);

    let opened = 0;
    let shellOpens = 0;
    stubModule('electron/agent-runtime', { open: async () => {} });
    stubModule('electron/agent-shared', { requireSession: async (id) => assert.equal(id, 's1') });
    stubModule('electron/ipc-router', { _callBackend: async (method, params) => {
      assert.equal(method, 'agent_internal_artifact_action');
      assert.equal(params.action, 'file');
      assert.equal(params.artifact_id, 'p1');
      return { page };
    } });
    stubModule('electron/agent-browser', { openPage: async (value, scheme) => {
      assert.equal(value, page); assert.equal(scheme, 'dark'); opened += 1;
    } });
    stubModule('electron', { shell: { openPath: () => { shellOpens += 1; } } });
    const { handleAgentCall } = require('../electron/agent-handlers');
    const miniature = await handleAgentCall('agent_artifact_action', {
      session_id: 's1', artifact_id: 'p1', action: 'preview', color_scheme: 'light',
    });
    assert.match(miniature.result.html, /color-scheme:light/);
    assert.doesNotMatch(miniature.result.html, /<script|AntaresPage/);
    assert.equal(opened, 0);
    const result = await handleAgentCall('agent_artifact_action', {
      session_id: 's1', artifact_id: 'p1', action: 'open', color_scheme: 'dark',
    });
    assert.deepEqual(result, { handled: true, result: { opened: true } });
    assert.equal(opened, 1);
    assert.equal(shellOpens, 0);
    await assert.rejects(handleAgentCall('agent_artifact_action', { session_id: 's1', artifact_id: 'p1', action: 'save' }), /dentro de Agent/);
    assert.equal(opened, 1);
    const pdfActions = [];
    stubModule('electron/ipc-router', { _callBackend: async (_method, params) => {
      pdfActions.push(params.action);
      return params.action === 'file' ? { path: 'Informe.pdf' } : { png_base64: 'png' };
    } });
    const pdf = await handleAgentCall('agent_artifact_action', { session_id: 's1', artifact_id: 'pdf', action: 'preview' });
    assert.equal(pdf.result.png_base64, 'png');
    assert.deepEqual(pdfActions, ['file', 'preview']);
    console.log('Páginas: servidor, aislamiento, reapertura y acción IPC aprobados.');
  } finally {
    preview.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
