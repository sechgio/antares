const fs = require('fs');
const path = require('path');

const { isPathInside } = require('./path-allowlist');

const _allowedWriteRoots = new Set();
const MAX_ALLOWED_WRITE_ROOTS = 500;
const WRITE_ROOTS_FILE = 'antares-write-roots.json';

function _addWriteRoot(root) {
  if (_allowedWriteRoots.has(root)) return false;
  while (_allowedWriteRoots.size >= MAX_ALLOWED_WRITE_ROOTS) {
    _allowedWriteRoots.delete(_allowedWriteRoots.keys().next().value);
  }
  _allowedWriteRoots.add(root);
  return true;
}

function _persistedWriteRootsPath() {
  try {
    const { app } = require('electron');
    const userData = app && typeof app.getPath === 'function' ? app.getPath('userData') : null;
    return userData ? path.join(userData, WRITE_ROOTS_FILE) : null;
  } catch {
    return null;
  }
}

function _persistWriteRoots() {
  const file = _persistedWriteRootsPath();
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify([..._allowedWriteRoots], null, 2), 'utf8');
  } catch {
  }
}

function _loadPersistedWriteRoots() {
  const file = _persistedWriteRootsPath();
  if (!file) return;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(raw)) return;
    for (const entry of raw) {
      if (typeof entry !== 'string' || !entry.trim()) continue;
      try {
        const resolved = path.resolve(entry.trim());
        let canonical = resolved;
        try {
          canonical = fs.realpathSync(resolved);
        } catch {
          try {
            canonical = fs.realpathSync(path.dirname(resolved));
            canonical = path.join(canonical, path.basename(resolved));
          } catch {
            canonical = resolved;
          }
        }
        _addWriteRoot(canonical);
      } catch {
      }
    }
    if (_allowedWriteRoots.size >= MAX_ALLOWED_WRITE_ROOTS) _persistWriteRoots();
  } catch {
  }
}

function _registerWriteRootFromPath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) return;
  const resolved = path.resolve(rawPath);
  let root;
  try {
    const stat = fs.lstatSync(resolved);
    root = stat.isDirectory() ? resolved : path.dirname(resolved);
  } catch {
    root = path.dirname(resolved);
  }
  if (_addWriteRoot(root)) _persistWriteRoots();
}

function _isUnderAllowedPdfWriteDir(dir) {
  const resolvedDir = path.resolve(dir);
  for (const root of _allowedWriteRoots) {
    if (isPathInside(root, resolvedDir)) return true;
  }
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      for (const name of ['documents', 'downloads']) {
        const stdRoot = app.getPath(name);
        if (stdRoot && isPathInside(stdRoot, resolvedDir)) return true;
      }
    }
  } catch {
  }
  return false;
}

function _sanitizeFilename(name) {
  if (typeof name !== 'string' || !name.trim()) return 'reporte.pdf';
  const base = path.basename(name);
  const safe = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();
  if (!safe.toLowerCase().endsWith('.pdf')) return safe + '.pdf';
  return safe || 'reporte.pdf';
}

function _sanitizePdfOutputPath(outputPath, fallbackFilename) {
  if (typeof outputPath !== 'string' || !outputPath.trim()) return null;
  const resolved = path.resolve(outputPath);
  const dir = path.dirname(resolved);
  if (!_isUnderAllowedPdfWriteDir(dir)) {
    throw new Error(
      'La ruta de salida del PDF no está permitida. Elige una carpeta con el diálogo de guardado o usa Documentos/Descargas.',
    );
  }
  const safeName = _sanitizeFilename(path.basename(resolved) || fallbackFilename);
  return path.join(dir, safeName);
}

function _assertSafePdfOutputPath(outputPath) {
  const resolved = path.resolve(outputPath);
  const dir = path.dirname(resolved);
  const realDir = fs.realpathSync(dir);

  if (!_isUnderAllowedPdfWriteDir(realDir)) {
    throw new Error('La ruta de salida del PDF no está permitida: symlink no permitido en ruta de salida');
  }
  if (path.normalize(realDir).toLowerCase() !== path.normalize(dir).toLowerCase()) {
    throw new Error('La ruta de salida del PDF no está permitida: symlink no permitido en ruta de salida');
  }

  if (fs.existsSync(resolved)) {
    if (fs.lstatSync(resolved).isSymbolicLink()) {
      throw new Error('La ruta de salida del PDF no está permitida: symlink no permitido en ruta de salida');
    }
    const realFile = fs.realpathSync(resolved);
    if (
      path.normalize(realFile).toLowerCase() !== path.normalize(resolved).toLowerCase()
      || !isPathInside(realDir, realFile)
    ) {
      throw new Error('La ruta de salida del PDF no está permitida: symlink no permitido en ruta de salida');
    }
  }
}

module.exports = {
  _allowedWriteRoots,
  _loadPersistedWriteRoots,
  _registerWriteRootFromPath,
  _isUnderAllowedPdfWriteDir,
  _sanitizeFilename,
  _sanitizePdfOutputPath,
  _assertSafePdfOutputPath,
  _clearAllowedWriteRoots: () => _allowedWriteRoots.clear(),
};
