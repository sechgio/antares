'use strict';

// Prueba real con el cua-driver instalado (node scripts/prepare-cua-driver.js install <zip>).
// Solo corre con ANTARES_CUA_REAL=1 porque abre una ventana en el escritorio: un formulario
// propio de PowerShell con un título único, nunca una app del usuario, y al final solo
// cierra ese proceso.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { assert, finish, stubModule } = require('./helpers/harness');

if (process.env.ANTARES_CUA_REAL !== '1' || process.platform !== 'win32') {
  console.log('Prueba real de cua-driver omitida (define ANTARES_CUA_REAL=1 en Windows con el driver instalado).');
  finish();
  return;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-cua-real-'));
stubModule('electron/canvas-assets.js', { antaresUserData: (...parts) => path.join(tmp, ...parts) });
const cua = require('../electron/agent-cua');
const catalog = require('../electron/agent-cua-tools.json');

const token = `antares-cua-${crypto.randomUUID().slice(0, 8)}`;
const FORM = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$form = New-Object System.Windows.Forms.Form',
  `$form.Text = '${token}'`,
  '$form.Width = 420; $form.Height = 200',
  '$box = New-Object System.Windows.Forms.TextBox',
  "$box.Name = 'campo'; $box.AccessibleName = 'Campo de prueba'; $box.Width = 300; $box.Top = 20; $box.Left = 20",
  '$form.Controls.Add($box)',
  '[void]$form.ShowDialog()',
].join('; ');

async function rawTools() {
  const exe = path.join(__dirname, '..', 'cua-driver', 'cua-driver.exe');
  const listed = await new Promise((resolve, reject) => {
    const child = spawn(exe, ['list-tools'], { windowsHide: true,
      env: { ...process.env, CUA_DRIVER_RS_TELEMETRY_ENABLED: '0', CUA_DRIVER_RS_UPDATE_CHECK: '0' } });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', reject);
    child.on('exit', () => resolve(out));
  });
  return new Set(listed.split(/\r?\n/).map((line) => line.split(':')[0].trim()).filter(Boolean));
}

async function main() {
  const available = await rawTools();
  assert(catalog.tools.every((tool) => available.has(tool.tool)), 'cada herramienta del catálogo existe en el binario instalado');

  const form = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', FORM], { windowsHide: false });
  try {
    let win = null;
    for (let i = 0; i < 40 && !win; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const listed = await cua.run('cua_list_windows', { on_screen_only: true }, { sessionId: 'prueba' });
      win = (listed.windows || []).find((item) => item.title === token);
    }
    assert(win && win.pid === form.pid, 'la ventana propia de la prueba aparece en cua_list_windows');
    const state = await cua.run('cua_window_state', { pid: win.pid, window_id: win.window_id, query: 'Campo', include_screenshot: false },
      { sessionId: 'prueba' });
    const field = (state.elements || []).find((element) => /edit/i.test(String(element.role)));
    assert(field && field.element_token, 'cua_window_state encuentra el campo con query y devuelve su element_token');
    const typed = await cua.run('cua_type_text', { pid: win.pid, window_id: win.window_id, element_token: field.element_token, text: 'hola desde cua' },
      { sessionId: 'prueba' });
    assert(['confirmed', 'applied'].includes(typed.effect) && typed.delivery && typed.delivery.mode === 'background',
      `cua_type_text escribe en segundo plano y confirma el efecto (${typed.effect})`);
    const after = await cua.run('cua_window_state', { pid: win.pid, window_id: win.window_id, query: 'Campo', include_screenshot: false },
      { sessionId: 'prueba' });
    const value = ((after.elements || []).find((element) => /edit/i.test(String(element.role))) || {}).value;
    assert(value === 'hola desde cua', 'el valor del campo comprueba lo escrito');
  } finally {
    cua.close();
    form.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().then(() => finish(), (err) => { console.error('[FAIL]', err); process.exit(1); });
