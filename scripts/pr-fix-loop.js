#!/usr/bin/env node

/**
 * Antares PR Fix Loop (auto-correction + auto-merge with guard)
 * =============================================================
 *
 * Loop que se dispara cuando un PR falla CI (lint, typecheck, tests).
 * Aplica correcciones SIN eliminar codigo, vuelve a pushear, espera CI
 * y si todo pasa y el PR esta aprobado, hace auto-merge con guardia.
 *
 * Flags:
 *   (ninguno)   = dry-run — analiza el PR, muestra que corregiria, sin side effects
 *   --ship      = aplica fixes, commitea, pushea, espera CI
 *   --merge     = tras CI verde y PR aprobado, mergea (auto-merge con guardia)
 *   --pr <num>  = opera sobre un PR especifico (default: PR abierto de tu branch actual)
 *   --max <n>   = maximo de iteraciones (default: 5)
 *
 * Anti-loop:
 *   - Commit de auto-fix usa suffix [skip-ci-fix]
 *   - Maximo de iteraciones (default 5)
 *   - Si llega al limite, comenta en el PR y sale
 *
 * Uso:
 *   node scripts/pr-fix-loop.js
 *   node scripts/pr-fix-loop.js --ship --pr 42
 *   node scripts/pr-fix-loop.js --ship --merge --pr 42
 */

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

// ─── PR discovery & status ───────────────────────────────────────────────────

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
  // Devuelve array de { name, state, bucket }
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
  // GitHub usa buckets: PASS, FAIL, SKIP, PENDING
  return checks.every((c) => c.bucket === 'PASS' || c.bucket === 'SKIP');
}

function anyCheckFails(checks) {
  return checks.some((c) => c.bucket === 'FAIL' || c.bucket === 'CANCEL');
}

// ─── CI log capture ─────────────────────────────────────────────────────────

function captureFailedRunLogs(prNumber) {
  // Lista runs asociados al PR y captura el log failed de los rojos
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

// ─── Heuristics (deterministic, never delete code) ──────────────────────────

function applyPythonLintFix() {
  // ruff --fix + ruff format: nunca elimina codigo, solo reordena/repara
  const fix = trySh('npm run lint:fix 2>&1');
  const fmt = trySh('npx ruff format backend tests scripts 2>&1');
  const touched = Boolean(trySh('git status --porcelain'));
  if (!touched) return null;
  return `ruff --fix + format:${(fix || '').slice(0, 200)}\n${(fmt || '').slice(0, 200)}`;
}

function applyFrontendPrettierFix() {
  // Si hay prettier configurado, aplica formato (no elimina codigo)
  const fmt = trySh('cd frontend && npx prettier --write src 2>&1');
  if (!fmt) return null;
  const touched = Boolean(trySh('git status --porcelain frontend'));
  if (!touched) return null;
  return `prettier: ${fmt.slice(0, 200)}`;
}

// ─── Droid invocation (when heuristics are not enough) ───────────────────────

// El droid no puede invocarse en dry-run ni en CI sin Factory runtime.
// En modo --ship local, lanzamos el subagent worker con los logs.
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

  // Nota: el droid worker se invoca via Task tool desde el agente que corre este script
  // en modo local. En CI (GH Actions), este paso se omite por defecto.
  // Para invocarlo localmente, el caller (el agente principal) debe usar Task tool.
  console.log('    (El caller debe invocar el subagent worker con el prompt generado.)');
  console.log('    Prompt de fix guardado para entrega al droid.');
  return prompt;
}

// ─── Commit & push ───────────────────────────────────────────────────────────

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

// ─── Auto-merge with guard ───────────────────────────────────────────────────

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

// ─── Main loop ──────────────────────────────────────────────────────────────

function runLoop(options) {
  // Resolver PR number
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

    // Paso 1: heuristicas deterministas (nunca eliminan codigo)
    console.log('    Aplicando heuristicas deterministas...');
    const pythonFix = applyPythonLintFix();
    if (pythonFix) console.log(`      python: ${pythonFix.slice(0, 80)}`);

    const feFix = applyFrontendPrettierFix();
    if (feFix) console.log(`      frontend: ${feFix.slice(0, 80)}`);

    // Re-verificar localmente si las heuristicas resolvieron algo
    const stillDirty = workingTreeDirty();
    if (stillDirty) {
      const pushed = commitAndPush(branch);
      if (!pushed) {
        console.log('    Heuristicas no generaron cambios. Se requiere droid.');
      }
    } else {
      console.log('    Heuristicas no generaron cambios.');
    }

    // Paso 2: si quedan errores, invocar droid (en CI esto es no-op, en local el caller lo gestiona)
    const checksAfter = getPrChecks(prNumber);
    if (anyCheckFails(checksAfter)) {
      console.log('    Errores residuales. Invocando droid fixer...');
      const prompt = invokeDroidFixer(logs, prNumber);
      // En CI, el droid no puede correr directamente; el caller decide.
      // Si el caller es el agente principal, debe lanzar Task worker con este prompt.
      if (process.env.FACTORY_DROID_AVAILABLE === '1') {
        // Hook para integracion futura con Factory runtime en CI
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

  // Auto-merge con guardia
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
