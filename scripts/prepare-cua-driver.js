#!/usr/bin/env node
// Instala y verifica el driver de computer use (cua-driver) contra cua-driver/manifest.json.
// Uso:
//   node scripts/prepare-cua-driver.js verify
//   node scripts/prepare-cua-driver.js install <ruta del zip oficial>
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DRIVER_DIR = path.join(ROOT, 'cua-driver');
const MANIFEST = path.join(DRIVER_DIR, 'manifest.json');

function loadManifest() {
  if (!fs.existsSync(MANIFEST)) {
    throw new Error(`No existe ${MANIFEST}`);
  }
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function verify() {
  const manifest = loadManifest();
  let ok = true;
  const license = path.join(DRIVER_DIR, manifest.build.licenseFile);
  if (!fs.existsSync(license) || sha256(license) !== manifest.build.licenseSha256) {
    console.error(`LICENCIA AUSENTE O DISTINTA ${manifest.build.licenseFile}`);
    ok = false;
  }
  for (const bin of manifest.binaries) {
    const file = path.join(DRIVER_DIR, bin.path);
    if (!fs.existsSync(file)) {
      console.error(`FALTA ${bin.path}`);
      ok = false;
      continue;
    }
    const digest = sha256(file);
    const size = fs.statSync(file).size;
    if (digest !== bin.sha256) {
      console.error(`HASH DISTINTO ${bin.path}: ${digest} != ${bin.sha256}`);
      ok = false;
    } else if (size !== bin.byteSize) {
      console.error(`TAMAÑO DISTINTO ${bin.path}: ${size} != ${bin.byteSize}`);
      ok = false;
    } else {
      console.log(`OK ${bin.path} (${(size / 1048576).toFixed(1)} MB)`);
    }
  }
  if (!ok) {
    console.error('\ncua-driver/ no coincide con el manifest. Descarga el zip oficial y reinstala con:');
    console.error(`  ${manifest.build.assetUrl}`);
    console.error('  node scripts/prepare-cua-driver.js install <zip>');
    process.exit(1);
  }
  console.log('\ncua-driver verificado contra cua-driver/manifest.json.');
  return manifest;
}

function install(zipPath) {
  if (!zipPath) {
    console.error('Uso: node scripts/prepare-cua-driver.js install <zip>');
    process.exit(2);
  }
  const manifest = loadManifest();
  if (!fs.existsSync(zipPath)) {
    console.error(`No existe ${zipPath}`);
    process.exit(1);
  }
  const zipDigest = sha256(zipPath);
  if (zipDigest !== manifest.build.assetSha256) {
    console.error(`HASH DISTINTO ${path.basename(zipPath)}: ${zipDigest} != ${manifest.build.assetSha256}`);
    process.exit(1);
  }
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-cua-'));
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath ${quote(zipPath)} -DestinationPath ${quote(staging)} -Force`], { stdio: 'inherit' });
    for (const bin of manifest.binaries) {
      const src = path.join(staging, bin.path);
      const digest = fs.existsSync(src) ? sha256(src) : 'ausente';
      if (digest !== bin.sha256) {
        console.error(`HASH DISTINTO ${bin.path}: ${digest} != ${bin.sha256}`);
        process.exit(1);
      }
      fs.copyFileSync(src, path.join(DRIVER_DIR, bin.path));
      console.log(`Instalado ${bin.path} verificado por SHA-256.`);
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  verify();
}

const mode = process.argv[2] || 'verify';
if (mode === 'verify') {
  verify();
} else if (mode === 'install') {
  install(process.argv[3]);
} else {
  console.error(`Modo desconocido: ${mode}`);
  process.exit(2);
}
