'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (!process.versions.electron) {
  if (process.env.ANTARES_PAGES_REAL !== '1') {
    console.log('Prueba real de páginas omitida; activa ANTARES_PAGES_REAL=1 para ejecutar Electron.');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-pages-real-'));
  const env = { ...process.env, ANTARES_PAGES_TEST_DIR: dir, LOCALAPPDATA: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], {
    env, windowsHide: true, stdio: 'inherit',
  });
  const timeout = setTimeout(() => child.kill(), 60000);
  child.on('error', (error) => { console.error(error); process.exitCode = 1; });
  child.on('exit', (code) => {
    clearTimeout(timeout);
    assert(dir.startsWith(path.join(os.tmpdir(), 'antares-pages-real-')));
    fs.rmSync(dir, { recursive: true, force: true });
    process.exitCode = code ?? 1;
  });
} else {
  const { app, BrowserWindow, webContents } = require('electron');
  app.setPath('userData', process.env.ANTARES_PAGES_TEST_DIR);
  app.whenReady().then(async () => {
    const main = new BrowserWindow({ width: 1100, height: 850, show: false });
    const { stubModule } = require('./helpers/harness');
    stubModule('electron/window-manager', { getMainWindow: () => main });
    const browser = require('../electron/agent-browser');
    browser.dock({ x: 0, y: 0, width: 1100, height: 850 });
    try {
      const result = await browser.openPage({ version: 1, title: 'Panel de trabajos',
        html: '<h1>Trabajos de octubre</h1><p>Filtros y métricas sobre 235 órdenes de trabajo.</p>'
          + '<label>Metrado mínimo <input id="minimum" type="number"></label> '
          + '<button id="reset">Restablecer filtros</button><h2>Resumen</h2><p id="summary"></p>'
          + '<table><thead><tr><th>OT</th><th>Metrado (ml)</th></tr></thead><tbody id="rows"></tbody></table>',
        script: `const rows = AntaresPage.rows;
const input = document.querySelector('#minimum');
function render() {
  const filtered = rows.filter(row => row.metrado >= Number(input.value));
  document.querySelector('#summary').textContent = filtered.length + ' OT · ' + filtered.reduce((sum, row) => sum + row.metrado, 0) + ' ml';
  document.querySelector('#rows').innerHTML = filtered.slice(0, 15).map(row => '<tr><td>' + row.ot + '</td><td>' + row.metrado + '</td></tr>').join('');
}
input.addEventListener('input', render);
document.querySelector('#reset').addEventListener('click', () => { input.value = ''; render(); });
render(); window.ready = true;`,
        data: { text: '</script><img src=x onerror=bad()>' },
        rows: Array.from({ length: 235 }, (_, index) => ({ ot: index + 1, metrado: index < 11 ? 80 : 50 })),
        columns: ['ot', 'metrado'],
      });
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === result.url);
      assert(contents);
      let frame;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        frame = contents.mainFrame.frames.find((item) => item.url.endsWith('/content.html'));
        if (frame && await frame.executeJavaScript('window.ready === true')) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert(frame && await frame.executeJavaScript('window.ready === true'), 'el módulo de la página debe arrancar');
      assert.equal(await frame.executeJavaScript('document.querySelector("#summary").textContent'), '235 OT · 12080 ml');
      await frame.executeJavaScript('document.querySelector("#minimum").value = "80"; document.querySelector("#minimum").dispatchEvent(new Event("input"));');
      assert.equal(await frame.executeJavaScript('document.querySelector("#summary").textContent'), '11 OT · 880 ml');
      assert.equal(await frame.executeJavaScript('document.querySelectorAll("tbody tr").length'), 11);
      assert.equal(await frame.executeJavaScript('AntaresPage.data.text'), '</script><img src=x onerror=bad()>');
      assert.equal(await frame.executeJavaScript('typeof require + ":" + typeof window.electronAPI'), 'undefined:undefined');
      assert.equal(await frame.executeJavaScript('try { parent.document.body; false } catch { true }'), true);
      assert.equal(await frame.executeJavaScript('fetch("https://example.com/leak").then(() => false, () => true)'), true);
      await frame.executeJavaScript('document.querySelector("#reset").click();');
      assert.equal(await frame.executeJavaScript('document.querySelector("#summary").textContent'), '235 OT · 12080 ml');
      await browser.navigate('reload', undefined, result.active_tab);
      await new Promise((resolve) => setTimeout(resolve, 500));
      frame = contents.mainFrame.frames.find((item) => item.url.endsWith('/content.html'));
      assert.equal(await frame.executeJavaScript('document.querySelector("#summary").textContent'), '235 OT · 12080 ml');
      let navigationFailure = null;
      contents.on('did-fail-load', (_event, _code, description, url) => {
        if (url.includes('antares-page-security-check')) navigationFailure = description;
      });
      await frame.executeJavaScript('location.href = "https://example.com/antares-page-security-check";').catch(() => {});
      const navigationDeadline = Date.now() + 3000;
      while (!navigationFailure && Date.now() < navigationDeadline) await new Promise((resolve) => setTimeout(resolve, 50));
      assert(['ERR_BLOCKED_BY_CSP', 'ERR_BLOCKED_BY_CLIENT'].includes(navigationFailure), 'la navegación externa debe bloquearse');
      console.log('Electron real: 235 filas, filtros, tabla, reset, recarga, datos escapados y aislamiento aprobados.');
    } finally {
      browser.close();
      main.destroy();
    }
  }).then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
}
