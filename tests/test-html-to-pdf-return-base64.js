const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'frontend', 'src');

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'dist') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(ent.name) && !ent.name.endsWith('.test.ts') && !ent.name.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function checkFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  if (!src.includes('htmlToPdf(') || !src.includes('pdf_base64')) return [];

  const violations = [];
  let idx = 0;
  while ((idx = src.indexOf('htmlToPdf(', idx)) !== -1) {
    const start = idx;
    let depth = 0;
    let end = -1;
    for (let i = idx + 'htmlToPdf'.length; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) break;
    const call = src.slice(start, end + 1);
    const after = src.slice(end, Math.min(src.length, end + 400));
    const usesBase64 = /\.pdf_base64\b/.test(after) || /pdf\.pdf_base64\b/.test(after);
    if (usesBase64 && !/return_base64\s*:/.test(call)) {
      violations.push({
        file: path.relative(path.join(__dirname, '..'), filePath),
        snippet: call.slice(0, 120).replace(/\s+/g, ' '),
      });
    }
    idx = end + 1;
  }
  return violations;
}

function main() {
  console.log('Checking htmlToPdf callers for return_base64 when reading pdf_base64...\n');
  const files = walk(ROOT);
  const all = files.flatMap(checkFile);
  for (const v of all) {
    console.error(`  ✗ ${v.file}: ${v.snippet}…`);
  }
  assert.strictEqual(all.length, 0, `${all.length} htmlToPdf caller(s) read pdf_base64 without return_base64`);
  console.log(`  ✓ scanned ${files.length} files — no violations`);
}

main();
