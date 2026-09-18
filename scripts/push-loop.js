#!/usr/bin/env node

const {
  REPO_OWNER,
  REPO_NAME,
  BASE_BRANCH,
  sh,
  trySh,
  gh,
  parseLoopArgs,
  printLoopBanner,
  shipStep,
  step,
  die,
  requireGhAuth,
  requireOriginRepo,
  currentBranch,
  workingTreeDirty,
  findOpenPrNumber,
  mergePr,
  commitAll,
  pushBranch,
  runQualityCommand,
  runQualityGate,
} = require('./lib/loop-utils');

function parseArgs(argv) {
  const parsed = parseLoopArgs(argv);
  return {
    isShip: parsed.isShip,
    doMerge: parsed.doMerge,
    message: parsed.value('--message'),
    title: parsed.value('--title'),
    branch: parsed.value('--branch'),
  };
}

function validateEnvironment() {
  requireGhAuth();
  requireOriginRepo();
  sh('git fetch origin 2>&1');
}

function slugifyBranchName(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'change';
}

function defaultBranchName(message) {
  const prefix = message?.split(':')[0]?.trim() || 'change';
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `${slugifyBranchName(prefix)}/${stamp}`;
}

function ensureFeatureBranch(options) {
  let branch = currentBranch();

  if (branch === BASE_BRANCH) {
    if (!options.isShip) {
      throw new Error(
        `Estás en ${BASE_BRANCH}. En ship mode se creará una branch automáticamente; ` +
        `usa --branch <nombre> para elegirla.`
      );
    }

    const targetBranch = options.branch || defaultBranchName(options.message);
    sh(`git checkout -b "${targetBranch}"`);
    branch = targetBranch;
    console.log(`    Branch creada: ${branch}`);
  } else if (options.branch && options.branch !== branch) {
    throw new Error(
      `Ya estás en "${branch}" pero pediste --branch "${options.branch}". ` +
      'Cambia de branch manualmente o omite --branch.'
    );
  }

  if (branch === BASE_BRANCH) {
    throw new Error(`No se puede pushear directamente a ${BASE_BRANCH}. Usa una feature branch.`);
  }

  return branch;
}

function commitChanges(message) {
  if (!workingTreeDirty()) {
    console.log('    Working tree limpio, sin commit.');
    return false;
  }

  if (!message) {
    throw new Error('Hay cambios sin commit. Pasa --message "tipo: descripción".');
  }

  commitAll(message);
  return true;
}

function createOrUpdatePr(branch, title, body) {
  const existing = findOpenPrNumber(branch);
  if (existing) {
    gh(['pr', 'edit', String(existing), '--title', title, '--body', body]);
    console.log(`    PR #${existing} actualizado.`);
    return existing;
  }

  const url = gh([
    'pr', 'create',
    '--base', BASE_BRANCH,
    '--head', branch,
    '--title', title,
    '--body', body,
  ]);
  const match = url.match(/\/pull\/(\d+)/);
  const number = match ? Number(match[1]) : null;
  console.log(`    PR creado: ${url}`);
  return number;
}

function waitForCi(prNumber) {
  console.log('    Esperando checks de CI...');
  const result = trySh(`gh pr checks ${prNumber} --watch --interval 10 2>&1`, { timeout: 900000 });
  if (result === null) {
    throw new Error(`Timeout esperando CI del PR #${prNumber}.`);
  }
  if (/fail/i.test(result)) {
    throw new Error(`CI falló en PR #${prNumber}:\n${result.slice(-500)}`);
  }
  console.log('    CI pasó.');
}

function defaultPrBody(branch, message) {
  return [
    '## Summary',
    message || `- Cambios en branch \`${branch}\``,
    '',
    '## Test plan',
    '- [x] `npm run lint:python`',
    '- [x] `npm run typecheck:backend`',
    '- [x] `npm run typecheck:frontend`',
    '- [x] `npm test`',
  ].join('\n');
}

function main() {
  const options = parseArgs(process.argv);
  printLoopBanner('Antares Push Pipeline Loop (PR-first)', options.isShip, 'PR real');

  try {
    step('① Entorno (gh auth, remote, fetch)', validateEnvironment);

    let branch;
    step('② Branch de trabajo (≠ main)', () => {
      branch = ensureFeatureBranch(options);
      console.log(`    Branch: ${branch}`);
    });

    step('③ Quality Gate (lint + typecheck + test)', runQualityGate);

    let prNumber;
    shipStep('④ Commit cambios locales', options.isShip, () => {
      commitChanges(options.message);
    }, 'dry-run, usa --ship para ejecutar');
    shipStep('⑤ Push branch a origin', options.isShip, () => {
      pushBranch(branch);
    }, 'dry-run, usa --ship para ejecutar');
    shipStep('⑥ Crear/actualizar Pull Request', options.isShip, () => {
      const title = options.title || options.message || branch;
      const body = defaultPrBody(branch, options.message);
      prNumber = createOrUpdatePr(branch, title, body);
    }, 'dry-run, usa --ship para ejecutar');

    const canMerge = options.isShip && options.doMerge;
    const mergeSkip = options.isShip ? 'omitido, usa --merge para incluir' : 'dry-run, usa --ship --merge para ejecutar';
    shipStep('⑦ Esperar CI', canMerge, () => {
      if (!prNumber) {
        throw new Error('No se pudo resolver el número de PR para mergear.');
      }
      waitForCi(prNumber);
    }, mergeSkip);
    shipStep('⑧ Merge PR a main', canMerge, () => mergePr(prNumber), mergeSkip);

    console.log('\n════════════════════════════════════════════');
    if (options.isShip) {
      console.log(`  ✅ Cambios enviados vía PR desde ${branch}.`);
      console.log(`  Revisa: https://github.com/${REPO_OWNER}/${REPO_NAME}/pulls`);
    } else {
      console.log('  ✅ Dry-run: todas las validaciones pasaron.');
      console.log('  Para enviar vía PR:');
      console.log('    node scripts/push-loop.js --ship --message "fix: descripción"');
    }
    console.log('════════════════════════════════════════════\n');
  } catch (err) {
    die(err.message || 'Push loop falló.', err.code || 1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runQualityCommand };
