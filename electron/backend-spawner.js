/**
 * Python backend process lifecycle: spawn, handshake, kill.
 */
const { dialog } = require('electron');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { getBackendCommand } = require('./backend-command');

let pythonProcess = null;

function getProcess() { return pythonProcess; }

async function startPythonBackend(isDev, attempt = 1) {
  try {
    await _spawn(isDev);
  } catch (err) {
    console.error(`Backend start attempt ${attempt} failed:`, err.message);
    if (attempt >= 3) {
      dialog.showErrorBox('Error de inicio', 'El backend no pudo iniciar después de 3 intentos. Intenta reiniciar la aplicación.');
      const { app } = require('electron');
      app.quit();
      return;
    }
    await new Promise(r => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
    return startPythonBackend(isDev, attempt + 1);
  }
}

function _spawn(isDev) {
  let { cmd, args } = getBackendCommand(isDev, process.platform, __dirname);

  if (!isDev) {
    if (!fs.existsSync(cmd)) throw new Error(`Backend executable not found: ${cmd}`);
  } else {
    if (!fs.existsSync(cmd)) {
      console.warn(`Venv Python not found at ${cmd}, trying system python...`);
      const systemPython = process.platform === 'win32' ? 'python.exe' : 'python3';
      cmd = systemPython;
      try { execSync(`${cmd} --version`, { stdio: 'ignore' }); } catch {
        throw new Error(`Python no encontrado: ni el entorno virtual ni Python del sistema están disponibles.`);
      }
    }
  }

  pythonProcess = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });

  pythonProcess.stderr.on('data', (data) => console.error('[Python]', data.toString().trim()));
  pythonProcess.stdin.on('error', (err) => console.error('[Python stdin error]', err.message));

  pythonProcess.on('close', (code) => {
    console.log(`Python backend exited with code ${code}`);
    pythonProcess = null;
  });

  pythonProcess.on('error', (err) => {
    console.error('Failed to start Python backend:', err);
    const msg = err.code === 'ENOENT'
      ? `Python no encontrado: verifica que el entorno virtual o Python del sistema esté instalado.\n${err.message}`
      : `No se pudo iniciar el backend Python:\n${err.message}`;
    dialog.showErrorBox('Backend Error', msg);
    const { app } = require('electron');
    app.quit();
  });

  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.method === 'ready') {
            pythonProcess.stdout.off('data', onData);
            resolve();
            return;
          }
        } catch { /* Not JSON */ }
      }
    };
    pythonProcess.stdout.on('data', onData);
    setTimeout(() => {
      pythonProcess?.stdout.off('data', onData);
      if (pythonProcess && !pythonProcess.killed) pythonProcess.kill();
      reject(new Error('Python backend timeout'));
    }, 30000);
  });
}

function killPython() {
  if (pythonProcess && !pythonProcess.killed) {
    try { pythonProcess.stdin.end(); } catch {}
    pythonProcess.kill();
  }
}

module.exports = { startPythonBackend, getProcess, killPython };
