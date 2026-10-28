'use strict';

const fs = require('node:fs');
const Module = require('module');
const path = require('node:path');

// agent-browser captura node:dns al cargar: el stub se instala antes del
// require y delega en una función intercambiable para cada caso.
let lookupBehavior = null;
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'node:dns') {
    return { promises: { lookup: (host, options) => lookupBehavior(host, options) } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { assert, finish } = require('./helpers/harness');
const { normalizeUrl, isPrivateHostname, isAllowedWebUrl, isPublicResolution } = require('../electron/agent-browser');

function throwsPrivate(url) {
  try {
    normalizeUrl(url);
    return false;
  } catch (error) {
    return /red privada/.test(String(error.message));
  }
}

(async () => {
  try {
    for (const url of [
      'http://127.0.0.1/x',
      'http://localhost:5173',
      'http://LOCALHOST:5173',
      'http://[::1]/',
      'http://10.0.0.5/',
      'http://172.16.0.1/',
      'http://192.168.1.1/admin',
      'http://169.254.169.254/latest/meta-data',
      'http://100.64.0.1/',
      'http://224.0.0.1/',
      'http://2130706433/',
      'http://0x7f000001/',
      'http://0x7f.1/',
    ]) {
      assert(throwsPrivate(url), `normalizeUrl rechaza ${url}`);
    }

    assert(normalizeUrl('https://example.com/') === 'https://example.com/', 'las URLs públicas pasan intactas');
    assert(normalizeUrl('example.com') === 'https://example.com', 'un dominio simple se prefija y pasa');
    assert(normalizeUrl('http://8.8.8.8/') === 'http://8.8.8.8/', 'una IP pública pasa');
    assert(/^https:\/\/duckduckgo\.com\/html\/\?q=/.test(normalizeUrl('buscar gatos')), 'las búsquedas van al buscador');

    assert(isPrivateHostname('localhost') && isPrivateHostname('sub.localhost'), 'localhost y sus subdominios son privados');
    assert(isPrivateHostname('::1') && isPrivateHostname('[::1]'), 'loopback IPv6, con o sin corchetes');
    assert(isPrivateHostname('::') && isPrivateHostname('::ffff:127.0.0.1') && isPrivateHostname('::ffff:8.8.8.8'),
      'IPv6 no especificada y mapeadas a IPv4 se bloquean');
    assert(isPrivateHostname('fc00::1') && isPrivateHostname('fdff::1'), 'rango único local fc00::/7');
    assert(isPrivateHostname('fe80::1') && isPrivateHostname('febf::1') && !isPrivateHostname('fec0::1'), 'link-local fe80::/10');
    assert(isPrivateHostname('127.0.0.1') && isPrivateHostname('8.8.8.8') === false, 'IPv4 públicas pasan');
    assert(isPrivateHostname('999.1.1.1'), 'una IPv4 malformada falla cerrado');

    assert(isAllowedWebUrl('https://example.com') === true, 'navegación pública permitida');
    assert(isAllowedWebUrl('http://127.0.0.1') === false && isAllowedWebUrl('file:///etc/passwd') === false
      && isAllowedWebUrl('no es una url') === false, 'privadas, esquemas locales y basura se bloquean');

    lookupBehavior = async (host) => {
      if (host === 'dual.example') return [{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }];
      if (host === 'v6.example') return [{ address: '::1', family: 6 }];
      if (host === 'ok.example') return [{ address: '93.184.216.34', family: 4 }];
      throw new Error(`NXDOMAIN: ${host}`);
    };

    assert(await isPublicResolution('https://ok.example/a') === true, 'un dominio que resuelve público navega');
    assert(await isPublicResolution('https://evil.example/a') === false, 'un dominio que resuelve a IP privada no navega');
    assert(await isPublicResolution('https://dual.example/a') === false,
      'si una sola de las direcciones resuelve privada, no navega');
    assert(await isPublicResolution('https://v6.example/a') === false, 'una resolución IPv6 privada no navega');
    assert(await isPublicResolution('https://nxdomain.example/a') === false, 'sin resolución verificable no navega');
    assert(await isPublicResolution('https://10.0.0.1/a') === false, 'un literal IPv4 privado no consulta DNS');
    assert(await isPublicResolution('https://8.8.8.8/a') === true, 'un literal IPv4 público no consulta DNS');
    assert(await isPublicResolution('https://localhost/a') === false, 'localhost no consulta DNS');

    const src = fs.readFileSync(path.resolve(__dirname, '..', 'electron', 'agent-browser.js'), 'utf8');
    assert(src.includes("ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'file:///*'] }"),
      'la sesión de navegación verifica la resolución de cada petición, incluidas redirecciones y subrecursos');

    Module._load = originalLoad;
    finish();
  } catch (error) {
    Module._load = originalLoad;
    finish(error);
  }
})();
