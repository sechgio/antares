
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const unpackedDir = path.join(projectRoot, 'dist-electron', 'win-unpacked');
const exePath = path.join(unpackedDir, 'Antares.exe');
const backendExePath = path.join(
  unpackedDir,
  'resources',
  'backend',
  'AntaresBackend.exe',
);

function fail(message) {
  console.error(`[run-unpacked] ${message}`);
  process.exit(1);
}

if (process.platform !== 'win32') {
  fail('Solo hay build Windows. Ejecuta esto en Windows.');
}

if (!fs.existsSync(exePath)) {
  fail(
    `No se encontró ${exePath}.\n` +
      'Ejecuta primero: npm run dist:dir  (o npm run preview:unpacked)',
  );
}

if (!fs.existsSync(backendExePath)) {
  fail(
    `No se encontró el backend empaquetado:\n  ${backendExePath}\n` +
      'El build quedó incompleto (extraResources). Vuelve a ejecutar: npm run dist:dir',
  );
}

console.log(`[run-unpacked] Abriendo ${exePath}`);

const child = spawn(exePath, [], {
  cwd: unpackedDir,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('error', (err) => {
  fail(`No se pudo iniciar la app: ${err.message}`);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code == null ? 0 : code);
});
