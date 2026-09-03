const fs = require('fs');
const path = require('path');

const _allowedReadPaths = new Set();

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

function registerAllowedReadPath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim() || rawPath.includes('\0')) return;
  if (!path.isAbsolute(rawPath)) return;
  const resolved = path.resolve(rawPath);
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
  isAllowedReadPath,
  clearAllowedReadPaths,
};
