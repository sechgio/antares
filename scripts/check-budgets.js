#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { shared } = require('../electron/agent-shared');
const execution = require('../electron/agent-execution');
const { basePromptEstimate } = require('../electron/agent-prompt-budget');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'frontend', 'dist', 'index.html');
const SOURCE_ROOTS = [path.join(ROOT, 'frontend'), path.join(ROOT, 'shared')];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'coverage', '.vite']);

function sh(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  execFileSync(cmd, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    ...opts,
  });
}

function newestMtimeMs(dir) {
  let newest = 0;
  const stack = [dir];
  while (stack.length) {
    let entries;
    const current = stack.pop();
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      try {
        newest = Math.max(newest, fs.statSync(full).mtimeMs);
      } catch {}
    }
  }
  return newest;
}

function distMatchesSources() {
  if (!fs.existsSync(INDEX_HTML)) return false;
  const builtAt = fs.statSync(INDEX_HTML).mtimeMs;
  return SOURCE_ROOTS.every((src) => newestMtimeMs(src) <= builtAt);
}

if (!distMatchesSources()) {
  console.log('frontend/dist está ausente o más viejo que sus fuentes — construyendo para medir...');
  sh('npm run build:frontend');
}

sh('node frontend/scripts/canvas-appear-budget.mjs');
sh('node frontend/scripts/shell-preload-budget.mjs');

// Techo de tokens del prompt base del agente (sistema + herramientas por defecto +
// avisos fijos) definido en shared/budgets.json. Las herramientas del backend llegan
// por el puente: se vuelcan con uv para medir fuera de la app sin duplicar esquemas;
// el resto de especificaciones las compone agent-execution en Node. Falla si el
// prompt base crece sin subir el techo de forma justificada en el PR.
async function agentPromptCheck() {
  const budgets = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'budgets.json'), 'utf8'));
  const ceiling = Number(budgets.agentPrompt && budgets.agentPrompt.maxTokens) || 0;
  if (!(ceiling > 0)) throw new Error('shared/budgets.json no define agentPrompt.maxTokens');
  console.log('$ uv run --project . --locked --extra dev python scripts/dump_agent_tool_specs.py');
  const dump = execFileSync(
    'uv',
    ['run', '--project', '.', '--locked', '--extra', 'dev', 'python', 'scripts/dump_agent_tool_specs.py'],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } },
  );
  shared.deps = { bridge: async () => JSON.parse(dump), chord: { BACKGROUND_CONTEXT: {} } };
  shared.state = { harness: { snapshot: async () => ({}) } };
  const specs = await execution.allToolSpecs();
  const estimate = await basePromptEstimate(specs, {
    defaultToolNames: execution.defaultToolNames,
    reminderTexts: execution.reminderTexts,
  });
  console.log(`[agentPrompt] prompt base estimado en ${estimate.tokens} tokens `
    + `(sistema ${estimate.system} + herramientas ${estimate.tools} de ${estimate.toolCount}, `
    + `selección ${estimate.toolSelection} + avisos ${estimate.reminders}); techo ${ceiling}`);
  if (estimate.tokens > ceiling) {
    throw new Error(`El prompt base del agente supera el techo: ${estimate.tokens} > ${ceiling} tokens. `
      + 'Recorta el prompt de sistema, las herramientas por defecto o los avisos; si el aumento es '
      + 'justificado, sube agentPrompt.maxTokens en shared/budgets.json y explícalo en el PR.');
  }
}

agentPromptCheck().catch((error) => {
  console.error(`[agentPrompt] ${error.message}`);
  process.exit(1);
});
