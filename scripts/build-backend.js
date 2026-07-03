const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

console.log('[build-backend] Building Python backend with PyInstaller...');

let failed = false;
try {
  removePath(pyInstallerBuild);
  removePath(pyInstallerDist);
  for (const staleName of staleBackendNames) {
    removePath(path.join(distDir, staleName));
  }

  execSync(
    `python -m PyInstaller "${specFile}" --noconfirm`,
    {
      cwd: backendDir,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' }
    }
  );
  const pyInstallerExe = path.join(pyInstallerDist, backendExeName);
  const targetExe = path.join(distDir, backendExeName);

  if (!fs.existsSync(pyInstallerExe)) {
    throw new Error(`${backendExeName} not found in ${pyInstallerDist}`);
  }
  fs.copyFileSync(pyInstallerExe, targetExe);
  console.log(`[build-backend] Backend executable copied to ${targetExe}`);
  console.log('[build-backend] Backend build completed.');
} catch (err) {
  console.error('[build-backend] Failed to build backend:', err.message);
  failed = true;
} finally {
  removePath(pyInstallerBuild);
  removePath(pyInstallerDist);
}

if (failed) {
  process.exit(1);
}
