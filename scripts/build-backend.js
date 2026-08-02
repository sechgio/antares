const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { verifyFrozenBackendTemplates } = require('./verify-frozen-backend');

const projectRoot = path.resolve(__dirname, '..');
const backendDir = path.join(projectRoot, 'backend');
const distDir = path.join(projectRoot, 'dist');
const specFile = path.join(backendDir, 'backend.spec');
const pyInstallerBuild = path.join(backendDir, 'build');
const pyInstallerDist = path.join(backendDir, 'dist');
const backendExeName = 'AntaresBackend.exe';
const staleBackendNames = [backendExeName, 'HidroConvertBackend.exe'];

if (process.platform !== 'win32') {
  console.error('[build-backend] Antares only ships a Windows installer. Run this build on Windows.');
  process.exit(1);
}

function assertInsideProject(targetPath) {
  const relative = path.relative(projectRoot, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean path outside project: ${targetPath}`);
  }
}

function removePath(targetPath) {
  assertInsideProject(targetPath);
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function resolvePythonCommand() {
  const venvPy = path.join(projectRoot, 'venv312', 'Scripts', 'python.exe');
  if (fs.existsSync(venvPy)) {
    return venvPy;
  }
  return 'python';
}

async function main() {
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const pythonCmd = resolvePythonCommand();
  console.log(`[build-backend] Building Python backend with PyInstaller (${pythonCmd})...`);

  removePath(pyInstallerBuild);
  removePath(pyInstallerDist);
  for (const staleName of staleBackendNames) {
    removePath(path.join(distDir, staleName));
  }

  try {
    execSync(
      `"${pythonCmd}" -m PyInstaller "${specFile}" --noconfirm`,
      {
        cwd: backendDir,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
      },
    );
    const pyInstallerExe = path.join(pyInstallerDist, backendExeName);
    const targetExe = path.join(distDir, backendExeName);

    if (!fs.existsSync(pyInstallerExe)) {
      throw new Error(`${backendExeName} not found in ${pyInstallerDist}`);
    }
    fs.copyFileSync(pyInstallerExe, targetExe);
    const sizeMb = fs.statSync(targetExe).size / (1024 * 1024);
    console.log(`[build-backend] Backend executable copied to ${targetExe} (${sizeMb.toFixed(1)} MB)`);
    // Guard: ML stacks (torch/tensorflow) accidentally pulled into the onefile
    // archive produce multi-GB binaries that miss the Electron handshake window.
    const MAX_BACKEND_MB = 450;
    if (sizeMb > MAX_BACKEND_MB) {
      throw new Error(
        `${backendExeName} is ${sizeMb.toFixed(1)} MB (limit ${MAX_BACKEND_MB} MB). ` +
        'PyInstaller likely bundled unrelated ML packages — check backend.spec excludes.',
      );
    }

    await verifyFrozenBackendTemplates(targetExe);
    console.log('[build-backend] Backend build completed.');
  } finally {
    removePath(pyInstallerBuild);
    removePath(pyInstallerDist);
  }
}

main().catch((err) => {
  console.error('[build-backend] Failed to build backend:', err.message);
  process.exit(1);
});
