#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MEDIA_DIR = path.join(ROOT, 'media');
const MANIFEST = path.join(MEDIA_DIR, 'manifest.json');

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
  for (const bin of manifest.binaries) {
    const file = path.join(MEDIA_DIR, bin.path);
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
    console.error('\nmedia/ no coincide con el manifest. Reinstala con:');
    console.error('  node scripts/prepare-editor-media.js install <dir>');
    process.exit(1);
  }
  console.log('\nCadena multimedia verificada contra media/manifest.json.');
  return manifest;
}

function install(sourceDir) {
  if (!sourceDir) {
    console.error('Uso: node scripts/prepare-editor-media.js install <dir>');
    process.exit(2);
  }
  const manifest = loadManifest();
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  for (const bin of manifest.binaries) {
    const src = path.join(sourceDir, bin.path);
    if (!fs.existsSync(src)) {
      console.error(`No existe ${src}`);
      process.exit(1);
    }
    const digest = sha256(src);
    if (digest !== bin.sha256) {
      console.error(`HASH DISTINTO ${bin.path}: ${digest} != ${bin.sha256}`);
      process.exit(1);
    }
    fs.copyFileSync(src, path.join(MEDIA_DIR, bin.path));
    console.log(`Instalado ${bin.path} verificado por SHA-256.`);
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
