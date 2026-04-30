const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');
const backendDir = path.join(projectRoot, 'backend');
const distDir = path.join(projectRoot, 'dist');
const specFile = path.join(backendDir, 'backend.spec');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

console.log('[build-backend] Building Python backend with PyInstaller...');

try {
  const result = execSync(
    `python -m PyInstaller "${specFile}" --noconfirm`,
    {
      cwd: backendDir,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    }
  );
  // PyInstaller puts output in backend/dist by default; move to project dist
  const pyInstallerDist = path.join(backendDir, 'dist');
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
