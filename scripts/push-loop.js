#!/usr/bin/env node

/**
 * Antares Push Pipeline Loop (PR-first)
 * ======================================
 *
 * Flujo para enviar cambios siempre mediante Pull Request — nunca push directo a main.
 *
 * Flags:
 *   (ninguno)  = dry-run — valida todo, sin side effects
 *   --ship     = commit (si hay cambios), push branch, crear/actualizar PR
 *   --merge    = tras crear PR, esperar CI y mergear (requiere --ship)
 *   --message  = mensaje de commit (obligatorio si hay cambios sin commit)
 *   --title    = título del PR (default: branch name o commit message)
 *   --branch   = nombre de branch (si estás en main, se crea esta branch)
 *
 * Uso:
 *   node scripts/push-loop.js
 *   node scripts/push-loop.js --ship --message "fix: corregir conversión HEIC"
 *   node scripts/push-loop.js --ship --merge --message "feat: nueva opción de export"
 */

const { execFileSync } = require('child_process');
const {
  REPO_OWNER,
  REPO_NAME,
  BASE_BRANCH,
  ROOT,
  sh,
  trySh,
  step,
  skip,
  die,
} = require('./lib/loop-utils');

function parseArgs(argv) {
  const args = argv.slice(2);
  const getFlagValue = (flag) => {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    return args[idx + 1] || null;
  };

  return {
    isShip: args.includes('--ship'),
    doMerge: args.includes('--merge'),
    message: getFlagValue('--message'),
    title: getFlagValue('--title'),
    branch: getFlagValue('--branch'),
  };
}

function validateEnvironment() {
  const ghStatus = trySh('gh auth status 2>&1');
  if (!ghStatus) {
    throw new Error('GitHub CLI (gh) no está autenticado. Corre: gh auth login');
  }

  const remoteUrl = trySh('git remote get-url origin');
  if (!remoteUrl || !remoteUrl.includes(`${REPO_OWNER}/${REPO_NAME}`)) {
    throw new Error(
      `Remote origin debe apuntar a ${REPO_OWNER}/${REPO_NAME}, actual: ${remoteUrl || '(sin remote)'}`
    );
  }

  sh('git fetch origin 2>&1');
}

function currentBranch() {
  return sh('git rev-parse --abbrev-ref HEAD');
}

function workingTreeDirty() {
  return Boolean(sh('git status --porcelain'));
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

function runQualityGate() {
  console.log('');
  const lintResult = trySh('npm run lint:python 2>&1');
  if (lintResult && lintResult.includes('error')) {
    const lintLines = lintResult.split('\n').filter((l) => l.includes('error')).length;
    if (lintLines > 0) {
      throw new Error(`Lint de Python falló:\n${lintResult.slice(0, 500)}`);
    }
  }

  const tcBackend = trySh('npm run typecheck:backend 2>&1');
  if (tcBackend && (tcBackend.includes('error') || tcBackend.includes('Error'))) {
    throw new Error(`Typecheck de backend falló:\n${tcBackend.slice(0, 500)}`);
  }

  const tcFrontend = trySh('npm run typecheck:frontend 2>&1');
  if (tcFrontend && (tcFrontend.includes('error') || tcFrontend.includes('Error'))) {
    throw new Error(`Typecheck de frontend falló:\n${tcFrontend.slice(0, 500)}`);
  }

  const budgets = trySh('npm run check:budgets 2>&1');
  if (budgets === null) {
    throw new Error('Budgets fallaron (timeout o error).');
  }
  if (budgets.includes('RED:')) {
    throw new Error(`Budgets fallaron:\n${budgets.slice(0, 800)}`);
  }

  const testResult = trySh('npm test 2>&1', { timeout: 900000 });
  if (testResult === null) {
    throw new Error('Tests fallaron (timeout o error).');
  }

  const failurePattern = /(?:Test Files|Tests)\s+\d+\s+failed/;
  if (failurePattern.test(testResult)) {
    throw new Error(`Tests fallaron.\n${testResult.slice(-500)}`);
  }
  if (testResult.includes('FAILED') && !testResult.includes('PASSED')) {
    throw new Error(`Tests fallaron.\n${testResult.slice(-500)}`);
  }
}

function runGit(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function runGh(args) {
  return execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function commitChanges(message) {
  if (!workingTreeDirty()) {
    console.log('    Working tree limpio, sin commit.');
    return false;
  }

  if (!message) {
    throw new Error('Hay cambios sin commit. Pasa --message "tipo: descripción".');
  }

  runGit(['add', '-A']);
  runGit(['commit', '-m', message]);
  console.log(`    Commit creado: ${message}`);
  return true;
}

function pushBranch(branch) {
  const upstream = trySh(`git rev-parse --abbrev-ref "${branch}@{upstream}" 2>&1`);
  if (upstream && !upstream.includes('fatal')) {
    sh(`git push origin "${branch}"`);
  } else {
    sh(`git push -u origin "${branch}"`);
  }
  console.log(`    Branch ${branch} pusheada a origin.`);
}

function findOpenPrNumber(branch) {
  const json = trySh(
    `gh pr list --head "${branch}" --base "${BASE_BRANCH}" --state open --json number --jq ".[0].number" 2>&1`
  );
  if (!json || json.includes('error') || json === 'null') return null;
  const num = Number(json);
  return Number.isFinite(num) ? num : null;
}

function createOrUpdatePr(branch, title, body) {
  const existing = findOpenPrNumber(branch);
  if (existing) {
    runGh(['pr', 'edit', String(existing), '--title', title, '--body', body]);
    console.log(`    PR #${existing} actualizado.`);
    return existing;
  }

  const url = runGh([
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

function mergePr(prNumber) {
  sh(`gh pr merge ${prNumber} --merge --delete-branch`);
  console.log(`    PR #${prNumber} mergeado a ${BASE_BRANCH}.`);
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
  const mode = options.isShip ? '🚀 SHIP MODE (PR real)' : '🔍 DRY-RUN (sin side effects)';

  console.log('\n════════════════════════════════════════════');
  console.log('  Antares Push Pipeline Loop (PR-first)');
  console.log(`  ${mode}`);
  console.log('════════════════════════════════════════════\n');

  try {
    step('① Entorno (gh auth, remote, fetch)', validateEnvironment);

    let branch;
    step('② Branch de trabajo (≠ main)', () => {
      branch = ensureFeatureBranch(options);
      console.log(`    Branch: ${branch}`);
    });

    step('③ Quality Gate (lint + typecheck + test)', runQualityGate);

    if (options.isShip) {
      step('④ Commit cambios locales', () => {
        commitChanges(options.message);
      });
      step('⑤ Push branch a origin', () => {
        pushBranch(branch);
      });

      let prNumber;
      step('⑥ Crear/actualizar Pull Request', () => {
        const title = options.title || options.message || branch;
        const body = defaultPrBody(branch, options.message);
        prNumber = createOrUpdatePr(branch, title, body);
      });

      if (options.doMerge) {
        if (!prNumber) {
          throw new Error('No se pudo resolver el número de PR para mergear.');
        }
        step('⑦ Esperar CI', () => waitForCi(prNumber));
        step('⑧ Merge PR a main', () => mergePr(prNumber));
      } else {
        skip('⑦ Esperar CI', 'omitido, usa --merge para incluir');
        skip('⑧ Merge PR a main', 'omitido, usa --merge para incluir');
      }
    } else {
      skip('④ Commit cambios locales', 'dry-run, usa --ship para ejecutar');
      skip('⑤ Push branch a origin', 'dry-run, usa --ship para ejecutar');
      skip('⑥ Crear/actualizar Pull Request', 'dry-run, usa --ship para ejecutar');
      skip('⑦ Esperar CI', 'dry-run, usa --ship --merge para ejecutar');
      skip('⑧ Merge PR a main', 'dry-run, usa --ship --merge para ejecutar');
    }

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

main();
