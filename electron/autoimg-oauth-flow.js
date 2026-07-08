const http = require('http');
const net = require('net');

const DEFAULT_PORT = 42813;
const FLOW_TIMEOUT_MS = 5 * 60_000;

let _server = null;
let _timeoutId = null;

function findAvailablePort(startPort = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      if (port > 65535) {
        reject(new Error('No hay puerto local disponible para OAuth'));
        return;
      }
      const tester = net.createServer();
      tester.once('error', () => tryPort(port + 1));
      tester.once('listening', () => {
        tester.close(() => resolve(port));
      });
      tester.listen(port, '127.0.0.1');
    };
    tryPort(startPort);
  });
}

function _successHtml() {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>AutoIMG</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f1115;color:#e8eaed;}
.card{text-align:center;padding:2rem;}h1{font-size:1.25rem;font-weight:500;margin:0 0 .5rem;}p{color:#9aa0a6;font-size:.9rem;margin:0;}</style></head>
<body><div class="card"><h1>Cuenta vinculada</h1><p>Ya puedes cerrar esta pestaña y volver a AutoIMG.</p></div></body></html>`;
}

function _errorHtml(message) {
  const safe = String(message || 'Autorización cancelada').replace(/[<>&]/g, '');
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>AutoIMG</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f1115;color:#e8eaed;}
.card{text-align:center;padding:2rem;max-width:360px;}h1{font-size:1.25rem;font-weight:500;margin:0 0 .5rem;color:#f87171;}p{color:#9aa0a6;font-size:.9rem;margin:0;}</style></head>
<body><div class="card"><h1>No se pudo conectar</h1><p>${safe}</p></div></body></html>`;
}

function stopCallbackServer() {
  if (_timeoutId) {
    clearTimeout(_timeoutId);
    _timeoutId = null;
  }
  if (_server) {
    _server.close();
    _server = null;
  }
}

function startCallbackServer(port, { onCode, onDenied, onTimeout }) {
  stopCallbackServer();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      stopCallbackServer();
      fn(value);
    };

    _server = http.createServer((req, res) => {
      const host = req.headers.host || `127.0.0.1:${port}`;
      let pathname = '/callback';
      let search = '';
      try {
        const parsed = new URL(req.url || '/', `http://${host}`);
        pathname = parsed.pathname;
        search = parsed.search;
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Solicitud inválida');
        return;
      }

      if (pathname !== '/' && pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      const params = new URLSearchParams(search);
      const code = params.get('code');
      const error = params.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(_errorHtml(error));
        finish(onDenied, error);
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(_errorHtml('Falta el código de autorización'));
        finish(onDenied, 'missing_code');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(_successHtml());
      finish(onCode, code);
    });

    _server.on('error', (err) => {
      stopCallbackServer();
      if (!settled) reject(err);
    });

    _server.listen(port, '127.0.0.1', () => {
      _timeoutId = setTimeout(() => {
        finish(onTimeout, new Error('Tiempo de espera agotado. Vuelve a intentar la conexión.'));
      }, FLOW_TIMEOUT_MS);
      resolve({ port });
    });
  });
}

module.exports = {
  findAvailablePort,
  startCallbackServer,
  stopCallbackServer,
  FLOW_TIMEOUT_MS,
};