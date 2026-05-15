// electron/backend-command.js
// Platform-independent backend command resolution
// This module has no Electron dependencies and is fully testable

const path = require('path');

/**
 * Get the backend command configuration
 * @param {boolean} isDev - Whether running in development mode
 * @param {string} platform - The OS platform (e.g., 'win32', 'linux', 'darwin')
 * @param {string} [dir] - Optional __dirname (for resolving relative paths in main.js)
 * @returns {{ cmd: string, args: string[] }}
 */
function getBackendCommand(isDev, platform, dir) {
  if (isDev) {
    const script = dir ? path.join(dir, '..', 'backend', 'main.py') : null;

    // Check venv first, fall back to system python silently
    if (dir) {
      const venvPy = platform === 'win32'
        ? path.join(dir, '..', 'venv312', 'Scripts', 'python.exe')
        : path.join(dir, '..', 'venv312', 'bin', 'python');
      if (require('fs').existsSync(venvPy)) {
        return { cmd: venvPy, args: script ? [script] : [] };
      }
    }

    // System python fallback
    const systemCmds = ['python3', 'python'];
    for (const cmd of systemCmds) {
      try {
        require('child_process').execSync(`${cmd} --version`, { stdio: 'ignore' });
        return { cmd, args: script ? [script] : [] };
      } catch { /* try next */ }
    }

    // Last resort: return python and let the spawner fail with a clear error
    return { cmd: 'python', args: script ? [script] : [] };
  }
  
  const exeName = platform === 'win32'
    ? 'AntaresBackend.exe'
    : 'AntaresBackend';
  
  // In production, resourcesPath would be provided; for testing, use a default
  const resourcesPath = typeof process !== 'undefined' && process.resourcesPath 
    ? process.resourcesPath 
    : path.join(__dirname, '..', 'dist');
    
  const exePath = path.join(resourcesPath, 'backend', exeName);
  
  return { cmd: exePath, args: [] };
}

module.exports = { getBackendCommand };
