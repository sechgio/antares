const fs = require('fs');
const path = require('path');

const { assert, finish } = require('./helpers/harness');

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
  assert(fs.existsSync(template), 'plantilla de PR existe');
  const text = fs.readFileSync(template, 'utf8');
  assert(text.includes('## Risk'), 'la plantilla pide la sección de riesgo');
  assert(/npm run ci/.test(text), 'la plantilla exige CI en local');
  assert(text.includes('suggestion:'), 'la plantilla recuerda la taxonomía al revisor');

  const workflow = path.join(ROOT, '.github', 'workflows', 'review-policy.yml');
  assert(fs.existsSync(workflow), 'workflow review-policy.yml existe');
  const wf = fs.readFileSync(workflow, 'utf8').replace(/\r\n/g, '\n');
  const refs = [...wf.matchAll(/uses:\s+actions\/[^@\s]+@([^\s#]+)/g)].map((m) => m[1]);
  assert(refs.length > 0, 'el workflow usa acciones de GitHub');
  assert(
    refs.every((r) => /^[0-9a-f]{40}$/.test(r)),
    'el workflow fija cada acción a un SHA completo',
  );
  assert(/permissions:/.test(wf) && /contents:\s+read/.test(wf), 'el workflow limita contents a solo lectura');
  assert(/issues:\s+write/.test(wf), 'el workflow puede publicar y editar comentarios del PR');
  assert(wf.includes('edited'), 'el workflow reacciona a ediciones de la descripción');
  assert(wf.includes('labeled'), 'el workflow reacciona a cambios de etiquetas');
  assert(wf.includes('--fail-on blocking'), 'el workflow fija el umbral de bloqueo');
  assert(wf.includes('^[1-9][0-9]*$'), 'el workflow valida pr_number en dispatch');
  assert(wf.includes('timeout-minutes:'), 'el workflow acota su tiempo de ejecución');
  assert(wf.includes('persist-credentials: false'), 'el checkout no persiste credenciales');

  const auditModule = path.join(ROOT, 'scripts', 'lib', 'pr-audit.js');
  assert(fs.existsSync(auditModule), 'la capa de datos del PR vive en su propio módulo');
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
  eq(partial.verdict, 'warning', 'un dato incompleto no convierte el aviso en bloqueo');

  const withVerdict = (verdict) => ({ verdict, checks: [], stats: {} });
  assert(!policy.shouldFail(withVerdict('blocked'), 'never'), 'never nunca falla');
  assert(policy.shouldFail(withVerdict('blocked'), policy.BLOCKING), 'blocking falla ante bloqueos');
  assert(!policy.shouldFail(withVerdict('warning'), policy.BLOCKING), 'blocking ignora los avisos');
  assert(policy.shouldFail(withVerdict('warning'), 'advisory'), 'advisory sí exige limpiar avisos');
  assert(!policy.shouldFail(withVerdict('ok'), 'advisory'), 'sin avisos nada falla');

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
  testDraftDowngrade();
  testSelectPolicyComment();
  await testPrAuditNormalizers();
  testEvaluatePolicy();
  testAdvisoryChecks();
  testMetrics();

  finish();
}

run();
