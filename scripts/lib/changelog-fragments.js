const fs = require('fs');
const path = require('path');

const SECTION_ORDER = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];

function parseSections(text) {
  const sections = new Map();
  const errors = [];
  const strayLines = [];
  let current = null;
  let lastItem = null;
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((line, index) => {
    const heading = line.match(/^###\s+(\S+)\s*$/);
    if (heading) {
      const name = heading[1];
      if (!SECTION_ORDER.includes(name)) {
        errors.push(`sección desconocida "### ${name}" (línea ${index + 1}); válidas: ${SECTION_ORDER.join(', ')}`);
        current = null;
        lastItem = null;
        return;
      }
      if (!sections.has(name)) sections.set(name, []);
      current = name;
      lastItem = null;
      return;
    }
    if (/^##\s/.test(line) || /^#\s/.test(line)) {
      errors.push(`encabezado fuera de lugar (línea ${index + 1}): los fragmentos solo usan secciones ###`);
      return;
    }
    if (line.trim() === '') return;
    if (/^\s*[-*]\s+/.test(line)) {
      if (!current) {
        strayLines.push(index + 1);
        return;
      }
      const item = line.replace(/^\s*[-*]\s+/, '').trim();
      sections.get(current).push(item);
      lastItem = sections.get(current).length - 1;
      return;
    }
    if (current && lastItem !== null && /^\s+\S/.test(line)) {
      const items = sections.get(current);
      items[lastItem] = `${items[lastItem]} ${line.trim()}`;
      return;
    }
    if (!current) strayLines.push(index + 1);
  });
  if (strayLines.length > 0) {
    errors.push(`contenido fuera de sección en líneas ${strayLines.join(', ')}: cada item va bajo una sección ###`);
  }
  for (const [name, items] of sections) {
    if (items.length === 0) errors.push(`la sección "### ${name}" no tiene items`);
  }
  if (sections.size === 0 && errors.length === 0) {
    errors.push('no tiene ninguna sección ### (Added, Changed, Fixed, …)');
  }
  return { sections, errors };
}

function validateFragmentText(text) {
  return parseSections(text).errors;
}

function fragmentFileNames(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b));
}

function collectFragments(dir) {
  return fragmentFileNames(dir).map((name) => {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    return { name, ...parseSections(text) };
  });
}

function extractUnreleased(changelogText) {
  const lines = String(changelogText || '').split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+\[Unreleased\]/i.test(line));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start + 1, end).join('\n');
  return { start, end, body, ...parseSections(body) };
}

function renderSections(merged) {
  const out = [];
  for (const name of SECTION_ORDER) {
    const items = merged.get(name);
    if (!items || items.length === 0) continue;
    out.push(`### ${name}\n`);
    for (const item of items) out.push(`- ${item}`);
    out.push('');
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function consolidateChangelog(changelogText, version, date, fragments) {
  const unreleased = extractUnreleased(changelogText);
  const merged = new Map();
  const append = (sections) => {
    for (const [name, items] of sections) {
      if (!merged.has(name)) merged.set(name, []);
      merged.get(name).push(...items);
    }
  };
  if (unreleased) append(unreleased.sections);
  for (const fragment of fragments) append(fragment.sections);

  const entry = `## [${version}] — ${date}\n\n${renderSections(merged)}\n`;
  const lines = String(changelogText || '').split(/\r?\n/);

  if (unreleased) {
    const before = lines.slice(0, unreleased.start);
    const after = lines.slice(unreleased.end);
    const result = [...before, '## [Unreleased]', '', entry.trimEnd(), '', ...after];
    return result.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  const firstVersion = lines.findIndex((line) => /^##\s+\[/.test(line));
  const insertAt = firstVersion === -1 ? lines.length : firstVersion;
  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  while (before.length > 0 && before[before.length - 1].trim() === '') before.pop();
  const result = [...before, '', '## [Unreleased]', '', entry.trimEnd(), '', ...after];
  return result.join('\n').replace(/\n{3,}/g, '\n\n');
}

module.exports = {
  SECTION_ORDER,
  parseSections,
  validateFragmentText,
  fragmentFileNames,
  collectFragments,
  extractUnreleased,
  consolidateChangelog,
};
