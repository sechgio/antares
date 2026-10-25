'use strict';

const { assert, finish, stubModule } = require('./helpers/harness');

const created = [];
const destroyed = [];
let dipInput = null;
stubModule('electron', {
  screen: {
    screenToDipRect: (_win, rect) => {
      dipInput = { ...rect };
      return { x: rect.x + 1, y: rect.y + 2, width: rect.width - 2, height: rect.height - 4 };
    },
  },
  BrowserWindow: class {
    constructor(options) {
      this.options = options;
      this.handlers = {};
      this.url = null;
      this.shown = false;
      created.push(this);
    }
    setAlwaysOnTop() { }
    setIgnoreMouseEvents() { }
    loadURL(url) {
      this.url = url;
      return Promise.resolve();
    }
    once(event, fn) {
      this.handlers[event] = fn;
    }
    on(event, fn) {
      this.handlers[event] = fn;
    }
    isDestroyed() {
      return !!this.destroyed;
    }
    showInactive() {
      this.shown = true;
    }
    destroy() {
      this.destroyed = true;
      destroyed.push(this);
    }
  },
});
const overlay = require('../electron/agent-overlay');

assert(created.length === 0, 'sin mostrar nada no hay ventanas');
overlay.showOverlay('s1', [100, 200, 800, 600]);
assert(created.length === 1, 'showOverlay crea una ventana por sesión');
const win = created[0];
assert(win.options.focusable === false && win.options.transparent === true && win.options.skipTaskbar === true
  && win.options.frame === false && win.options.alwaysOnTop === true && win.options.show === false,
'la ventana del overlay no roba foco, es transparente y no aparece en la barra');
assert(JSON.stringify(dipInput) === JSON.stringify({ x: 100, y: 200, width: 800, height: 600 }),
  'el rect físico del backend se convierte a DIP');
assert(win.options.x === 101 && win.options.y === 202 && win.options.width === 798 && win.options.height === 596,
  'la ventana usa el rect convertido');
assert(win.shown === false, 'no se muestra hasta ready-to-show');
win.handlers['ready-to-show']();
assert(win.shown === true, 'ready-to-show la hace visible sin activarla');
assert(String(win.url).startsWith('data:text/html;charset=utf-8,'), 'el contenido es un documento local en línea');

overlay.showOverlay('s1', [0, 0, 400, 300]);
assert(created.length === 2 && win.destroyed === true, 'mostrar de nuevo reemplaza la ventana previa');

overlay.hideOverlay('s1');
assert(destroyed.length === 2 && destroyed[1] === created[1], 'hideOverlay destruye la ventana activa');
overlay.hideOverlay('s1');
assert(destroyed.length === 2, 'ocultar sin ventana activa es inofensivo');

overlay.showOverlay('s2', [10, 10, 100, 100]);
overlay.showOverlay('s2', [0, 0, 0, 0]);
assert(created.length === 3, 'un rect sin tamaño no crea ventana');
overlay.showOverlay('s2', 'malo');
assert(created.length === 3, 'un rect no válido no crea ventana');
overlay.showOverlay('s2', [1, 2, 50, Number.NaN]);
assert(created.length === 3, 'un rect con NaN no crea ventana');

overlay.showOverlay('s3', [1, 2, 50, 50]);
overlay.hideAllOverlays();
assert(created[created.length - 1].destroyed === true, 'hideAllOverlays cierra todas');

finish();
