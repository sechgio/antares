const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');
const backendDir = path.join(projectRoot, 'backend');
const distDir = path.join(projectRoot, 'dist');
const specFile = path.join(backendDir, 'backend.spec');
const pyInstallerBuild = path.join(backendDir, 'build');
const pyInstallerDist = path.join(backendDir, 'dist');
const staleBackendNames = ['CosmoBackend.exe', 'HidroConvertBackend.exe'];

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

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

console.log('[build-backend] Building Python backend with PyInstaller...');

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
  // PyInstaller puts output in backend/dist by default; move to project dist
  const pyInstallerExe = path.join(pyInstallerDist, 'CosmoBackend.exe');
  const targetExe = path.join(distDir, 'CosmoBackend.exe');

  if (fs.existsSync(pyInstallerExe)) {
    fs.copyFileSync(pyInstallerExe, targetExe);
    console.log(`[build-backend] Backend executable copied to ${targetExe}`);
  } else {
    console.warn('[build-backend] Warning: CosmoBackend.exe not found in expected location');
  }
  console.log('[build-backend] Backend build completed.');
} catch (err) {
  console.error('[build-backend] Failed to build backend:', err.message);
  process.exit(1);
}
