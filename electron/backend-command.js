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
    const pythonPaths = [];
    
    if (dir) {
      if (platform === 'win32') {
        pythonPaths.push(path.join(dir, '..', 'venv312', 'Scripts', 'python.exe'));
      } else {
        pythonPaths.push(path.join(dir, '..', 'venv312', 'bin', 'python'));
      }
    }
    
    pythonPaths.push('python3', 'python');
    
    const script = dir ? path.join(dir, '..', 'backend', 'main.py') : null;
    
    // Return first valid path (validation happens in startPythonBackend)
    return { cmd: pythonPaths[0], args: script ? [script] : [] };
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
