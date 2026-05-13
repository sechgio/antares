/**
 * Bump version across all project files.
 * Usage: node scripts/bump-version.js [patch|minor|major]
 */

const fs = require('fs');
const path = require('path');

function bumpVersion(current, type) {
  const [major, minor, patch] = current.split('.').map(Number);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function updateFile(filePath, replacements) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  for (const { regex, template } of replacements) {
    if (regex.test(content)) {
      content = content.replace(regex, template);
      modified = true;
    }
  }
  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✓ Updated ${path.basename(filePath)}`);
  }
}

const type = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major'].includes(type)) {
  console.error('Usage: node scripts/bump-version.js [patch|minor|major]');
  process.exit(1);
}

const rootPkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const newVersion = bumpVersion(rootPkg.version, type);

console.log(`Bumping version: ${rootPkg.version} → ${newVersion}\n`);

rootPkg.version = newVersion;
fs.writeFileSync('package.json', JSON.stringify(rootPkg, null, 2) + '\n', 'utf8');
console.log('✓ Updated package.json');

const frontendPkgPath = 'frontend/package.json';
if (fs.existsSync(frontendPkgPath)) {
  const frontendPkg = JSON.parse(fs.readFileSync(frontendPkgPath, 'utf8'));
  frontendPkg.version = newVersion;
  fs.writeFileSync(frontendPkgPath, JSON.stringify(frontendPkg, null, 2) + '\n', 'utf8');
  console.log('✓ Updated frontend/package.json');
}

updateFile('backend/version.py', [
  { regex: /__version__\s*=\s*"[^"]+"/, template: `__version__ = "${newVersion}"` },
]);

updateFile('electron/main.js', [
  { regex: /version["']?\s*:\s*["'][^"']+["']/, template: `version: "${newVersion}"` },
]);

updateFile('pyproject.toml', [
  { regex: /^version\s*=\s*"[^"]+"/m, template: `version = "${newVersion}"` },
]);

console.log(`\nVersion bumped to ${newVersion}`);
console.log('Remember to commit and tag:');
console.log(`  git add -A && git commit -m "release: v${newVersion}" && git tag v${newVersion}`);
