#!/usr/bin/env node

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

const MAX_ITER_DEFAULT = 5;
const SKIP_TAG = '[skip-ci-fix]';
const COMMIT_MSG = `fix(pr): auto-fix CI errors ${SKIP_TAG}`;

function parseArgs(argv) {
  const args = argv.slice(2);
  const getValue = (flag) => {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    const v = args[idx + 1];
    return v && !v.startsWith('--') ? v : null;
  };

  return {
    isShip: args.includes('--ship'),
    doMerge: args.includes('--merge'),
    prNumber: getValue('--pr'),
    maxIter: getValue('--max') ? Number(getValue('--max')) : MAX_ITER_DEFAULT,
  };
}

function currentBranch() {
  return sh('git rev-parse --abbrev-ref HEAD');
}

function findPrForBranch(branch) {
  const json = trySh(
    `gh pr list --head "${branch}" --base "${BASE_BRANCH}" --state open --json number --jq ".[0].number" 2>&1`
  );
  if (!json || json === 'null' || json.includes('error')) return null;
  const num = Number(json);
  return Number.isFinite(num) ? num : null;
}

function getPrInfo(prNumber) {
  const json = trySh(
    `gh pr view ${prNumber} --json headRefName,state,reviewDecision,mergeable,headRepository 2>&1`
  );
  if (!json || json.includes('error') || json.includes('not found')) {
    throw new Error(`No se pudo obtener info del PR #${prNumber}: ${json || '(sin respuesta)'}`);
  }
  try {
    return JSON.parse(json);
  } catch {
    throw new Error(`Respuesta invalida de gh pr view: ${json.slice(0, 200)}`);
  }
}

function getPrChecks(prNumber) {
  const json = trySh(`gh pr checks ${prNumber} --json name,state,bucket 2>&1`);
  if (!json || json === 'null' || json.includes('error')) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

function allChecksPass(checks) {
  if (!checks || checks.length === 0) return false;
  return checks.every((c) => c.bucket === 'PASS' || c.bucket === 'SKIP');
}

function anyCheckFails(checks) {
  return checks.some((c) => c.bucket === 'FAIL' || c.bucket === 'CANCEL');
}

function captureFailedRunLogs(prNumber) {
  const runsJson = trySh(
    `gh run list --branch "$(gh pr view ${prNumber} --json headRefName --jq .headRefName)" --status failure --limit 5 --json databaseId,name,status,conclusion 2>&1`
  );
  if (!runsJson || runsJson.includes('error')) return '(no se pudieron obtener runs fallidos)';
  let runs = [];
  try {
    runs = JSON.parse(runsJson);
  } catch {
    return '(respuesta invalida al listar runs)';
  }

  const logs = [];
  for (const run of runs.slice(0, 3)) {
    const runId = run.databaseId;
    const log = trySh(`gh run view ${runId} --log-failed 2>&1`, { timeout: 60000 });
    if (log) {
      logs.push(`--- Run ${run.name} (#${runId}) ---\n${log.slice(-2000)}`);
    }
  }
  return logs.join('\n\n') || '(no se capturaron logs)';
}

function applyPythonLintFix() {
  const fix = trySh('npm run lint:fix 2>&1');
  const fmt = trySh('npx ruff format backend tests scripts 2>&1');
  const touched = Boolean(trySh('git status --porcelain'));
  if (!touched) return null;
  return `ruff --fix + format:${(fix || '').slice(0, 200)}\n${(fmt || '').slice(0, 200)}`;
}

function applyFrontendPrettierFix() {
  const fmt = trySh('cd frontend && npx prettier --write src 2>&1');
  if (!fmt) return null;
  const touched = Boolean(trySh('git status --porcelain frontend'));
  if (!touched) return null;
  return `prettier: ${fmt.slice(0, 200)}`;
}

function invokeDroidFixer(logs, prNumber) {
  const prompt = [
    'Goal: Corrige los errores de CI del PR #' + prNumber + ' de Antares.',
    '',
    'REGLAS OBLIGATORIAS:',
    '1. NO elimines codigo existente. Si necesitas silenciar un lint, usa # noqa, no borres.',
    '2. Minimo cambio posible. Un commit pequeño y enfocado.',
    '3. Modifica solo lo que el error indica.',
    '4. Si un test falla por un bug, arregla el codigo que el test cubre, no el test.',
    '',
    'Contexto del repo: C:\\Users\\HIDROAA\\Desktop\\antares',
    '  - backend/ (Python, ruff lint, mypy typecheck)',
    '  - frontend/ (TypeScript+React, tsc typecheck, vitest)',
    '  - tests/ (pytest + node integration tests)',
    '',
    'Errores de CI capturados:',
    '```',
    logs.slice(0, 4000),
    '```',
    '',
    'Despues de corregir, reporta:',
    '  - Archivos modificados (paths)',
    '  - Que errores quedaron sin resolver (si alguno)',
    '  - Si consideras que un error es un false-positive',
  ].join('\n');

  console.log('    (El caller debe invocar el subagent worker con el prompt generado.)');
  console.log('    Prompt de fix guardado para entrega al droid.');
  return prompt;
}

function workingTreeDirty() {
  return Boolean(trySh('git status --porcelain'));
}

function commitAndPush(branch) {
  if (!workingTreeDirty()) {
    console.log('    Sin cambios para commitear despues de heuristicas.');
    return false;
  }
  trySh('git add -A');
  trySh(`git commit -m "${COMMIT_MSG}" 2>&1`);

  const upstream = trySh(`git rev-parse --abbrev-ref "${branch}@{upstream}" 2>&1`);
  if (upstream && !upstream.includes('fatal')) {
    sh(`git push origin "${branch}"`);
  } else {
    sh(`git push -u origin "${branch}"`);
  }
  console.log(`    Commit [skip-ci-fix] pusheado a ${branch}.`);
  return true;
}

function canAutoMerge(prInfo, checks) {
  const reasons = [];

  if (prInfo.state !== 'OPEN') {
    reasons.push(`estado=${prInfo.state} (no es OPEN)`);
  }
  if (prInfo.reviewDecision !== 'APPROVED') {
    reasons.push(`reviewDecision=${prInfo.reviewDecision || 'ninguna'} (requiere APPROVED)`);
  }
  if (prInfo.mergeable !== 'MERGEABLE') {
    reasons.push(`mergeable=${prInfo.mergeable || 'UNKNOWN'} (hay conflictos)`);
  }
  if (!allChecksPass(checks)) {
    reasons.push('checks no todos en PASS/SKIP');
  }

  return { ok: reasons.length === 0, reasons };
}

function mergePr(prNumber) {
  sh(`gh pr merge ${prNumber} --merge --delete-branch`);
  console.log(`    PR #${prNumber} mergeado a ${BASE_BRANCH}.`);
}

function commentOnPr(prNumber, body) {
  trySh(`gh pr comment ${prNumber} --body "${body.replace(/"/g, '\\"')}" 2>&1`);
}

function runLoop(options) {
  let prNumber = options.prNumber ? Number(options.prNumber) : null;
  if (!prNumber) {
    const branch = currentBranch();
    if (branch === BASE_BRANCH) {
      throw new Error(
        `Estas en ${BASE_BRANCH}. Pasa --pr <num> o cambiate a una feature branch.`
      );
    }
    prNumber = findPrForBranch(branch);
    if (!prNumber) {
      throw new Error(
        `No se encontro un PR abierto para la branch actual "${branch}". Pasa --pr <num>.`
      );
    }
  }
  console.log(`    PR objetivo: #${prNumber}`);

  const prInfo = getPrInfo(prNumber);
  if (prInfo.state && prInfo.state !== 'OPEN') {
    throw new Error(`El PR #${prNumber} no esta OPEN (estado: ${prInfo.state}).`);
  }
  const branch = prInfo.headRefName;
  console.log(`    Branch: ${branch}`);

  let iter = 0;
  let resolved = false;

  while (iter < options.maxIter) {
    iter++;
    console.log(`\n  ── Iteracion ${iter}/${options.maxIter} ──`);

    const checks = getPrChecks(prNumber);
    if (allChecksPass(checks)) {
      console.log('    ✓ Todos los checks pasan.');
      resolved = true;
      break;
    }
    if (!anyCheckFails(checks) && checks.length > 0 && checks.some((c) => c.bucket === 'PENDING')) {
      console.log('    Checks pendientes. Esperando 30s...');
      if (options.isShip) {
        trySh('sleep 30');
        continue;
      }
      break;
    }

    const logs = captureFailedRunLogs(prNumber);
    if (!options.isShip) {
      console.log('    (Dry-run) Errores detectados:\n' + logs.slice(0, 500));
      resolved = false;
      break;
    }

    console.log('    Aplicando heuristicas deterministas...');
    const pythonFix = applyPythonLintFix();
    if (pythonFix) console.log(`      python: ${pythonFix.slice(0, 80)}`);

    const feFix = applyFrontendPrettierFix();
    if (feFix) console.log(`      frontend: ${feFix.slice(0, 80)}`);

    const stillDirty = workingTreeDirty();
    if (stillDirty) {
      const pushed = commitAndPush(branch);
      if (!pushed) {
        console.log('    Heuristicas no generaron cambios. Se requiere droid.');
      }
    } else {
      console.log('    Heuristicas no generaron cambios.');
    }

    const checksAfter = getPrChecks(prNumber);
    if (anyCheckFails(checksAfter)) {
      console.log('    Errores residuales. Invocando droid fixer...');
      const prompt = invokeDroidFixer(logs, prNumber);
      if (process.env.FACTORY_DROID_AVAILABLE === '1') {
        console.log('    (Factory droid disponible — el caller debe procesar el prompt.)');
      }
      break;
    }

    resolved = true;
    break;
  }

  if (iter >= options.maxIter && !resolved) {
    console.log(`\n  ⚠ Maximo de iteraciones (${options.maxIter}) alcanzado.`);
    if (options.isShip) {
      commentOnPr(
        prNumber,
        `Auto-fix no pudo resolver todos los errores en ${options.maxIter} intentos. ` +
          'Revisión manual necesaria. Logs disponibles en las runs de CI.'
      );
    }
  }

  if (resolved && options.doMerge) {
    console.log('\n  ── Auto-merge con guardia ──');
    const finalInfo = getPrInfo(prNumber);
    const finalChecks = getPrChecks(prNumber);
    const guard = canAutoMerge(finalInfo, finalChecks);
    if (guard.ok) {
      step(`Merge PR #${prNumber}`, () => mergePr(prNumber));
    } else {
      console.log('    ❌ Auto-merge bloqueado:');
      for (const r of guard.reasons) {
        console.log(`      - ${r}`);
      }
      console.log('    El PR queda listo para accion manual.');
    }
  } else if (!resolved && options.doMerge) {
    skip('Auto-merge', 'CI no resuelto despues del loop');
  } else if (resolved && !options.doMerge) {
    skip('Auto-merge', 'usa --merge para incluir');
  }

  return resolved;
}

function main() {
  const options = parseArgs(process.argv);
  const mode = options.isShip
    ? '🚀 SHIP MODE (aplica fixes reales)'
    : '🔍 DRY-RUN (sin side effects)';

  console.log('\n════════════════════════════════════════════');
  console.log('  Antares PR Fix Loop (auto-correction + auto-merge guard)');
  console.log(`  ${mode}`);
  console.log('════════════════════════════════════════════\n');

  try {
    step('Entorno (gh auth, fetch)', () => {
      const ghStatus = trySh('gh auth status 2>&1');
      if (!ghStatus) {
        throw new Error('GitHub CLI (gh) no esta autenticado. Corre: gh auth login');
      }
      trySh('git fetch origin 2>&1');
    });

    const resolved = step('Fix loop', () => runLoop(options));

    console.log('\n════════════════════════════════════════════');
    if (resolved) {
      console.log('  ✅ Loop resuelto: CI verde.');
    } else if (options.isShip) {
      console.log('  ⚠ Loop termino sin resolver todo. Ver logs arriba.');
    } else {
      console.log('  ✅ Dry-run completado. Usa --ship para aplicar fixes.');
    }
    console.log('════════════════════════════════════════════\n');
  } catch (err) {
    die(err.message || 'PR fix loop fallo.', err.code || 1);
  }
}

main();
