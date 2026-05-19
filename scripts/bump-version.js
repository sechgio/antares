/**
 * Bump version across all project files and optionally commit/tag/push.
 * Usage: node scripts/bump-version.js [patch|minor|major] [--push]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function bumpVersion(current, type) {
  const [major, minor, patch] = current.split('.').map(Number);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function updateFile(filePath, replacements) {
  if (!fs.existsSync(filePath)) return;
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

const args = process.argv.slice(2);
const type = args.find(a => ['patch', 'minor', 'major'].includes(a)) || 'patch';
const shouldPush = args.includes('--push');

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

updateFile('pyproject.toml', [
  { regex: /^version\s*=\s*"[^"]+"/m, template: `version = "${newVersion}"` },
]);

console.log(`\nVersion bumped to ${newVersion}`);

if (shouldPush) {
  try {
    console.log('\nCommitting and tagging...');
    execSync(`git add -A`, { stdio: 'inherit' });
    execSync(`git commit -m "release: v${newVersion}"`, { stdio: 'inherit' });
    execSync(`git tag v${newVersion}`, { stdio: 'inherit' });
    console.log('Pushing changes and tags...');
    execSync(`git push && git push --tags`, { stdio: 'inherit' });
    console.log('\n✓ Successfully pushed changes and tags.');
    console.log('The GitHub Action will now build and create the release.');
  } catch (err) {
    console.error('\n✗ Failed to execute git commands:', err.message);
    process.exit(1);
  }
} else {
  console.log('Remember to commit and tag:');
  console.log(`  git add -A && git commit -m "release: v${newVersion}" && git tag v${newVersion} && git push && git push --tags`);
}
