'use strict';

const { assert, finish } = require('./helpers/harness');
const engine = require('../electron/agent-policy-engine');

const WINDOWS = process.platform === 'win32';
const ROOT = WINDOWS ? 'C:\\workspace' : '/workspace';
const FILE = WINDOWS ? 'C:\\workspace\\inbox\\a.xlsx' : '/workspace/inbox/a.xlsx';
const OUTSIDE = WINDOWS ? 'C:\\other\\b.xlsx' : '/other/b.xlsx';
const SIBLING = WINDOWS ? 'C:\\workspace-evil\\c.xlsx' : '/workspace-evil/c.xlsx';

function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

try {
  // --- Validación ---
  assert(engine.validateScopedRules(null).length === 0, 'sin reglas devuelve lista vacía');
  const valid = engine.validateScopedRules([
    { scope: 'command', value: 'git status', decision: 'allow' },
    { scope: 'path', value: ROOT, decision: 'allow' },
    { scope: 'domain', value: 'Example.COM.', decision: 'deny' },
    { scope: 'app', value: 'Excel', decision: 'ask' },
    { scope: 'mcp', value: 'servidor/herramienta', decision: 'allow' },
  ]);
  assert(valid.length === 5, 'acepta las cinco clases de scope');
  assert(valid[2].value === 'example.com', 'el dominio se normaliza a minúsculas sin punto final');
  assert(valid[3].value === 'excel', 'la app se normaliza a minúsculas');
  assert(throws(() => engine.validateScopedRules({})), 'un mapa no es una lista de reglas');
  assert(throws(() => engine.validateScopedRules([{ scope: 'nope', value: 'x', decision: 'allow' }])), 'scope desconocido');
  assert(throws(() => engine.validateScopedRules([{ scope: 'path', value: 'x', decision: 'nope' }])), 'decisión desconocida');
  assert(throws(() => engine.validateScopedRules([{ scope: 'path', value: '', decision: 'deny' }])), 'valor vacío');
  assert(throws(() => engine.validateScopedRules([
    { scope: 'command', value: 'git', decision: 'allow' },
    { scope: 'command', value: 'git', decision: 'deny' },
  ])), 'duplicados se rechazan');

  const rootValue = WINDOWS ? 'C:\\' : '/';
  assert(throws(() => engine.validateScopedRules([{ scope: 'path', value: rootValue, decision: 'allow' }])),
    'no se puede permitir el disco completo');
  assert(!throws(() => engine.validateScopedRules([{ scope: 'path', value: rootValue, decision: 'deny' }])),
    'sí se puede bloquear el disco completo');
  assert(throws(() => engine.validateScopedRules([{ scope: 'path', value: `${ROOT}*`, decision: 'allow' }])),
    'las rutas allow no admiten comodines');
  assert(throws(() => engine.validateScopedRules([{ scope: 'command', value: 'git status > out', decision: 'allow' }])),
    'un comando allow no puede contener redirección');
  assert(throws(() => engine.validateScopedRules([{ scope: 'command', value: '&&', decision: 'allow' }])),
    'un comando allow necesita un comando concreto');
  assert(throws(() => engine.validateScopedRules([{ scope: 'domain', value: 'x', decision: 'allow' }])),
    'un dominio allow necesita un host válido');

  // --- Extracción de objetivos ---
  const shellTargets = engine.extractTargets('shell_run', { command: 'git status' });
  assert(shellTargets.command === 'git status', 'extrae el comando de shell_run');
  const fsTargets = engine.extractTargets('fs_write', { path: FILE });
  assert(fsTargets.paths.includes(FILE), 'extrae la ruta de fs_write');
  const webTargets = engine.extractTargets('web_click', {}, { domain: 'example.com' });
  assert(webTargets.domain === 'example.com', 'el dominio sale del contexto de aprobación');
  const openTargets = engine.extractTargets('web_open', { url: 'https://sub.example.com/page' });
  assert(openTargets.domain === 'sub.example.com', 'web_open extrae el dominio de la url');
  const cuaTargets = engine.extractTargets('cua_click', {}, { computer: { app: 'excel' } });
  assert(cuaTargets.app === 'excel', 'la app sale del contexto computer');
  const mcpTargets = engine.extractTargets('mcp__github__create_issue', {});
  assert(mcpTargets.mcp_server === 'github' && mcpTargets.mcp_tool === 'create_issue', 'descompone herramientas MCP');
  const mcp2Targets = engine.extractTargets('mcp2__srv-0123456789ab__do-0123456789ab', {});
  assert(mcp2Targets.mcp_server === 'srv-0123456789ab', 'también el formato mcp2');

  // --- Matching de comandos: allow estricto por segmentos ---
  assert(engine.commandMatches('git', 'git status', true), 'prefijo de tokens coincide');
  assert(engine.commandMatches('git status', 'git status', true), 'comando completo coincide');
  assert(!engine.commandMatches('git status', 'git statusx', true), 'los tokens son completos, no subcadenas');
  assert(!engine.commandMatches('git status', 'git diff', true), 'otro subcomando no coincide');
  assert(!engine.commandMatches('git', 'git status && rm file', true),
    'allow estricto: un segmento que no coincide rompe el match');
  assert(engine.commandMatches('git', 'git status && git diff', true),
    'allow estricto: todos los segmentos git coinciden');
  assert(engine.commandMatches('rm', 'git status && rm file', false),
    'deny amplio: basta un segmento coincidente');
  assert(!engine.commandMatches('git', 'git status > out.txt', true),
    'la redirección bloquea el match de allow');
  assert(!engine.commandMatches('git', 'echo $(whoami)', true),
    'la ejecución dinámica bloquea el match de allow');
  assert(engine.commandMatches('echo', 'echo $(whoami)', false),
    'la ejecución dinámica no bloquea el match de deny');

  // --- Matching de rutas con frontera ---
  assert(engine.pathMatches(ROOT, FILE), 'la regla cubre archivos bajo la carpeta');
  assert(engine.pathMatches(ROOT, ROOT), 'la carpeta exacta coincide');
  assert(!engine.pathMatches(ROOT, OUTSIDE), 'una ruta fuera no coincide');
  assert(!engine.pathMatches(ROOT, SIBLING), 'un prefijo sin frontera de carpeta no coincide');

  // --- Matching de dominios ---
  assert(engine.domainMatches('example.com', 'example.com'), 'dominio exacto');
  assert(engine.domainMatches('example.com', 'sub.example.com'), 'subdominio cubierto');
  assert(!engine.domainMatches('example.com', 'notexample.com'), 'sin frontera de etiqueta no coincide');
  assert(!engine.domainMatches('example.com', 'example.com.evil.com'), 'un dominio que lo contiene no es subdominio');

  // --- Evaluación con precedencia ---
  const targets = { command: 'git status', paths: [FILE], domain: 'example.com', app: 'excel' };
  const denyWins = engine.evaluateScoped([
    { scope: 'command', value: 'git', decision: 'allow' },
    { scope: 'command', value: 'git status', decision: 'deny' },
  ], targets);
  assert(denyWins.decision === 'deny' && denyWins.rule.value === 'git status', 'deny gana aunque haya allow');
  const askForces = engine.evaluateScoped([
    { scope: 'command', value: 'git', decision: 'allow' },
    { scope: 'command', value: 'git status', decision: 'ask' },
  ], targets);
  assert(askForces.decision === 'ask', 'ask fuerza revisión manual sobre allow');
  const mostSpecific = engine.evaluateScoped([
    { scope: 'command', value: 'git', decision: 'deny' },
    { scope: 'command', value: 'git status', decision: 'deny' },
  ], targets);
  assert(mostSpecific.rule.value === 'git status', 'entre denies gana el más específico para explicar');
  assert(engine.evaluateScoped([
    { scope: 'command', value: 'git', decision: 'allow' },
  ], targets).decision === 'allow', 'allow simple se evalúa');
  assert(engine.evaluateScoped([
    { scope: 'command', value: 'npm', decision: 'allow' },
  ], targets) === null, 'sin match no hay decisión');
  assert(engine.evaluateScoped([], targets) === null, 'sin reglas no hay decisión');

  const mcpEval = engine.evaluateScoped([
    { scope: 'mcp', value: 'github', decision: 'allow' },
  ], { mcp_server: 'github', mcp_tool: 'create_issue' });
  assert(mcpEval.decision === 'allow', 'la regla de servidor cubre todas sus herramientas');
  const mcpExact = engine.evaluateScoped([
    { scope: 'mcp', value: 'github/create_issue', decision: 'deny' },
    { scope: 'mcp', value: 'github', decision: 'allow' },
  ], { mcp_server: 'github', mcp_tool: 'create_issue' });
  assert(mcpExact.decision === 'deny', 'la regla exacta de herramienta MCP gana');

  // --- Reglas de turno en memoria ---
  engine.addTurnRule('conv1', { scope: 'command', value: 'git', decision: 'allow' });
  assert(engine.turnRulesFor('conv1').length === 1, 'la regla de turno se guarda en memoria');
  assert(engine.turnRulesFor('conv2').length === 0, 'otra conversación no la ve');
  engine.clearTurnRules('conv1');
  assert(engine.turnRulesFor('conv1').length === 0, 'limpiar el turno elimina sus reglas');


  // --- MCP mcp2: la identidad real del spec gana al alias con hashes ---
  const realTargets = engine.extractTargets(
    'mcp2__github-a1b2c3d4e5f6__create_issue-f6e5d4c3b2a1',
    {},
    { mcp_server: 'GitHub', mcp_tool: 'create_issue' },
  );
  assert(realTargets.mcp_server === 'github', 'la regla usa el nombre que el usuario ve en Conexiones');
  assert(realTargets.mcp_tool === 'create_issue', 'y la herramienta real, no el alias con hash');
  const mcp2Rule = engine.evaluateScoped([
    { scope: 'mcp', value: 'github/create_issue', decision: 'allow' },
  ], realTargets);
  assert(mcp2Rule.decision === 'allow', 'una regla github/create_issue matchea herramientas mcp2 reales');
  const mcp2Deny = engine.evaluateScoped([
    { scope: 'mcp', value: 'github/delete_repo', decision: 'deny' },
  ], realTargets);
  assert(!mcp2Deny || mcp2Deny.decision !== 'deny', 'otra herramienta no hereda el deny');
  const fallback = engine.extractTargets('mcp2__srv-0123456789ab__do-0123456789ab', {});
  assert(fallback.mcp_server === 'srv-0123456789ab', 'sin contexto cae al parseo del nombre');

  finish();
} catch (err) {
  console.error(err);
  process.exit(1);
}
