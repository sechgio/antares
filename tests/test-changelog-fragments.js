const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { assert, eq, finish } = require('./helpers/harness');

const ROOT = path.join(__dirname, '..');
const fragments = require(path.join(ROOT, 'scripts', 'lib', 'changelog-fragments'));

function testParseSections() {
  console.log('\nparseSections:');

  const valid = fragments.parseSections('### Added\n- una cosa\n- otra cosa\n\n### Fixed\n- arreglo\n');
  eq(valid.errors.length, 0, 'un fragmento bien formado no tiene errores');
  eq(valid.sections.get('Added').length, 2, 'cuenta los items de Added');
  eq(valid.sections.get('Fixed').length, 1, 'cuenta los items de Fixed');

  const unknown = fragments.parseSections('### Cosas\n- item\n');
  assert(unknown.errors.length > 0, 'una sección desconocida es error');

  const empty = fragments.parseSections('### Added\n\n### Fixed\n- item\n');
  assert(
    empty.errors.some((e) => e.includes('### Added')),
    'una sección sin items es error',
  );

  const stray = fragments.parseSections('texto suelto\n### Added\n- item\n');
  assert(
    stray.errors.some((e) => e.includes('fuera de sección')),
    'el contenido fuera de sección es error',
  );

  const noSections = fragments.parseSections('- item sin sección\n');
  assert(noSections.errors.length > 0, 'un fragmento sin secciones es error');

  const continuation = fragments.parseSections('### Added\n- item largo\n  que continúa\n');
  eq(continuation.errors.length, 0, 'la continuación indentada no es error');
  assert(continuation.sections.get('Added')[0].includes('que continúa'), 'la continuación se pliega al item anterior');
}

function testConsolidate() {
  console.log('\nconsolidateChangelog:');

  const changelog = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '- cosa manual en unreleased',
    '',
    '### Fixed',
    '- arreglo manual',
    '',
    '## [1.2.3] — 2026-01-01',
    '',
    '### Added',
    '- entrada vieja',
    '',
  ].join('\n');

  const frags = [
    {
      name: 'feat-b.md',
      sections: new Map([
        ['Added', ['cosa de la rama b']],
        ['Security', ['parche de seguridad']],
      ]),
      errors: [],
    },
    { name: 'feat-a.md', sections: new Map([['Fixed', ['arreglo de la rama a']]]), errors: [] },
  ];

  const out = fragments.consolidateChangelog(changelog, '1.3.0', '2026-11-25', frags);

  assert(
    /## \[Unreleased\]\n\n## \[1\.3\.0\] — 2026-11-25/.test(out),
    'unreleased queda vacío y sigue la entrada de versión',
  );
  assert(
    /## \[1\.3\.0\] — 2026-11-25/.test(out),
    'la entrada lleva el formato que valida release-loop (## [X.Y.Z] — YYYY-MM-DD)',
  );

  const entryMatch = out.match(/## \[1\.3\.0\][\s\S]*?(?=## \[1\.2\.3\])/);
  assert(entryMatch, 'la entrada de versión existe antes de las entradas viejas');
  const entry = entryMatch[0];
  assert(entry.includes('- cosa manual en unreleased'), 'conserva los items manuales de Unreleased');
  assert(entry.includes('- cosa de la rama b'), 'incluye los items de los fragmentos');
  assert(entry.includes('- arreglo de la rama a'), 'incluye fragmentos de otras secciones');
  assert(entry.includes('### Security'), 'incluye secciones que solo tienen los fragmentos');
  assert(
    entry.indexOf('### Added') < entry.indexOf('### Fixed') &&
      entry.indexOf('### Fixed') < entry.indexOf('### Security'),
    'las secciones siguen el orden canónico',
  );
  const addedItems = entry.match(/### Added\n([\s\S]*?)\n\n/);
  assert(
    addedItems && addedItems[1].indexOf('cosa manual en unreleased') < addedItems[1].indexOf('cosa de la rama b'),
    'los items de Unreleased van antes que los de fragmentos',
  );
  assert(
    !entry.includes('## [Unreleased]') || entry.indexOf('## [Unreleased]') < entry.indexOf('## [1.3.0]'),
    'unreleased no queda dentro de la entrada',
  );
  assert(out.includes('## [1.2.3] — 2026-01-01'), 'las entradas viejas se conservan');
  assert(out.includes('- entrada vieja'), 'el contenido viejo se conserva verbatim');

  const emptyUnreleased = ['# Changelog', '', '## [Unreleased]', '', '## [1.2.3] — 2026-01-01', ''].join('\n');
  const out2 = fragments.consolidateChangelog(emptyUnreleased, '1.3.0', '2026-11-25', frags);
  assert(out2.includes('## [1.3.0] — 2026-11-25'), 'consolida aunque Unreleased esté vacío');

  const noUnreleased = ['# Changelog', '', '## [1.2.3] — 2026-01-01', ''].join('\n');
  const out3 = fragments.consolidateChangelog(noUnreleased, '1.3.0', '2026-11-25', frags);
  assert(out3.includes('## [Unreleased]'), 'crea la sección Unreleased si no existe');
  assert(
    out3.indexOf('## [Unreleased]') < out3.indexOf('## [1.3.0]') &&
      out3.indexOf('## [1.3.0]') < out3.indexOf('## [1.2.3]'),
    'la entrada nueva queda antes de las viejas',
  );
}

function testReleaseLoopFormat() {
  console.log('\nCompatibilidad con release-loop:');

  const releaseLoop = fs.readFileSync(path.join(ROOT, 'scripts', 'release-loop.js'), 'utf8');
  const regexMatch = releaseLoop.match(/headerRegex = new RegExp\(`([^`]+)`\)/);
  assert(regexMatch, 'release-loop sigue validando el encabezado de versión');

  const out = fragments.consolidateChangelog('# Changelog\n\n## [Unreleased]\n', '2.0.0', '2026-11-25', [
    { name: 'feat-x.md', sections: new Map([['Added', ['algo']]]), errors: [] },
  ]);
  const headerRegex = new RegExp(`## \\[${'2.0.0'.replace(/\./g, '\\.')}\\]\\s*—\\s*\\d{4}-\\d{2}-\\d{2}`);
  assert(headerRegex.test(out), 'la salida consolidada satisface la regex de validación de release-loop');

  const sectionMatch = out.match(/## \[2\.0\.0\][\s\S]*/);
  assert(
    sectionMatch && /###\s+(Added|Changed|Deprecated|Removed|Fixed|Security)/.test(sectionMatch[0]),
    'la entrada consolidada tiene secciones',
  );
}

function testBumpIntegration() {
  console.log('\nIntegración en bump-version:');

  const bump = fs.readFileSync(path.join(ROOT, 'scripts', 'bump-version.js'), 'utf8');
  assert(bump.includes("require('./lib/changelog-fragments')"), 'bump-version usa la librería de fragmentos');
  assert(bump.includes('consolidateReleaseNotes'), 'bump-version consolida las notas de release');
  assert(bump.includes('unlinkSync'), 'bump-version borra los fragmentos consolidados');
  const callSite = bump.indexOf('\nconsolidateReleaseNotes(newVersion);');
  assert(
    callSite > bump.indexOf("updateFile('pyproject.toml'"),
    'la consolidación ocurre tras actualizar las versiones',
  );
}

function testCheckScript() {
  console.log('\ncheck-release-notes:');

  const script = path.join(ROOT, 'scripts', 'check-release-notes.js');
  const empty = execFileSync(process.execPath, [script], { cwd: ROOT, encoding: 'utf8' });
  assert(empty.includes('nada que validar') || empty.includes('válidos'), 'el script corre sobre changelog.d real');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-changelog-'));
  try {
    fs.writeFileSync(path.join(tmp, 'valid.md'), '### Fixed\n- un arreglo\n');
    fs.writeFileSync(path.join(tmp, 'broken.md'), 'cosas sin sección\n');
    const probe = `
      const { validateFragmentText } = require(${JSON.stringify(path.join(ROOT, 'scripts', 'lib', 'changelog-fragments.js'))});
      const fs = require('fs');
      const valid = validateFragmentText(fs.readFileSync(${JSON.stringify(path.join(tmp, 'valid.md'))}, 'utf8'));
      const broken = validateFragmentText(fs.readFileSync(${JSON.stringify(path.join(tmp, 'broken.md'))}, 'utf8'));
      console.log(JSON.stringify({ valid: valid.length, broken: broken.length }));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8' }));
    eq(result.valid, 0, 'control positivo: un fragmento válido no produce errores');
    assert(result.broken > 0, 'control de habla: el validador detecta un fragmento roto (no está mudo)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testPolicyIntegration() {
  console.log('\nIntegración en review-policy:');

  const policy = require(path.join(ROOT, 'scripts', 'review-policy-check.js'));
  const base = {
    number: 77,
    body: [
      '## What / Why',
      '',
      'Descripción suficientemente larga del cambio para pasar la intención declarada del PR.',
      'Sigue explicando el porqué del cambio con más detalle todavía.',
      '',
      '## Risk',
      '',
      '- [x] Ninguna de las anteriores',
    ].join('\n'),
    additions: 20,
    deletions: 5,
    files: [
      { path: 'backend/core/repository.py', additions: 10, deletions: 5 },
      { path: 'tests/test_repository.py', additions: 10, deletions: 0 },
    ],
    reviews: [{ author: { login: 'revisora' }, state: 'APPROVED' }],
    comments: [],
    author: { login: 'sechgio' },
  };

  const missing = policy.evaluatePolicy(base);
  const check = missing.checks.find((c) => c.id === 'changelog');
  assert(check, 'existe el check de release notes');
  eq(check.status, 'fail', 'sin fragmento ni etiqueta el check falla');
  eq(missing.verdict, 'blocked', 'sin fragmento ni etiqueta el PR queda bloqueado');

  const withFragment = policy.evaluatePolicy({
    ...base,
    files: [...base.files, { path: 'changelog.d/feat-x.md', additions: 2, deletions: 0, status: 'added' }],
  });
  eq(
    withFragment.checks.find((c) => c.id === 'changelog').status,
    'pass',
    'un fragmento en changelog.d/ satisface el check',
  );

  const withLabel = policy.evaluatePolicy({ ...base, labels: [{ name: 'no-changelog' }] });
  eq(withLabel.checks.find((c) => c.id === 'changelog').status, 'pass', 'la etiqueta no-changelog satisface el check');

  const bot = policy.evaluatePolicy({ ...base, author: { login: 'dependabot[bot]', is_bot: true } });
  eq(bot.checks.find((c) => c.id === 'changelog').status, 'skip', 'los bots no necesitan notas de release');

  const draft = policy.evaluatePolicy({ ...base, isDraft: true });
  assert(draft.checks.find((c) => c.id === 'changelog').status !== 'fail', 'un borrador no falla por release notes');
}

testParseSections();
testConsolidate();
testReleaseLoopFormat();
testBumpIntegration();
testCheckScript();
testPolicyIntegration();
finish();
