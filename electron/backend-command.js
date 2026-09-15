const path = require('path');

function getBackendCommand(isDev, platform, dir) {
  if (isDev) {
    const script = dir ? path.join(dir, '..', 'backend', 'main.py') : null;

    if (dir) {
      const venvBin = platform === 'win32'
        ? ['Scripts', 'python.exe']
        : ['bin', 'python'];
      for (const venvName of ['.venv', 'venv312']) {
        const venvPy = path.join(dir, '..', venvName, ...venvBin);
        if (require('fs').existsSync(venvPy)) {
          return { cmd: venvPy, args: script ? [script] : [] };
        }
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
