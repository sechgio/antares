'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { assert, finish, stubModule, installInertTimers } = require('./helpers/harness');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-browser-tabs-'));
process.env.LOCALAPPDATA = root;
const browser = require('../electron/agent-browser');

async function tabsTest() {
  const pages = [];
  const mainChildren = new Set();
  const hostChildren = new Set();
  const main = {
    isDestroyed: () => false,
    getContentSize: () => [1000, 700],
    webContents: { getZoomFactor: () => 1, send: () => {} },
    contentView: {
      addChildView: (child) => mainChildren.add(child),
      removeChildView: (child) => mainChildren.delete(child),
    },
  };
  const host = {
    isDestroyed: () => false,
    on: () => {},
    showInactive: () => {},
    setIgnoreMouseEvents: () => {},
    destroy: () => {},
    contentView: {
      addChildView: (child) => hostChildren.add(child),
      removeChildView: (child) => hostChildren.delete(child),
    },
  };
  const makePage = () => {
    const contents = Object.assign(new EventEmitter(), {
      url: '', title: '',
      isDestroyed() { return false; },
      getURL() { return contents.url; },
      getTitle() { return contents.title; },
      isLoading() { return false; },
      getZoomFactor() { return 1; },
      setZoomFactor() {},
      navigationHistory: { canGoBack: () => false, canGoForward: () => false, goBack() {}, goForward() {} },
      setWindowOpenHandler() {},
      loadURL: async (url) => { contents.url = url; contents.title = url; },
      executeJavaScript: async () => ({ url: contents.url, title: contents.title, text: '', elements: [] }),
      executeJavaScriptInIsolatedWorld: async () => ({ url: contents.url, time_origin: 1 }),
      debugger: Object.assign(new EventEmitter(), { isAttached: () => false, attach: () => {}, sendCommand: async () => {} }),
      close() { contents.emit('destroyed'); },
    });
    const page = { webContents: contents, bounds: { width: 1280, height: 860 },
      setBounds(next) { page.bounds = next; }, getBounds() { return page.bounds; } };
    pages.push(page);
    return page;
  };
  stubModule('electron/window-manager.js', { getMainWindow: () => main });
  stubModule('electron', {
    BrowserWindow: function () { return host; },
    WebContentsView: function () { return makePage(); },
    session: { fromPartition: () => ({ setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {},
      on: () => {}, getUserAgent: () => 'Mozilla/5.0 Chrome/1 Electron/1', setUserAgent: () => {} }) },
  });
  const timers = installInertTimers();
  try {
    browser.dock({ x: 10, y: 20, width: 400, height: 500 });
    await browser.run('web_open', { url: 'https://agent.example' });
  } finally { timers.restore(); }
  const agentPage = pages[0];
  let current = browser.state();
  assert(current.active_tab === 'agent' && current.tabs[0].url === 'https://agent.example',
    'el agente abre en su propia pestaña');
  assert(mainChildren.has(agentPage), 'la pestaña activa se monta en la ventana principal');

  browser.activateTab('user');
  const userTimers = installInertTimers();
  try { await browser.navigate('open', 'https://user.example', 'user'); } finally { userTimers.restore(); }
  const userPage = pages[1];
  current = browser.state();
  assert(current.active_tab === 'user' && current.tabs[1].url === 'https://user.example',
    'el usuario abre su pestaña sin tocar la del agente');
  assert(mainChildren.has(userPage) && !mainChildren.has(agentPage) && hostChildren.has(agentPage),
    'al cambiar de pestaña se mueve la vista activa y la otra sigue viva fuera de pantalla');

  userPage.webContents.emit('before-mouse-event', {}, { type: 'mouseDown' });
  current = browser.state();
  const agentTab = current.tabs.find((tab) => tab.id === 'agent');
  const userTab = current.tabs.find((tab) => tab.id === 'user');
  assert(userTab.busy_until > Date.now() && agentTab.busy_until === 0,
    'la entrada en la pestaña del usuario no bloquea al agente');

  browser.setUserControl(true, 'user');
  current = browser.state();
  assert(current.tabs.find((tab) => tab.id === 'user').user_control
    && !current.tabs.find((tab) => tab.id === 'agent').user_control,
  'el control de una pestaña no bloquea la otra');
  browser.setUserControl(false, 'user');

  const agentTimers = installInertTimers();
  try { await browser.run('web_open', { url: 'https://agent-2.example' }); } finally { agentTimers.restore(); }
  current = browser.state();
  assert(current.active_tab === 'user' && current.tabs[0].url === 'https://agent-2.example'
    && current.tabs[1].url === 'https://user.example',
  'el agente navega en su pestaña mientras el usuario conserva la suya');
  assert(mainChildren.has(userPage) && hostChildren.has(agentPage),
    'la navegación del agente no cambia la pestaña visible del usuario');

  browser.activateTab('agent');
  assert(mainChildren.has(agentPage) && hostChildren.has(userPage),
    'cambiar a la pestaña del agente devuelve su vista al panel');
  browser.setUserControl(true, 'agent');
  let controlBlocked = null;
  try { await browser.run('web_read', {}); } catch (err) { controlBlocked = err; }
  assert(controlBlocked?.code === 'USER_CONTROL', 'tomar el control de la pestaña del agente detiene al agente');
  browser.setUserControl(false, 'agent');

  const readA = await browser.run('web_read', {}, { sessionId: 'conversation-a' });
  assert(readA.url === 'https://agent-2.example', 'la conversación propietaria lee su página');
  let leaseBlocked = null;
  try { await browser.run('web_read', {}, { sessionId: 'conversation-b' }); } catch (err) { leaseBlocked = err; }
  assert(leaseBlocked?.code === 'BROWSER_BUSY' && leaseBlocked.recoverable === true,
    'otra conversación no puede usar la pestaña del agente');
  browser.release('conversation-a');
  const readB = await browser.run('web_read', {}, { sessionId: 'conversation-b' });
  assert(readB.url === 'https://agent-2.example', 'al liberar, otra conversación puede continuar');
  browser.release('conversation-b');

  current = browser.newTab();
  assert(current.active_tab === 'tab-1' && current.tabs.map((tab) => tab.id).join() === 'agent,user,tab-1'
    && current.tabs[2].label === 'Nueva pestaña', 'el usuario abre una pestaña nueva y queda activa');
  const extraTimers = installInertTimers();
  try { await browser.navigate('open', 'https://extra.example'); } finally { extraTimers.restore(); }
  const extraPage = pages[pages.length - 1];
  assert(mainChildren.has(extraPage) && hostChildren.has(agentPage) && hostChildren.has(userPage),
    'la pestaña nueva tiene su propia vista y las demás siguen vivas');
  browser.activateTab('user');
  current = browser.closeTab('user');
  assert(current.active_tab === 'tab-1' && !current.tabs.some((tab) => tab.id === 'user'),
    'al cerrar la pestaña visible se activa la de la derecha');
  current = browser.closeTab('tab-1');
  assert(current.active_tab === 'agent' && current.tabs.length === 1 && !mainChildren.has(extraPage),
    'al cerrar la última se activa la del agente y se retira la vista cerrada');
  let agentClose = null;
  try { browser.closeTab('agent'); } catch (err) { agentClose = err; }
  assert(agentClose, 'la pestaña del agente no se puede cerrar');
  for (let i = 0; i < 8; i++) browser.newTab();
  let capped = null;
  try { browser.newTab(); } catch (err) { capped = err; }
  assert(capped && browser.state().tabs.length === 9, 'el usuario puede tener hasta ocho pestañas');
  browser.close();
  assert(browser.state().tabs.map((tab) => tab.id).join() === 'agent,user', 'cerrar el navegador restaura las pestañas iniciales');
}

tabsTest().then(() => { fs.rmSync(root, { recursive: true, force: true }); finish(); },
  (err) => { console.error('[FAIL]', err); process.exit(1); });
