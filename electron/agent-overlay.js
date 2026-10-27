'use strict';


const overlays = new Map();

function alive(win) {
  return win && !win.isDestroyed();
}

function showOverlay(sessionId, rect) {
  if (!Array.isArray(rect) || rect.length !== 4) return;
  const [x, y, width, height] = rect.map((value) => Math.round(Number(value)));
  if (!(width > 0 && height > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return;
  hideOverlay(sessionId);
  const electron = require('electron');
  const dip = electron.screen.screenToDipRect(null, { x, y, width, height });
  const win = new electron.BrowserWindow({
    x: dip.x, y: dip.y, width: dip.width, height: dip.height,
    frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, focusable: false, hasShadow: false,
    show: false, alwaysOnTop: true,
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<!doctype html><html><body style="margin:0;background:transparent;'
    + 'box-shadow:inset 0 0 0 3px rgba(245,158,11,.85),inset 0 0 0 4px rgba(245,158,11,.35)"></body></html>'));
  win.once('ready-to-show', () => {
    if (alive(win)) win.showInactive();
  });
  overlays.set(sessionId, win);
  win.on('closed', () => {
    if (overlays.get(sessionId) === win) overlays.delete(sessionId);
  });
}

function hideOverlay(sessionId) {
  const win = overlays.get(sessionId);
  if (!win) return;
  overlays.delete(sessionId);
  if (alive(win)) win.destroy();
}

function hideAllOverlays() {
  for (const sessionId of [...overlays.keys()]) hideOverlay(sessionId);
}

module.exports = { showOverlay, hideOverlay, hideAllOverlays };
