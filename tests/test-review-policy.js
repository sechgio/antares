const fs = require('fs');
const path = require('path');

const { assert, finish, stubModule, evictModule } = require('./helpers/harness');

const ROOT = path.join(__dirname, '..');
const policy = require(path.join(ROOT, 'scripts', 'review-policy-check.js'));
const audit = require(path.join(ROOT, 'scripts', 'lib', 'pr-audit.js'));
const metrics = require(path.join(ROOT, 'scripts', 'review-metrics.js'));

function eq(actual, expected, message) {
  assert(
    actual === expected,
    `${message} (esperado: ${JSON.stringify(expected)}, actual: ${JSON.stringify(actual)})`,
  );
}

function testArtifacts() {
  console.log('\nArtefactos:');

  const template = path.join(ROOT, '.github', 'pull_request_template.md');
  const text = fs.readFileSync(template, 'utf8');
  assert(text.includes('## Risk'), 'la plantilla pide la sección de riesgo');
  assert(/npm run ci/.test(text), 'la plantilla exige CI en local');
  assert(text.includes('suggestion:'), 'la plantilla recuerda la taxonomía al revisor');

  const workflow = path.join(ROOT, '.github', 'workflows', 'review-policy.yml');
  const wf = fs.readFileSync(workflow, 'utf8').replace(/\r\n/g, '\n');
  const refs = [...wf.matchAll(/uses:\s+actions\/[^@\s]+@([^\s#]+)/g)].map((m) => m[1]);
  assert(refs.length > 0, 'el workflow usa acciones de GitHub');
  assert(
    refs.every((r) => /^[0-9a-f]{40}$/.test(r)),
    'el workflow fija cada acción a un SHA completo',
  );
  assert(/permissions:/.test(wf) && /contents:\s+read/.test(wf), 'el workflow limita contents a solo lectura');
  assert(/issues:\s+write/.test(wf), 'el workflow puede publicar y editar comentarios del PR');
  assert(/pull-requests:\s+read/.test(wf), 'el workflow solo lee los pull requests');
  assert(!/pull-requests:\s*write/.test(wf), 'el workflow no pide escribir en pull requests');
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  assert(agents.includes('size/exempt'), 'AGENTS.md documenta la etiqueta size/exempt');
  assert(wf.includes('edited'), 'el workflow reacciona a ediciones de la descripción');
  assert(wf.includes('labeled'), 'el workflow reacciona a cambios de etiquetas');
  assert(wf.includes('review-policy-check.js --pr "$PR_NUMBER"'), 'el workflow audita el PR indicado');
  assert(wf.includes('^[1-9][0-9]*$'), 'el workflow valida pr_number en dispatch');
  assert(wf.includes('timeout-minutes:'), 'el workflow acota su tiempo de ejecución');
  assert(wf.includes('persist-credentials: false'), 'el checkout no persiste credenciales');

  const script = fs.readFileSync(path.join(ROOT, 'scripts', 'review-policy-check.js'), 'utf8');
  assert(
    script.includes("require('./lib/pr-audit')"),
    'la política delega la lectura del PR y se queda con la evaluación',
  );
}

function testClassifySize() {
  console.log('\nclassifySize:');
  eq(policy.classifySize(0), 'ok', '0 líneas es ok');
  eq(policy.classifySize(policy.SIZE_WARN), 'ok', 'exactamente 400 es ok');
  eq(policy.classifySize(policy.SIZE_WARN + 1), 'warn', '401 es warn');
  eq(policy.classifySize(policy.SIZE_LARGE - 1), 'warn', '1999 es warn');
  eq(policy.classifySize(policy.SIZE_LARGE), 'block', '2000 es demasiado grande');
}

function testIsTestPath() {
  console.log('\nisTestPath:');
  assert(policy.isTestPath('tests/test-ipc.js'), 'detecta tests/ de Node');
  assert(policy.isTestPath('tests/test_canvas.py'), 'detecta tests/ de pytest');
  assert(policy.isTestPath('frontend/src/lib/foo.test.ts'), 'detecta *.test.ts');
  assert(policy.isTestPath('frontend/src/lib/foo.spec.tsx'), 'detecta *.spec.tsx');
  assert(!policy.isTestPath('backend/handlers/conversion.py'), 'no marca código de producción');
  assert(!policy.isTestPath('electron/main.js'), 'no marca el main de Electron');
}

function testApproval() {
  console.log('\nAprobación de un tercero:');
  const author = { author: { login: 'sechgio' }, reviews: [] };
  assert(!policy.hasThirdPartyApproval(author), 'sin reviews no hay aprobación');

  const selfApproved = {
    author: { login: 'sechgio' },
    reviews: [{ author: { login: 'sechgio' }, state: 'APPROVED' }],
  };
  assert(!policy.hasThirdPartyApproval(selfApproved), 'la auto-aprobación no cuenta');

  const approved = {
    author: { login: 'sechgio' },
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
  };
  assert(policy.hasThirdPartyApproval(approved), 'una aprobación externa cuenta');

  const changesRequested = {
    author: { login: 'sechgio' },
    reviews: [{ author: { login: 'revisora' }, state: 'CHANGES_REQUESTED' }],
  };
  assert(!policy.hasThirdPartyApproval(changesRequested), 'CHANGES_REQUESTED no es aprobación');

  const botApproved = {
    author: { login: 'sechgio' },
    reviews: [{ author: { login: 'copilot[bot]', is_bot: true }, state: 'APPROVED' }],
  };
  assert(!policy.hasThirdPartyApproval(botApproved), 'la aprobación de un bot no cuenta');
}

function testTaxonomy() {
  console.log('\nTaxonomía de comentarios:');
  const empty = policy.taxonomyCompliance([]);
  eq(empty.ratio, 1, 'sin comentarios el ratio es neutro (1)');

  const mixed = policy.taxonomyCompliance([
    { author: { login: 'a' }, body: 'nit: espacio extra' },
    { author: { login: 'b' }, body: 'blocking: esto rompe el lock' },
    { author: { login: 'c' }, body: 'esto no me gusta' },
    { author: { login: 'bot[bot]', is_bot: true }, body: 'comentario de bot' },
  ]);
  eq(mixed.total, 3, 'ignora bots y vacíos');
  eq(mixed.prefixed, 2, 'cuenta los comentarios con prefijo');
  assert(Math.abs(mixed.ratio - 2 / 3) < 1e-9, 'calcula el ratio correcto');

  const caseInsensitive = policy.taxonomyCompliance([{ author: { login: 'a' }, body: 'Blocking: ojo' }]);
  eq(caseInsensitive.prefixed, 1, 'el prefijo es case-insensitive');

  const suffixBot = policy.taxonomyCompliance([
    { author: { login: 'imgbot[bot]' }, body: 'nit: ignore me' },
    { author: { login: 'a' }, body: 'nit: real' },
  ]);
  eq(suffixBot.total, 1, 'trata [bot] como bot aunque no traiga is_bot');
}

function goodPrBody() {
  return [
    '## What / Why',
    '',
    'El lock global serializaba lecturas innecesariamente y provocaba timeouts.',
    'Este cambio introduce un lock por tabla manteniendo el contrato del repositorio.',
    '',
    '## Risk',
    '',
    '- [x] Toca concurrencia',
  ].join('\n');
}

function testEffectiveBody() {
  console.log('\nCuerpo efectivo de la descripción:');

  const template = fs.readFileSync(path.join(ROOT, '.github', 'pull_request_template.md'), 'utf8');
  assert(
    policy.effectiveBodyLength(template) < policy.MIN_BODY_CHARS,
    'la plantilla sin rellenar no satisface la intención',
  );
  const templateOnly = policy.evaluatePolicy({
    number: 10,
    body: template,
    additions: 5,
    deletions: 0,
    files: [{ path: 'backend/core/converter.py', additions: 5, deletions: 0 }],
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
    comments: [],
    author: { login: 'sechgio' },
  });
  eq(templateOnly.verdict, 'blocked', 'un PR con la plantilla intacta queda bloqueado');
  assert(
    templateOnly.checks.some((c) => c.id === 'intencion' && c.status === 'fail'),
    'bloquea por falta de intención real',
  );
  assert(
    policy.effectiveBodyLength(goodPrBody()) >= policy.MIN_BODY_CHARS,
    'la prosa real sí cuenta como intención',
  );
}

function testGeneratedPaths() {
  console.log('\nRutas generadas:');

  assert(policy.isGeneratedPath('uv.lock'), 'uv.lock es generado');
  assert(policy.isGeneratedPath('frontend/package-lock.json'), 'package-lock anidado es generado');
  assert(policy.isGeneratedPath('frontend/src/x/__snapshots__/a.snap'), 'los snapshots son generados');
  assert(policy.isGeneratedPath('assets/app.min.js'), 'los minificados son generados');
  assert(!policy.isGeneratedPath('backend/core/converter.py'), 'el código real no es generado');

  const lockBump = policy.evaluatePolicy({
    number: 11,
    body: goodPrBody(),
    additions: 1210,
    deletions: 40,
    files: [
      { path: 'uv.lock', additions: 1150, deletions: 35 },
      { path: 'backend/core/converter.py', additions: 50, deletions: 5 },
      { path: 'tests/test_converter.py', additions: 10, deletions: 0 },
    ],
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
    comments: [],
    author: { login: 'sechgio' },
  });
  eq(lockBump.stats.effectiveLines, 65, 'las líneas de lockfile no cuentan para el tamaño');
  eq(lockBump.stats.generatedLines, 1185, 'las líneas generadas se contabilizan aparte');
  assert(
    lockBump.checks.some((c) => c.id === 'tamano' && c.status === 'pass'),
    'un bump de dependencias no bloquea por tamaño',
  );

  const bigGenerated = policy.evaluatePolicy({
    number: 12,
    body: goodPrBody(),
    additions: 1600,
    deletions: 0,
    files: [
      { path: 'assets/bundle.min.js', additions: 900, deletions: 0 },
      { path: 'tests/test_big.py', additions: 700, deletions: 0 },
    ],
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
    comments: [],
    labels: [{ name: 'size/exempt' }],
    author: { login: 'sechgio' },
  });
  assert(
    bigGenerated.checks.some((c) => c.id === 'archivos' && c.status === 'pass'),
    'archivos nuevos grandes generados o de test no bloquean',
  );
}

function testDraftDowngrade() {
  console.log('\nBorradores:');

  const draft = policy.evaluatePolicy({
    number: 13,
    body: 'wip',
    additions: 1400,
    deletions: 20,
    files: [{ path: 'backend/handlers/nuevo.py', additions: 1400, deletions: 0 }],
    reviews: [],
    comments: [],
    isDraft: true,
    author: { login: 'sechgio' },
  });
  assert(
    draft.checks.every((c) => c.status !== 'fail'),
    'un borrador nunca produce checks en fail',
  );
  eq(draft.verdict, 'warning', 'un borrador con problemas avisa sin bloquear');
}

function testSelectPolicyComment() {
  console.log('\nUpsert del comentario de política:');

  const sel = audit.selectPolicyComment([
    { id: 5, body: 'informe viejo <!-- antares-review-policy:pr=1 -->' },
    { id: 7, body: 'comentario humano' },
    { id: 9, body: '<!-- antares-review-policy:pr=1 --> informe nuevo' },
  ]);
  eq(sel.update && sel.update.id, 9, 'actualiza el comentario marcado más reciente');
  eq(sel.remove.length, 1, 'marca los duplicados para borrado');
  eq(sel.remove[0].id, 5, 'el duplicado viejo se borra');

  const none = audit.selectPolicyComment([{ id: 1, body: 'hola' }]);
  eq(none.update, null, 'sin marca previa se crea un comentario nuevo');
  eq(none.remove.length, 0, 'sin duplicados no se borra nada');
}

async function testPrAuditNormalizers() {
  console.log('\nCapa de datos del PR:');

  const file = audit.normalizeFile({ filename: 'backend/main.py', additions: '4', deletions: '2', status: 'Modified' });
  eq(file.path, 'backend/main.py', 'traduce filename a path');
  eq(file.additions, 4, 'convierte additions a número');
  eq(file.status, 'modified', 'normaliza el estado a minúsculas');

  const comment = audit.normalizeComment({
    id: 3,
    user: { login: 'revisora' },
    body: 'nit: detalle',
    created_at: '2026-08-01T10:00:00Z',
  });
  eq(comment.author.login, 'revisora', 'expone user como author');
  eq(comment.createdAt, '2026-08-01T10:00:00Z', 'expone created_at como createdAt');

  eq((await audit.settle(Promise.resolve(7))).value, 7, 'settle envuelve el valor');
  eq((await audit.settle(Promise.reject(new Error('x')))).error.message, 'x', 'settle envuelve el error');

  const order = await audit.mapLimit([1, 2, 3, 4], 2, async (n) => n * 10);
  eq(order.join(','), '10,20,30,40', 'mapLimit preserva el orden con concurrencia');

  let attempts = 0;
  const recovered = await audit.withRetry(
    async () => {
      attempts += 1;
      if (attempts < 2) throw new Error('499');
      return 'ok';
    },
    3,
    1,
  );
  eq(recovered, 'ok', 'withRetry absorbe un fallo transitorio');
  eq(attempts, 2, 'reintenta hasta agotar los intentos');

  assert(audit.isMissingGh('spawnSync gh ENOENT'), 'reconoce que falta gh');
  assert(!audit.isMissingGh('HTTP 422 demasiado grande'), 'un 422 no es gh ausente');
}

function testEvaluatePolicy() {
  console.log('\nevaluatePolicy:');

  const empty = policy.evaluatePolicy({});
  eq(empty.verdict, 'blocked', 'un PR sin descripción queda bloqueado');
  assert(
    empty.checks.some((c) => c.id === 'intencion' && c.status === 'fail'),
    'bloquea por falta de intención',
  );

  const good = policy.evaluatePolicy({
    number: 1,
    body: goodPrBody(),
    additions: 120,
    deletions: 30,
    files: [
      { path: 'backend/core/repository.py', additions: 90, deletions: 20 },
      { path: 'tests/test_repository.py', additions: 30, deletions: 10 },
    ],
    reviews: [
      { author: { login: 'revisora' }, state: 'APPROVED', body: 'nit: renombra la variable' },
    ],
    comments: [],
    author: { login: 'sechgio' },
  });
  eq(good.verdict, 'ok', 'un PR bien formado pasa');
  eq(good.changedLines, 150, 'suma adiciones y borrados');
  assert(
    good.checks.every((c) => c.status !== 'fail'),
    'ningún check bloquea',
  );

  const huge = policy.evaluatePolicy({
    number: 2,
    body: goodPrBody(),
    additions: 2400,
    deletions: 20,
    files: [{ path: 'backend/handlers/nuevo.py', additions: 2400, deletions: 0, status: 'added' }],
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
    comments: [],
    author: { login: 'sechgio' },
  });
  eq(huge.verdict, 'blocked', 'un PR de 2420 líneas sin declarar se bloquea');
  assert(
    huge.checks.some((c) => c.id === 'tamano' && c.status === 'fail' && c.severity === policy.BLOCKING),
    'bloquea por tamaño',
  );
  assert(
    huge.checks.some((c) => c.id === 'archivos' && c.status === 'warn' && c.severity === policy.ADVISORY),
    'el archivo nuevo grande avisa pero no bloquea',
  );
  assert(
    !huge.checks.some((c) => c.severity === policy.ADVISORY && c.status === 'fail'),
    'ningún check no bloqueante queda en fail',
  );

  const exempt = policy.evaluatePolicy({
    number: 3,
    body: goodPrBody(),
    additions: 2400,
    deletions: 20,
    files: [{ path: 'backend/handlers/nuevo.py', additions: 2400, deletions: 0, status: 'added' }],
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
    comments: [],
    labels: [{ name: 'size/exempt' }],
    author: { login: 'sechgio' },
  });
  eq(exempt.verdict, 'warning', 'la etiqueta size/exempt degrada el bloqueo a aviso');
  assert(exempt.stats.sizeExempt, 'la exención queda registrada en las estadísticas');

  const draft = policy.evaluatePolicy({
    number: 4,
    body: 'borrador',
    additions: 10,
    deletions: 0,
    files: [],
    reviews: [],
    comments: [],
    isDraft: true,
    author: { login: 'sechgio' },
  });
  assert(
    draft.checks.some((c) => c.id === 'aprobacion' && c.status === 'skip'),
    'un borrador no exige aprobación',
  );

  const noTests = policy.evaluatePolicy({
    number: 5,
    body: goodPrBody(),
    additions: 50,
    deletions: 5,
    files: [{ path: 'backend/core/formatos.py', additions: 50, deletions: 5 }],
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
    comments: [],
    author: { login: 'sechgio' },
  });
  assert(
    noTests.checks.some((c) => c.id === 'tests' && c.status === 'warn'),
    'aviso cuando el diff no toca tests',
  );

  const bigUndeclared = policy.evaluatePolicy({
    number: 30,
    body: goodPrBody(),
    additions: 600,
    deletions: 20,
    files: [
      { path: 'backend/core/formatos.py', additions: 550, deletions: 10 },
      { path: 'tests/test_formatos.py', additions: 50, deletions: 10 },
    ],
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
    comments: [],
    author: { login: 'sechgio' },
  });
  assert(
    bigUndeclared.checks.some((c) => c.id === 'alcance' && c.status === 'warn'),
    'avisa cuando un PR supera 400 líneas sin declarar el cambio amplio',
  );

  const bigDeclared = policy.evaluatePolicy({
    number: 31,
    body: `${goodPrBody()}\n\ncambio amplio: backend/core/formatos.py — el refactor no admite vía mínima — bajo — npm test`,
    additions: 600,
    deletions: 20,
    files: [
      { path: 'backend/core/formatos.py', additions: 550, deletions: 10 },
      { path: 'tests/test_formatos.py', additions: 50, deletions: 10 },
    ],
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
    comments: [],
    author: { login: 'sechgio' },
  });
  assert(
    bigDeclared.checks.some((c) => c.id === 'alcance' && c.status === 'pass'),
    'el marcador cambio amplio: en el cuerpo declara el alcance',
  );

  const bigExempt = policy.evaluatePolicy({
    number: 32,
    body: goodPrBody(),
    additions: 600,
    deletions: 20,
    files: [{ path: 'backend/core/formatos.py', additions: 600, deletions: 20 }],
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
    comments: [],
    labels: [{ name: 'size/exempt' }],
    author: { login: 'sechgio' },
  });
  assert(
    bigExempt.checks.some((c) => c.id === 'alcance' && c.status === 'pass'),
    'la etiqueta size/exempt también declara el alcance',
  );

  assert(
    good.checks.some((c) => c.id === 'alcance' && c.status === 'pass'),
    'un diff acotado no necesita declaración de alcance',
  );

  const report = policy.renderReport({ number: 7 }, good);
  assert(report.includes('Veredicto'), 'el informe incluye el veredicto');
  assert(report.includes('antares-review-policy'), 'el informe lleva marca para idempotencia');
}

function testMetrics() {
  console.log('\nreview-metrics:');

  eq(metrics.median([5, 1, 3]), 3, 'mediana de lista impar');
  eq(metrics.median([4, 1, 3, 2]), 2.5, 'mediana de lista par');
  eq(metrics.median([]), null, 'mediana vacía es null');

  eq(
    metrics.hoursBetween('2026-01-01T00:00:00Z', '2026-01-01T02:00:00Z'),
    2,
    'horas entre dos instantes',
  );
  eq(metrics.hoursBetween('no-fecha', '2026-01-01T00:00:00Z'), null, 'fecha inválida es null');

  assert(policy.isBot({ login: 'dependabot[bot]' }), 'detecta bots por sufijo');
  assert(!policy.isBot({ login: 'sechgio' }), 'un humano no es bot');

  const prs = [
    {
      author: { login: 'sechgio' },
      createdAt: '2026-08-01T10:00:00Z',
      additions: 100,
      deletions: 20,
      reviews: [
        { author: { login: 'revisora' }, state: 'APPROVED', submittedAt: '2026-08-01T11:00:00Z', body: 'nit: ok' },
      ],
      comments: [],
    },
    {
      author: { login: 'sechgio' },
      createdAt: '2026-08-02T10:00:00Z',
      additions: 300,
      deletions: 50,
      reviews: [
        { author: { login: 'revisor2' }, state: 'APPROVED', submittedAt: '2026-08-02T18:00:00Z', body: 'blocking: falta test' },
      ],
      comments: [],
    },
    {
      author: { login: 'devnuevo' },
      createdAt: '2026-08-03T10:00:00Z',
      additions: 200,
      deletions: 10,
      reviews: [],
      comments: [],
    },
  ];

  const computed = metrics.computeMetrics(prs);
  const byId = Object.fromEntries(computed.map((m) => [m.id, m]));

  eq(byId.size.value, 210, 'tamaño mediano de PR');
  assert(byId.size.ok, 'el tamaño mediano cumple el objetivo');
  eq(byId.firstReviewHours.value, 4.5, 'tiempo mediano hasta la primera revisión');
  assert(!byId.firstReviewHours.ok, 'una mediana de 4.5 h incumple el objetivo de 4 h');
  eq(byId.firstReviewHours.detail, '2 PRs con señal', 'excluye de la mediana los PRs sin revisión');
  assert(Math.abs(byId.reviewCoverage.value - 66.7) < 0.1, 'cobertura de revisión ~66.7%');
  assert(!byId.reviewCoverage.ok, 'la cobertura por debajo de 100% no cumple');
  eq(byId.rubberStamp.value, 0, 'sin rubber-stamps en el ejemplo');
  assert(Math.abs(byId.authorConcentration.value - 66.7) < 0.1, 'concentración de autor ~66.7%');
  assert(byId.authorConcentration.ok, 'la concentración está por debajo del 70%');
  eq(byId.taxonomy.value, 100, 'taxonomía al 100% en el ejemplo');
  eq(
    metrics.TARGETS.taxonomy,
    Math.round(policy.TAXONOMY_TARGET * 100),
    'el objetivo de taxonomía sale de la política, no de una constante duplicada',
  );

  // El tamaño que mide la métrica es el mismo que mide la política: sin excluir generados.
  const big = { author: { login: 'sechgio' }, createdAt: '2026-08-05T10:00:00Z', additions: 3500, deletions: 500, reviews: [], comments: [] };
  const rawOnly = metrics.computeMetrics([big]);
  eq(
    Object.fromEntries(rawOnly.map((m) => [m.id, m])).size.value,
    4000,
    'sin detalle de archivos la métrica usa el tamaño bruto',
  );
  const withFiles = metrics.computeMetrics([
    { ...big, files: [{ path: 'uv.lock', additions: 3400, deletions: 480 }, { path: 'backend/x.py', additions: 100, deletions: 20 }] },
  ]);
  const filesById = Object.fromEntries(withFiles.map((m) => [m.id, m]));
  eq(filesById.size.value, 120, 'con el detalle de archivos excluye los generados');
  assert(filesById.size.ok, 'un bump de dependencias cumple el objetivo de tamaño');

  eq(policy.effectiveChangedLines({ additions: 1200, deletions: 40 }).effective, 1240, 'sin archivos el efectivo es el bruto');
  eq(
    policy.effectiveChangedLines({ additions: 1200, deletions: 40, files: [{ path: 'uv.lock', additions: 1150, deletions: 35 }] }).effective,
    55,
    'las líneas de lockfile no cuentan',
  );

  const fast = metrics.computeMetrics([
    {
      author: { login: 'devnuevo' },
      createdAt: '2026-08-04T10:00:00Z',
      additions: 80,
      deletions: 10,
      reviews: [
        { author: { login: 'revisora' }, state: 'APPROVED', submittedAt: '2026-08-04T11:30:00Z' },
      ],
      comments: [],
    },
  ]);
  const fastById = Object.fromEntries(fast.map((m) => [m.id, m]));
  eq(fastById.firstReviewHours.value, 1.5, 'una revisión a los 90 minutos');
  assert(fastById.firstReviewHours.ok, '1.5 h cumple el objetivo de 4 h');

  const selfReview = metrics.computeMetrics([
    {
      author: { login: 'sechgio' },
      createdAt: '2026-08-01T10:00:00Z',
      additions: 10,
      deletions: 0,
      reviews: [
        { author: { login: 'sechgio' }, state: 'APPROVED', submittedAt: '2026-08-01T10:01:00Z' },
        { author: { login: 'revisora' }, state: 'APPROVED', submittedAt: '2026-08-01T12:00:00Z' },
      ],
      comments: [],
    },
  ]);
  eq(
    Object.fromEntries(selfReview.map((m) => [m.id, m])).firstReviewHours.value,
    2,
    'ignora la auto-revisión al medir la primera señal',
  );

  const authorPing = metrics.computeMetrics([
    {
      author: { login: 'sechgio' },
      createdAt: '2026-08-01T10:00:00Z',
      additions: 10,
      deletions: 0,
      reviews: [
        { author: { login: 'revisora' }, state: 'APPROVED', submittedAt: '2026-08-01T14:00:00Z' },
      ],
      comments: [{ author: { login: 'sechgio' }, createdAt: '2026-08-01T10:05:00Z', body: 'ping' }],
    },
  ]);
  eq(
    Object.fromEntries(authorPing.map((m) => [m.id, m])).firstReviewHours.value,
    4,
    'ignora comentarios del propio autor al medir la primera señal',
  );

  const empty = metrics.computeMetrics([]);
  eq(empty.length, 7, 'devuelve las siete métricas incluso sin datos');
  assert(
    empty.every((m) => m.value === null),
    'sin PRs todas las métricas son null',
  );

  const md = metrics.renderMarkdown(computed, 14);
  assert(md.includes('Métricas de revisión'), 'el markdown tiene título');
  assert(md.includes('Cobertura de revisión'), 'el markdown lista la cobertura');
  assert(md.includes('|'), 'el markdown es una tabla');
}

function testUnmeasurableSize() {
  console.log('\nDiff sin recuento de líneas:');

  // GitHub omite additions/deletions/changed_files cuando el diff es demasiado grande.
  const unknown = policy.evaluatePolicy({
    number: 40,
    body: goodPrBody(),
    additions: null,
    deletions: null,
    changedFiles: null,
    files: [],
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
    comments: [],
    author: { login: 'sechgio' },
  });
  assert(unknown.stats.sizeUnknown, 'sin recuento el tamaño queda desconocido');
  eq(unknown.checks.find((c) => c.id === 'tamano').status, 'skip', 'no se bloquea por tamaño');
  eq(unknown.checks.find((c) => c.id === 'alcance').status, 'skip', 'tampoco se audita el alcance');
  assert(!unknown.checks.some((c) => c.status === 'fail'), 'un PR de tamaño desconocido no bloquea');
  eq(unknown.verdict, 'warning', 'avisa por los checks de revisor, nunca por tamaño');
  assert(
    unknown.checks.find((c) => c.id === 'tamano').detail.includes('demasiado grande'),
    'el detalle explica por qué no se pudo medir',
  );
  const report = policy.renderReport({ number: 40, author: { login: 'sechgio' } }, unknown);
  assert(report.includes('tamaño no medible'), 'el informe no afirma 0 líneas cuando no se puede medir');
  assert(!report.includes('**0** líneas'), 'el informe no inventa un tamaño de cero');

  const measurable = policy.evaluatePolicy({
    number: 41,
    body: goodPrBody(),
    additions: 0,
    deletions: 0,
    files: [],
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
    comments: [],
    author: { login: 'sechgio' },
  });
  eq(measurable.checks.find((c) => c.id === 'tamano').status, 'pass', 'un diff vacío declarado sí se mide');
  assert(!measurable.stats.sizeUnknown, 'conocer el recuento aunque sea cero basta');
}

function testIntentExemptions() {
  console.log('\nExenciones del check de intención:');

  const bot = policy.evaluatePolicy({
    number: 42,
    body: 'Bump pdf-lib from 1.17.0 to 1.17.1',
    additions: 20,
    deletions: 2,
    files: [
      { path: 'package.json', additions: 1, deletions: 1 },
      { path: 'package-lock.json', additions: 19, deletions: 1 },
    ],
    reviews: [],
    comments: [],
    author: { login: 'dependabot[bot]', is_bot: true },
  });
  eq(bot.checks.find((c) => c.id === 'intencion').status, 'skip', 'un PR de bot no exige intención');
  eq(bot.verdict, 'warning', 'el PR de bot avisa por los checks de revisor pero no bloquea');

  const generatedOnly = policy.evaluatePolicy({
    number: 43,
    body: 'bump',
    additions: 1150,
    deletions: 35,
    files: [{ path: 'uv.lock', additions: 1150, deletions: 35, status: 'modified' }],
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
    comments: [],
    author: { login: 'sechgio' },
  });
  eq(generatedOnly.checks.find((c) => c.id === 'intencion').status, 'skip', 'un diff solo de lockfile no exige intención');
  assert(
    generatedOnly.checks.every((c) => c.status !== 'fail'),
    'un bump de dependencias no bloquea',
  );

  const real = policy.evaluatePolicy({
    number: 44,
    body: 'corto',
    additions: 30,
    deletions: 4,
    files: [{ path: 'backend/core/converter.py', additions: 30, deletions: 4, status: 'modified' }],
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
    comments: [],
    author: { login: 'sechgio' },
  });
  eq(real.checks.find((c) => c.id === 'intencion').status, 'fail', 'código real sin intención sigue bloqueando');
}

function testRiskSection() {
  console.log('\nSección de riesgo:');

  const base = {
    additions: 30,
    deletions: 4,
    files: [{ path: 'backend/core/converter.py', additions: 30, deletions: 4, status: 'modified' }],
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
    comments: [],
    author: { login: 'sechgio' },
  };
  const riskBoxes = ['- [ ] Toca el protocolo IPC', '- [ ] Toca esquema de base de datos o migraciones'];
  const bodyWithRisk = (lines, extra = '') =>
    [
      '## What / Why',
      '',
      'El lock global serializaba lecturas innecesariamente y provocaba timeouts.',
      'Este cambio introduce un lock por tabla manteniendo el contrato del repositorio.',
      '',
      '## Risk',
      '',
      ...lines,
      extra,
    ].join('\n');

  const unchecked = policy.evaluatePolicy({ ...base, number: 45, body: bodyWithRisk(riskBoxes) });
  eq(unchecked.checks.find((c) => c.id === 'riesgo').status, 'warn', 'risk sin casilla marcada avisa');

  const checkedElsewhere = policy.evaluatePolicy({
    ...base,
    number: 46,
    body: bodyWithRisk(riskBoxes, '\n## Verification\n\n- [x] `npm run ci` pasa en local'),
  });
  eq(
    checkedElsewhere.checks.find((c) => c.id === 'riesgo').status,
    'warn',
    'una casilla marcada fuera de Risk no cuenta',
  );

  const checked = policy.evaluatePolicy({
    ...base,
    number: 47,
    files: [
      { path: 'backend/core/converter.py', additions: 30, deletions: 4, status: 'modified' },
      { path: 'tests/test_converter.py', additions: 6, deletions: 0, status: 'modified' },
    ],
    body: bodyWithRisk(['- [ ] Toca el protocolo IPC', '- [x] Ninguna de las anteriores']),
  });
  eq(checked.checks.find((c) => c.id === 'riesgo').status, 'pass', 'marcar una casilla dentro de Risk basta');
  eq(checked.verdict, 'ok', 'con riesgo declarado el PR queda limpio');

  assert(policy.hasCheckedLine('- [x] ok') && policy.hasCheckedLine('* [X] ok'), 'acepta - y * en cualquier caja');
  assert(!policy.hasCheckedLine('- [ ] ok'), '- [ ] no está marcada');
  assert(policy.sectionText('## Risk\n- [x] a\n\n## Notes\nhola', 'Risk').includes('- [x] a'), 'sectionText aísla la sección');
  assert(policy.sectionText('## Risk\n- [x] a\n\n## Notes\nhola', 'Notes').includes('hola'), 'sectionText llega hasta la siguiente');
}

function testTaxonomyIgnoresAuthor() {
  console.log('\nTaxonomía sin comentarios del autor:');

  const mixed = policy.taxonomyCompliance(
    [
      { author: { login: 'autor' }, body: 'gracias, subido el fix' },
      { author: { login: 'revisora' }, body: 'nit: renombra' },
    ],
    'autor',
  );
  eq(mixed.total, 1, 'los comentarios del autor del PR no cuentan');
  eq(mixed.prefixed, 1, 'solo se miden los del revisor');
  eq(mixed.ratio, 1, 'el autor no hunde la taxonomía respondiendo');

  const inPr = policy.evaluatePolicy({
    number: 48,
    body: goodPrBody(),
    additions: 30,
    deletions: 4,
    files: [
      { path: 'backend/core/converter.py', additions: 30, deletions: 4, status: 'modified' },
      { path: 'tests/test_converter.py', additions: 6, deletions: 0, status: 'modified' },
    ],
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED', body: 'nit: ok' }],
    comments: [{ author: { login: 'sechgio' }, body: 'listo, ya mergeo' }],
    author: { login: 'sechgio' },
  });
  eq(inPr.checks.find((c) => c.id === 'taxonomia').status, 'pass', 'la respuesta del autor no degrada el check');
}

function testStabilityAndExemptions() {
  console.log('\nSeveridad estable, isNewFile y etiqueta documentada:');

  const good = policy.evaluatePolicy({
    number: 50,
    body: goodPrBody(),
    additions: 120,
    deletions: 30,
    files: [{ path: 'backend/core/repository.py', additions: 90, deletions: 20, status: 'modified' }],
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
    comments: [],
    author: { login: 'sechgio' },
  });
  const ids = ['intencion', 'tamano'];
  for (const id of ids) {
    const severities = new Set(good.checks.filter((c) => c.id === id).map((c) => c.severity));
    eq(severities.size, 1, `${id} mantiene una sola severidad en todos sus estados`);
    eq([...severities][0], policy.BLOCKING, `${id} es bloqueante también cuando pasa o avisa`);
  }

  // Un archivo modificado sin `status` ya no parece nuevo.
  assert(!policy.isNewFile({ path: 'a.py', additions: 900, deletions: 0 }), 'sin status no se puede afirmar que es nuevo');
  assert(!policy.isNewFile({ path: 'a.py', additions: 900, deletions: 0, status: 'modified' }), 'modified no es nuevo');
  assert(policy.isNewFile({ path: 'a.py', additions: 900, deletions: 0, status: 'added' }), 'added es nuevo');
  const noStatus = policy.evaluatePolicy({
    number: 51,
    body: goodPrBody(),
    additions: 900,
    deletions: 0,
    files: [{ path: 'backend/handlers/nuevo.py', additions: 900, deletions: 0 }],
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
    comments: [],
    author: { login: 'sechgio' },
  });
  eq(noStatus.checks.find((c) => c.id === 'archivos').status, 'pass', 'un archivo sin status no se marca como nuevo');
}

async function testCommentTruncation() {
  console.log('\nConversación truncada:');

  const truncated = policy.evaluatePolicy(
    {
      number: 52,
      body: goodPrBody(),
      additions: 20,
      deletions: 2,
      files: [{ path: 'backend/core/converter.py', additions: 20, deletions: 2, status: 'modified' }],
      reviews: [],
      comments: [{ author: { login: 'revisora' }, body: 'nit: ok' }],
      author: { login: 'sechgio' },
    },
    { commentsComplete: false },
  );
  eq(truncated.checks.find((c) => c.id === 'taxonomia').status, 'skip', 'sin la conversación completa no se mide la taxonomía');
  assert(
    truncated.checks.find((c) => c.id === 'taxonomia').detail.includes('incompleto'),
    'el detalle dice que el listado está incompleto',
  );

  const complete = policy.evaluatePolicy({
    number: 53,
    body: goodPrBody(),
    additions: 20,
    deletions: 2,
    files: [{ path: 'backend/core/converter.py', additions: 20, deletions: 2, status: 'modified' }],
    reviews: [],
    comments: [{ author: { login: 'revisora' }, body: 'nit: ok' }],
    author: { login: 'sechgio' },
  });
  eq(complete.checks.find((c) => c.id === 'taxonomia').status, 'pass', 'con la conversación completa sí se mide');

  assert(audit.shouldPublishReport('sha1', 'sha1'), 'el head no avanzó: se publica');
  assert(!audit.shouldPublishReport('sha1', 'sha2'), 'el head avanzó: no se publica un informe obsoleto');
  assert(audit.shouldPublishReport('', 'sha2'), 'sin sha auditado se publica (falla abierta)');
  assert(audit.shouldPublishReport('sha1', ''), 'sin poder comprobar se publica (falla abierta)');
}

async function testCommentPagination() {
  console.log('\nPaginación de la conversación:');

  const LIST_PER_PAGE = 100;
  const base = 'repos/o/r/issues/7/comments';
  const pageUrl = (n) => `${base}?per_page=${LIST_PER_PAGE}&page=${n}`;
  const scripted = new Map();
  const calls = [];
  const full = (tag) => Array.from({ length: LIST_PER_PAGE }, (_, i) => ({ id: `${tag}-${i}`, user: { login: 'r' }, body: 'nit: x' }));

  stubModule('scripts/lib/loop-utils', {
    ghApiAsync: async (args) => {
      if (!scripted.has(args[0])) throw new Error(`página inesperada: ${args[0]}`);
      calls.push(args[0]);
      return JSON.stringify(scripted.get(args[0]));
    },
    ghAsync: async () => '',
  });
  evictModule('scripts/lib/pr-audit');
  const fresh = require(path.join(ROOT, 'scripts', 'lib', 'pr-audit.js'));

  scripted.set(pageUrl(1), [{ id: 'a', user: { login: 'r' }, body: 'nit: x' }]);
  calls.length = 0;
  const one = await fresh.fetchPagedList(base, 5);
  eq(calls.length, 1, 'una página corta no pide más');
  eq(one.items.length, 1, 'no queda nada por leer');
  eq(one.truncated, false, 'sin truncamiento');

  scripted.set(pageUrl(1), full('p1'));
  scripted.set(pageUrl(2), []);
  calls.length = 0;
  const two = await fresh.fetchPagedList(base, 5);
  eq(two.items.length, LIST_PER_PAGE, 'una página llena sí pide la siguiente');
  eq(calls.length, 2, 'pide justo hasta la primera corta');
  eq(two.truncated, false, 'la página corta agota la lista');

  for (let page = 1; page <= 5; page++) scripted.set(pageUrl(page), full(`q${page}`));
  calls.length = 0;
  const capped = await fresh.fetchPagedList(base, 5);
  eq(capped.truncated, true, 'agotar el tope con páginas llenas avisa de que hay más');
  eq(capped.items.length, LIST_PER_PAGE * 5, 'trae todas las páginas que pudo leer');

  scripted.clear();
  calls.length = 0;
  const failed = await fresh.fetchPagedList(base, 5);
  eq(failed.items.length, 0, 'sin páginas legibles no hay comentarios');
  eq(failed.truncated, true, 'un fallo de red también marca truncamiento');

  evictModule('scripts/lib/pr-audit');
  evictModule('scripts/lib/loop-utils');
}

function testMetricsRounds() {
  console.log('\nRondas de retrabajo y borradores:');

  const prs = [
    {
      author: { login: 'a' },
      createdAt: '2026-08-01T10:00:00Z',
      isDraft: true,
      additions: 100,
      deletions: 0,
      reviews: [
        { author: { login: 'r1' }, state: 'CHANGES_REQUESTED', submittedAt: '2026-08-01T10:05:00Z' },
        { author: { login: 'r2' }, state: 'CHANGES_REQUESTED', submittedAt: '2026-08-01T10:06:00Z' },
      ],
      comments: [],
    },
    {
      author: { login: 'b' },
      createdAt: '2026-08-02T10:00:00Z',
      isDraft: true,
      additions: 100,
      deletions: 0,
      reviews: [{ author: { login: 'r1' }, state: 'APPROVED', submittedAt: '2026-08-02T10:02:00Z' }],
      comments: [],
    },
  ];
  const byId = Object.fromEntries(metrics.computeMetrics(prs).map((m) => [m.id, m]));
  eq(byId.firstReviewHours.value, null, 'los borradores no miden tiempo hasta la primera revisión');
  assert(byId.firstReviewHours.detail.includes('borrador'), 'el detalle dice cuántos borradores se excluyeron');
  eq(byId.rubberStamp.value, 0, 'los borradores no cuentan como rubber-stamp');

  // Dos revisores pidiendo cambios en la misma Review = una ronda.
  eq(metrics.reworkRounds(prs[0]), 2, 'dos revisores distintos son dos peticiones');
  const sameTwice = metrics.reworkRounds({
    author: { login: 'a' },
    reviews: [
      { author: { login: 'r1' }, state: 'CHANGES_REQUESTED' },
      { author: { login: 'r1' }, state: 'CHANGES_REQUESTED' },
      { author: { login: 'a' }, state: 'CHANGES_REQUESTED' },
    ],
  });
  eq(sameTwice, 1, 'las reviews repetidas de un revisor cuentan una vez y las propias ninguna');

  const md = metrics.renderMarkdown(metrics.computeMetrics(prs), 14);
  assert(md.includes('concentración de autor'), 'el pie lista los siete objetivos');
  assert(!md.includes('Objetivos: tamaño < 400'), 'el pie ya no es una lista corta escrita a mano');
}

function testAdvisoryChecks() {
  console.log('\nChecks no bloqueantes y datos incompletos:');
  const renamed = policy.evaluatePolicy({
    number: 20,
    body: goodPrBody(),
    additions: 900,
    deletions: 0,
    files: [{ path: 'electron/main.js', additions: 900, deletions: 0, status: 'renamed' }],
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
    comments: [],
    author: { login: 'sechgio' },
  });
  assert(
    renamed.checks.some((c) => c.id === 'archivos' && c.status === 'pass'),
    'un renombrado no cuenta como archivo nuevo',
  );
  assert(!policy.isNewFile({ status: 'modified', deletions: 0 }), 'modified no es nuevo');
  assert(policy.isNewFile({ status: 'added', deletions: 12 }), 'added es nuevo aunque traiga borrados');

  const polluted = policy.taxonomyCompliance([
    { author: { login: 'sechgio' }, body: 'sin prefijo' },
    { author: { login: 'github-actions', type: 'Bot' }, body: 'informe automático' },
    { author: { login: 'revisora' }, body: `nit: detalle <!-- ${audit.COMMENT_MARKER}pr=20 -->` },
  ]);
  eq(polluted.total, 1, 'excluye bots y el informe de la propia política');
  eq(polluted.prefixed, 0, 'el comentario humano sin prefijo sí cuenta');

  const partial = policy.evaluatePolicy(
    {
      number: 21,
      body: goodPrBody(),
      additions: 4000,
      deletions: 100,
      changedFiles: 900,
      files: [{ path: 'backend/core/x.py', additions: 10, deletions: 0, status: 'modified' }],
      reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
      comments: [],
      author: { login: 'sechgio' },
    },
    { partial: true },
  );
  assert(
    partial.checks.some((c) => c.id === 'tamano' && c.status === 'skip'),
    'con el listado de archivos incompleto no se bloquea por tamaño',
  );
  assert(
    partial.checks.some((c) => c.id === 'alcance' && c.status === 'skip'),
    'con datos parciales el check de alcance se omite',
  );
  eq(partial.verdict, 'warning', 'un dato incompleto no convierte el aviso en bloqueo');

  assert(policy.shouldFail({ verdict: 'blocked' }), 'un veredicto bloqueado hace fallar el job');
  assert(!policy.shouldFail({ verdict: 'warning' }), 'un aviso no tumba el job');
  assert(!policy.shouldFail({ verdict: 'ok' }), 'sin problemas nada falla');

  assert(policy.isBot({ login: 'github-actions', type: 'Bot' }), 'REST identifica bots por user.type');
  assert(!policy.isBot({ login: 'sechgio', type: 'User' }), 'un humano no es bot');

  const report = policy.renderReport({ number: 22, author: { login: 'sechgio' } }, partial, { headSha: 'abc1234567890' });
  assert(report.includes('### Avisos para el revisor'), 'el informe agrupa los avisos');
  assert(report.includes('Commit auditado: `abc1234`'), 'el informe identifica el commit auditado');
}

async function run() {
  console.log('Testing review policy and metrics...');
  testArtifacts();
  testClassifySize();
  testIsTestPath();
  testApproval();
  testTaxonomy();
  testEffectiveBody();
  testGeneratedPaths();
  testUnmeasurableSize();
  testIntentExemptions();
  testRiskSection();
  testTaxonomyIgnoresAuthor();
  testStabilityAndExemptions();
  await testCommentTruncation();
  await testCommentPagination();
  testMetricsRounds();
  testDraftDowngrade();
  testSelectPolicyComment();
  await testPrAuditNormalizers();
  testEvaluatePolicy();
  testAdvisoryChecks();
  testMetrics();

  finish();
}

run();
