const fs = require('fs');
const path = require('path');

const _allowedReadPaths = new Set();
const MAX_ALLOWED_READ_PATHS = 1000;

function isPathInside(parent, child) {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  const rel = path.relative(resolvedParent, resolvedChild);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function assertPathNotSymlink(resolved) {
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw new Error('not a file');
  }
  if (stat.isSymbolicLink()) {
    throw new Error('symbolic links not allowed');
  }
  return stat;
}

function hasSymlinkAncestor(resolved) {
  let current = path.resolve(resolved);
  while (true) {
    const parent = path.dirname(current);
    if (parent === current) return false;
    try {
      if (fs.lstatSync(parent).isSymbolicLink()) return true;
    } catch (err) {
      // Missing ancestors are fine (the tree may not exist yet); anything else
      // means the path cannot be verified — fail closed.
      if (!err || err.code !== 'ENOENT') throw err;
    }
    current = parent;
  }
}

function registerAllowedReadPath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim() || rawPath.includes('\0')) return;
  if (!path.isAbsolute(rawPath)) return;
  const resolved = path.resolve(rawPath);
  if (_allowedReadPaths.size >= MAX_ALLOWED_READ_PATHS && !_allowedReadPaths.has(resolved)) {
    _allowedReadPaths.delete(_allowedReadPaths.keys().next().value);
  }
  _allowedReadPaths.add(resolved);
}

function registerAllowedReadPaths(paths) {
  if (!Array.isArray(paths)) return;
  for (const p of paths) registerAllowedReadPath(p);
}

function assertAllowedReadPath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    throw new Error('invalid path');
  }
  if (rawPath.includes('\0')) {
    throw new Error('invalid path');
  }
  if (!path.isAbsolute(rawPath)) {
    throw new Error('path must be absolute');
  }

  const resolved = path.resolve(rawPath);
  const stat = assertPathNotSymlink(resolved);
  if (!stat.isFile()) {
    throw new Error('not a file');
  }
  if (!_allowedReadPaths.has(resolved)) {
    throw new Error('path not allowed');
  }
  // A swapped symlink ancestor makes a registered lexical path resolve outside
  // the intended tree — the same policy write paths already enforce.
  if (hasSymlinkAncestor(resolved)) {
    throw new Error('symbolic links not allowed');
  }
  return resolved;
}

function isAllowedReadPath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim() || rawPath.includes('\0')) return false;
  if (!path.isAbsolute(rawPath)) return false;
  return _allowedReadPaths.has(path.resolve(rawPath));
}

function clearAllowedReadPaths() {
  _allowedReadPaths.clear();
}

module.exports = {
  isPathInside,
  registerAllowedReadPath,
  registerAllowedReadPaths,
  assertAllowedReadPath,
  assertPathNotSymlink,
  hasSymlinkAncestor,
  isAllowedReadPath,
  clearAllowedReadPaths,
};
