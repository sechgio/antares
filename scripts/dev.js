#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron');
const installEnv = { ...process.env };
delete installEnv.ELECTRON_SKIP_BINARY_DOWNLOAD;

function npm(args, cwd, env = process.env) {
  const cli = process.env.npm_execpath;
  return spawnSync(cli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm',
    cli ? [cli, ...args] : args, {
      cwd, env, stdio: 'inherit', windowsHide: true,
      shell: !cli && process.platform === 'win32',
    });
}

function missingDependencies(dir, commands) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const missing = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) =>
    !fs.existsSync(path.join(dir, 'node_modules', name, 'package.json')));
  for (const name of commands) {
    const moduleDir = path.join(dir, 'node_modules', name);
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(moduleDir, 'package.json'), 'utf8'));
      const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[name];
      const shim = path.join(dir, 'node_modules', '.bin', name + (process.platform === 'win32' ? '.cmd' : ''));
      if (!bin || !fs.existsSync(path.join(moduleDir, bin)) || !fs.existsSync(shim)) missing.push(name);
    } catch {
      missing.push(name);
    }
  }
  return [...new Set(missing)];
}

function checkElectronUnlocked() {
  if (process.platform !== 'win32') return;
  const executable = path.join(ELECTRON, 'dist', 'electron.exe');
  if (!fs.existsSync(executable)) return;
  try {
    fs.closeSync(fs.openSync(executable, 'r+'));
  } catch (error) {
    throw new Error(`Cierra Antares desde la bandeja del sistema y vuelve a ejecutar npm run dev. Electron está bloqueado o sin permiso de escritura (${error.code}).`);
  }
}

function prepareDependencies(dir, commands) {
  const missing = missingDependencies(dir, commands);
  if (!missing.length) return;
  checkElectronUnlocked();
  console.log(`[dev] Faltan dependencias en ${dir === ROOT ? 'la raíz' : 'frontend'}: ${missing.join(', ')}. Reparando con npm ci...`);
  const result = npm(['ci', '--include=dev', '--include=optional', '--bin-links=true', '--ignore-scripts=false'], dir, installEnv);
  if (result.error || result.status !== 0) {
    throw new Error(`npm ci falló en ${dir} (${result.error?.message || result.status}). Cierra Antares si aparece EPERM o EBUSY y vuelve a ejecutar npm run dev; revisa arriba el error de npm.`);
  }
  const remaining = missingDependencies(dir, commands);
  if (remaining.length) throw new Error(`La instalación sigue incompleta en ${dir}: ${remaining.join(', ')}. Revisa la salida de npm ci.`);
}

function electronBinaryExists() {
  try {
    const binary = fs.readFileSync(path.join(ELECTRON, 'path.txt'), 'utf8').trim();
    return Boolean(binary) && fs.existsSync(path.join(ELECTRON, 'dist', binary));
  } catch {
    return false;
  }
}

try {
  prepareDependencies(ROOT, ['concurrently', 'wait-on', 'electron']);
  prepareDependencies(FRONTEND, ['vite']);
  if (!electronBinaryExists()) {
    checkElectronUnlocked();
    console.log('[dev] Falta el binario de Electron. Descargando...');
    const result = spawnSync(process.execPath, [path.join(ELECTRON, 'install.js')], {
      cwd: ROOT, env: installEnv, stdio: 'inherit', windowsHide: true,
    });
    if (result.error || result.status !== 0 || !electronBinaryExists()) {
      throw new Error(`No se pudo instalar el binario de Electron (${result.error?.message || result.status}). Revisa la conexión y el error de descarga anterior.`);
    }
  }
  const result = npm(['run', 'dev:app'], ROOT);
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(`[dev] ${error.message}`);
  process.exitCode = 1;
}
