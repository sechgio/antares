'use strict';

// secrets-013: `npm install` no debe tragarse en silencio un rebuild nativo
// roto (receta muda en CI). En CI el fallo aborta la instalación; en local se
// avisa y se prosigue para no bloquear a quien no tiene toolchain nativo. La
// instalación de los ganchos git deja de ser un efecto lateral invisible.

const { execSync } = require('child_process');

function isStrict() {
  return process.env.CI === 'true' || process.env.CI === '1' || process.env.ANTARES_STRICT_POSTINSTALL === '1';
}

function run(command, { warnOnly = false } = {}) {
  try {
    execSync(command, { stdio: 'inherit' });
    return true;
  } catch (error) {
    const detail = error.message || String(error);
    if (!warnOnly && isStrict()) {
      console.error(`[postinstall] "${command}" falló; abortando la instalación (CI).`);
      process.exit(error.status || 1);
    }
    console.warn(`[postinstall] AVISO: "${command}" falló y se continúa: ${detail}`);
    return false;
  }
}

run('electron-builder install-app-deps');
console.log('[postinstall] Rebuild nativo de electron terminado.');

run('node scripts/install-hooks.js', { warnOnly: true });
console.log('[postinstall] Ganchos git listos (reintento manual: npm run hooks:install).');
