#!/usr/bin/env node


const fs = require('fs');
const path = require('path');
const {
  REPO_OWNER,
  REPO_NAME,
  ROOT,
  sh,
  trySh,
  shDetailed,
  step,
  skip,
  die,
} = require('./lib/loop-utils');

function validateEnvironment({ refreshRemote = true } = {}) {
  const ghStatus = trySh('gh auth status 2>&1', { silent: true });
  if (!ghStatus) {
    throw new Error('GitHub CLI (gh) no está autenticado. Corre: gh auth login');
  }

  const remoteUrl = trySh('git remote get-url origin', { silent: true });
  if (!remoteUrl || !remoteUrl.includes(`${REPO_OWNER}/${REPO_NAME}`)) {
    throw new Error(
      `Remote origin debe apuntar a ${REPO_OWNER}/${REPO_NAME}, actual: ${remoteUrl || '(sin remote)'}`
    );
  }

  const branch = sh('git rev-parse --abbrev-ref HEAD', { silent: true });
  if (branch !== 'main') {
    throw new Error(`Debes estar en main (actual: ${branch}). Los releases solo desde main.`);
  }

  const status = sh('git status --porcelain', { silent: true });
  if (status) {
    throw new Error('El working tree no está limpio. Commit o stash tus cambios primero.');
  }

  if (refreshRemote) {
    sh('git fetch origin main 2>&1', { silent: true });
    const [ahead, behind] = sh('git rev-list --left-right --count HEAD...origin/main', { silent: true })
      .split(/\s+/)
      .map(Number);
    if (ahead !== 0 || behind !== 0) {
      throw new Error(
        `HEAD debe coincidir exactamente con origin/main (ahead=${ahead}, behind=${behind}).`
      );
    }
    return;
  }

  sh('git fetch --dry-run origin main 2>&1', { silent: true });
  const remoteHead = sh('git ls-remote origin refs/heads/main', { silent: true })
    .split(/\s+/)[0];
  const head = sh('git rev-parse HEAD', { silent: true });
  if (remoteHead && remoteHead !== head) {
    throw new Error(
      `HEAD debe coincidir exactamente con origin/main (HEAD=${head}, origin/main=${remoteHead}).`
    );
  }
}

function detectVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Versión inválida en package.json: "${version}". Debe ser semver (X.Y.Z).`);
  }

  const existingTag = sh(`git tag -l "v${version}"`, { silent: true });
  if (existingTag) {
    throw new Error(`El tag v${version} ya existe localmente. Bump la versión primero.`);
  }

  const remoteTag = sh(`git ls-remote --tags origin "v${version}"`, { silent: true });
  if (remoteTag) {
    throw new Error(`El tag v${version} ya existe en origin. Bump la versión primero.`);
  }

  const releaseCheck = shDetailed(
    `gh release view "v${version}" --json tagName 2>&1`,
    { silent: true }
  );
  if (!releaseCheck.ok && !/release not found/i.test(releaseCheck.output)) {
    throw new Error(
      `No se pudo verificar si existe el release v${version}: ${releaseCheck.output || 'gh falló.'}`
    );
  }
  if (releaseCheck.ok && releaseCheck.output) {
    throw new Error(`El release v${version} ya existe en GitHub.`);
  }

  return version;
}

function validateChangelog(version) {
  const changelogPath = path.join(ROOT, 'CHANGELOG.md');
  if (!fs.existsSync(changelogPath)) {
    throw new Error('CHANGELOG.md no existe. Créalo primero.');
  }

  const content = fs.readFileSync(changelogPath, 'utf8');
  const headerRegex = new RegExp(`## \\[${version.replace(/\./g, '\\.')}\\]\\s*—\\s*\\d{4}-\\d{2}-\\d{2}`);
  const match = content.match(headerRegex);

  if (!match) {
    throw new Error(
      `CHANGELOG.md no tiene entrada para [${version}] con fecha (YYYY-MM-DD).\n` +
      `  Agrega: ## [${version}] — YYYY-MM-DD\n\n` +
      `  ### Added | Changed | Fixed | Removed | Security\n` +
      `  - descripción de cambios`
    );
  }

  const startIndex = match.index + match[0].length;
  const remaining = content.slice(startIndex);
  const nextHeader = remaining.match(/\n##\s+\[/);
  const entryContent = nextHeader
    ? remaining.slice(0, nextHeader.index)
    : remaining;

  if (!/###\s+(Added|Changed|Deprecated|Removed|Fixed|Security)/.test(entryContent)) {
    throw new Error(
      `La entrada de CHANGELOG para [${version}] no tiene secciones.\n` +
      `  Debe incluir al menos una de: ### Added, ### Changed, ### Fixed, etc.`
    );
  }
}

function runQualityGate() {
  console.log('');
  sh('npm run ci 2>&1', { silent: true });
}

function runBuild() {
  const backendBuild = trySh('npm run build:backend 2>&1', { silent: true, timeout: 300000 });
  if (backendBuild === null) {
    throw new Error('Build del backend falló (timeout o error).');
  }
  if (!fs.existsSync(path.join(ROOT, 'dist', 'backend', 'AntaresBackend.exe'))) {
    throw new Error('Build del backend no produjo dist/backend/AntaresBackend.exe');
  }

  const frontendBuild = trySh('npm run build:frontend 2>&1', { silent: true, timeout: 120000 });
  if (frontendBuild === null) {
    throw new Error('Build del frontend falló (timeout o error).');
  }
  if (!fs.existsSync(path.join(ROOT, 'frontend', 'dist'))) {
    throw new Error('Build del frontend no produjo dist/');
  }
}

function createGitTag(version) {
  sh(`git tag -a v${version} -m "Release v${version}"`, { silent: true });
  console.log(`    Tag anotado v${version} creado.`);
}

function pushTag(version) {
  sh(`git push origin v${version}`, { silent: true });
  console.log(`    Tag v${version} pusheado a origin.`);
}

function main() {
  const args = process.argv.slice(2);
  const isShip = args.includes('--ship');
  const doBuild = args.includes('--build');

  const mode = isShip ? '🚀 SHIP MODE (real)' : '🔍 DRY-RUN (sin side effects)';
  console.log(`\n════════════════════════════════════════════`);
  console.log(`  Antares Release Pipeline Loop`);
  console.log(`  ${mode}`);
  console.log(`════════════════════════════════════════════\n`);

  try {
    runReleaseLoop(isShip, doBuild);
  } catch (err) {
    die(err.message || 'Release loop falló.', err.code || 1);
  }
}

function runReleaseLoop(isShip, doBuild) {
  step(
    '① Entorno (gh auth, remote, branch, clean, up-to-date)',
    () => validateEnvironment({ refreshRemote: isShip }),
  );

  let version;
  step('② Detectar versión', () => {
    version = detectVersion();
    console.log(`    Versión: ${version}`);
  });

  step('③ Validar CHANGELOG.md', () => validateChangelog(version));

  step('④ Quality Gate (lint + typecheck + test + audit)', runQualityGate);

  if (doBuild) {
    step('⑤ Build local (backend + frontend)', runBuild);
  } else {
    skip('⑤ Build local', 'omitido, usa --build para incluir');
  }

  if (isShip) {
    step('⑥ Crear git tag', () => createGitTag(version));
  } else {
    skip('⑥ Crear git tag', 'dry-run, usa --ship para ejecutar');
  }

  if (isShip) {
    step('⑦ Push tag a origin', () => pushTag(version));
  } else {
    skip('⑦ Push tag a origin', 'dry-run, usa --ship para ejecutar');
  }

  console.log(`\n════════════════════════════════════════════`);
  if (isShip) {
    console.log(`  ✅ Tag v${version} enviado.`);
    console.log(`  GitHub Actions validará, construirá y publicará la release.`);
    console.log(`  ⏳ Revisa: https://github.com/${REPO_OWNER}/${REPO_NAME}/actions`);
  } else {
    console.log(`  ✅ Dry-run: todas las validaciones pasaron.`);
    console.log(`  Para hacer el release real:`);
    console.log(`    node scripts/release-loop.js --ship`);
  }
  console.log(`════════════════════════════════════════════\n`);
}

main();
