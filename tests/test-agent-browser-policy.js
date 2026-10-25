'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assert, finish } = require('./helpers/harness');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-browser-policy-'));
process.env.LOCALAPPDATA = root;
const policy = require('../electron/agent-browser-policy');

assert(policy.hostOf('https://Mail.Ejemplo.com/ruta?x=1') === 'mail.ejemplo.com', 'hostOf extrae el host en minúsculas sin puerto ni ruta');
assert(policy.hostOf('no es una url') === '', 'hostOf devuelve vacío para direcciones inválidas');
assert(policy.isBlocked(policy.hostOf('https://paypal.com.'))
  && policy.isBlocked(policy.hostOf('https://www.paypal.com.')),
  'el punto final de un dominio sensible no permite eludir su bloqueo');

assert(policy.isBlocked('www.bcp.pe') && policy.isBlocked('empresas.bcp.pe'), 'la semilla bloquea la banca y sus subdominios');
assert(!policy.isBlocked('bcp.com.pe') && !policy.isBlocked('ejemplo.pe'), 'un dominio distinto o parecido no queda bloqueado');
assert(policy.isBlocked('sunat.gob.pe') && policy.isBlocked('operaciones.sunat.gob.pe'), 'la semilla bloquea portales de identidad e impuestos');

assert(!policy.isAlwaysAllowed('app.ejemplo.com'), 'de inicio nada está siempre permitido');
policy.addAlwaysAllowed('app.ejemplo.com');
assert(policy.isAlwaysAllowed('app.ejemplo.com') && policy.isAlwaysAllowed('v2.app.ejemplo.com'),
  'permitir siempre cubre el dominio y sus subdominios');
assert(!policy.isAlwaysAllowed('app.otro.com') && !policy.isAlwaysAllowed('faker.app.ejemplo.com.evil.com'),
  'permitir siempre no se filtra a dominios vecinos');
policy.addAlwaysAllowed('app.ejemplo.com');
policy.addAlwaysAllowed('');
const stored = JSON.parse(fs.readFileSync(path.join(root, 'Antares', 'ai-agent', 'browser-policy.json'), 'utf8'));
assert(JSON.stringify(stored.always_allowed) === JSON.stringify(['app.ejemplo.com']),
  'permitir siempre persiste sin duplicados ni entradas vacías');
assert(policy.isBlocked('app.ejemplo.com') === false, 'permitir siempre no bloquea nada por sí mismo');

const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-browser-policy-user-'));
fs.mkdirSync(path.join(root2, 'Antares', 'ai-agent'), { recursive: true });
fs.writeFileSync(path.join(root2, 'Antares', 'ai-agent', 'browser-policy.json'),
  JSON.stringify({ blocked: ['mi-banco.pe'], always_allowed: ['panel.miejemplo.pe'] }));
process.env.LOCALAPPDATA = root2;
delete require.cache[require.resolve('../electron/agent-browser-policy')];
const userPolicy = require('../electron/agent-browser-policy');
assert(userPolicy.isBlocked('portal.mi-banco.pe'), 'la lista blocked del usuario amplía la semilla');
assert(userPolicy.isAlwaysAllowed('panel.miejemplo.pe'), 'la lista siempre-permitidos del usuario se carga del fichero');
assert(!userPolicy.isAlwaysAllowed('app.ejemplo.com'), 'un perfil nuevo no hereda los permisos del anterior');

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(root2, { recursive: true, force: true });
finish();
