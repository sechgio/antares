const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { verifyFrozenBackendTemplates } = require('./verify-frozen-backend');

const projectRoot = path.resolve(__dirname, '..');
const backendDir = path.join(projectRoot, 'backend');
const distDir = path.join(projectRoot, 'dist');
const distBackendDir = path.join(distDir, 'backend');
const specFile = path.join(backendDir, 'backend.spec');
const pyInstallerBuild = path.join(backendDir, 'build');
const pyInstallerDist = path.join(backendDir, 'dist');
const backendFolderName = 'AntaresBackend';
const backendExeName = 'AntaresBackend.exe';
const staleBackendNames = [backendExeName, 'HidroConvertBackend.exe', backendFolderName];

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

function copyDirFlat(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.cpSync(from, to, { recursive: true });
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

function moveOrCopyDir(src, dest) {
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
  } catch {
    copyDirFlat(src, dest);
  }
}

function directorySizeBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directorySizeBytes(p);
    else total += fs.statSync(p).size;
  }
  return total;
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
  console.log(`[build-backend] Building Python backend with PyInstaller onedir (${pythonCmd})...`);

  removePath(pyInstallerBuild);
  removePath(pyInstallerDist);
  removePath(distBackendDir);
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

    const pyInstallerFolder = path.join(pyInstallerDist, backendFolderName);
    const pyInstallerExe = path.join(pyInstallerFolder, backendExeName);
    if (!fs.existsSync(pyInstallerExe)) {
      throw new Error(`${backendExeName} not found in ${pyInstallerFolder}`);
    }

    // Flat layout: resources/backend/AntaresBackend.exe (+ deps beside it).
    moveOrCopyDir(pyInstallerFolder, distBackendDir);
    const targetExe = path.join(distBackendDir, backendExeName);
    if (!fs.existsSync(targetExe)) {
      throw new Error(`${backendExeName} missing after copy to ${distBackendDir}`);
    }

    const sizeMb = directorySizeBytes(distBackendDir) / (1024 * 1024);
    console.log(`[build-backend] Backend onedir copied to ${distBackendDir} (${sizeMb.toFixed(1)} MB)`);
    // Guard: ML stacks accidentally pulled in produce multi-GB trees.
    const MAX_BACKEND_MB = 450;
    if (sizeMb > MAX_BACKEND_MB) {
      throw new Error(
        `Backend onedir is ${sizeMb.toFixed(1)} MB (limit ${MAX_BACKEND_MB} MB). ` +
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
