const path = require('path');

function getBackendCommand(isDev, platform, dir) {
  if (isDev) {
    const script = dir ? path.join(dir, '..', 'backend', 'main.py') : null;

    if (dir) {
      const venvPy = platform === 'win32'
        ? path.join(dir, '..', 'venv312', 'Scripts', 'python.exe')
        : path.join(dir, '..', 'venv312', 'bin', 'python');
      if (require('fs').existsSync(venvPy)) {
        return { cmd: venvPy, args: script ? [script] : [] };
      }
    }

    const systemCmds = ['python3', 'python'];
    for (const cmd of systemCmds) {
      try {
        require('child_process').execSync(`${cmd} --version`, { stdio: 'ignore' });
        return { cmd, args: script ? [script] : [] };
      } catch {}
    }

    return { cmd: 'python', args: script ? [script] : [] };
  }
  
  const exeName = platform === 'win32'
    ? 'AntaresBackend.exe'
    : 'AntaresBackend';
  
  const resourcesPath = typeof process !== 'undefined' && process.resourcesPath 
    ? process.resourcesPath 
    : path.join(__dirname, '..', 'dist');
    
  const exePath = path.join(resourcesPath, 'backend', exeName);
  
  return { cmd: exePath, args: [] };
}

module.exports = { getBackendCommand };
