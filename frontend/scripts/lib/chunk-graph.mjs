import fs from 'node:fs';
import path from 'node:path';

const IMPORT_SIDE_EFFECT_RE = /(?:^|[^\w.$])import\s*["'](\.\/[^"']+\.js)["']/g;
const FROM_SPECIFIER_RE = /(?:^|[^\w.$])from\s*["'](\.[^"']+\.js)["']/g;

export function shellChunkNames(html) {
  const names = new Set();
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
    const tag = match[0];
    const isModuleScript = /^<script\b/.test(tag) && /type\s*=\s*["']module["']/.test(tag);
    const isModulePreload = /^<link\b/.test(tag) && /rel\s*=\s*["']modulepreload["']/.test(tag);
    if (!isModuleScript && !isModulePreload) continue;
    const ref = tag.match(/(?:src|href)\s*=\s*["']([^"']+)["']/);
    if (!ref) continue;
    const base = path.posix.basename(ref[1].split('?')[0]);
    if (base.endsWith('.js')) names.add(base);
  }
  return [...names];
}

function staticSpecifiers(code) {
  const specs = new Set();
  for (const re of [IMPORT_SIDE_EFFECT_RE, FROM_SPECIFIER_RE]) {
    re.lastIndex = 0;
    for (const match of code.matchAll(re)) specs.add(match[1]);
  }
  return [...specs];
}

/**
 * Static import closure of `seeds`, as a Map from chunk file name to the chunk
 * that pulled it in. Dynamic `import()` is excluded on purpose: those files are
 * not on the parse path of the seed.
 */
export function staticClosure({ jsDir, seeds }) {
  const reached = new Map();
  const queue = [];
  for (const seed of seeds) {
    if (!fs.existsSync(path.join(jsDir, seed))) continue;
    reached.set(seed, null);
    queue.push(seed);
  }

  while (queue.length) {
    const from = queue.shift();
    const code = fs.readFileSync(path.join(jsDir, from), 'utf8');
    for (const spec of staticSpecifiers(code)) {
      const rel = path.posix.normalize(path.posix.join('.', spec)).replace(/^\.\//, '');
      if (!fs.existsSync(path.join(jsDir, rel)) || reached.has(rel)) continue;
      reached.set(rel, from);
      queue.push(rel);
    }
  }
  return reached;
}

export function importChain(closure, name) {
  const chain = [];
  for (let at = name; at; at = closure.get(at)) chain.push(at);
  return chain.reverse();
}
