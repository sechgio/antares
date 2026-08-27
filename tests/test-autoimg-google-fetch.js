/**
 * Contrato del transporte HTTP de Google: timeout, retry transitorio y cancelación.
 */

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

function response(status, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] || null;
      },
    },
  };
}

async function main() {
  const { fetchWithRetry } = require('../electron/autoimg-google-fetch');
  const originalFetch = global.fetch;

  try {
    // RED: el wrapper debe propagar una señal con timeout y cancelar el fetch.
    let aborted = false;
    global.fetch = async (_url, options = {}) => {
      assert(options.signal, 'fetch recibe una señal de cancelación');
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          aborted = true;
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    };

    let timeoutError = null;
    try {
      await fetchWithRetry('https://www.googleapis.com/test', {}, { timeoutMs: 10, retries: 0 });
    } catch (error) {
      timeoutError = error;
    }
    assert(timeoutError?.name === 'TimeoutError', 'timeout devuelve un error identificable');
    assert(aborted, 'timeout aborta el fetch subyacente');

    // GET reintenta 5xx y finalmente devuelve la respuesta exitosa.
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return response(calls < 3 ? 503 : 200);
    };
    const recovered = await fetchWithRetry(
      'https://www.googleapis.com/test',
      { method: 'GET' },
      { retries: 2, baseDelayMs: 1, maxDelayMs: 2 },
    );
    assert(recovered.status === 200, 'GET recupera después de un 5xx transitorio');
    assert(calls === 3, 'GET respeta el máximo de retries configurado');

    // Retry-After debe prevalecer sobre el backoff local.
    calls = 0;
    const startedAt = Date.now();
    global.fetch = async () => {
      calls += 1;
      return calls === 1 ? response(429, { 'retry-after': '0' }) : response(200);
    };
    const rateLimited = await fetchWithRetry(
      'https://www.googleapis.com/test',
      { method: 'GET' },
      { retries: 1, baseDelayMs: 100, maxDelayMs: 100 },
    );
    assert(rateLimited.status === 200, 'GET reintenta después de un 429');
    assert(Date.now() - startedAt < 90, 'Retry-After evita esperar el backoff innecesario');

    // POST no se reintenta automáticamente para evitar duplicar escrituras.
    calls = 0;
    global.fetch = async () => {
      calls += 1;
      return response(503);
    };
    const unsafe = await fetchWithRetry(
      'https://www.googleapis.com/test',
      { method: 'POST' },
      { retries: 2, baseDelayMs: 1, maxDelayMs: 2 },
    );
    assert(unsafe.status === 503, 'POST devuelve el error sin repetir la escritura');
    assert(calls === 1, 'POST no genera retries implícitos');

    console.log('[PASS] Google HTTP transport contract.');
  } finally {
    global.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error('[FAIL]', error);
  process.exit(1);
});
