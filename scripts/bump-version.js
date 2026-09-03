
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

function updateLockfileVersion(filePath, newVersion) {
  if (!fs.existsSync(filePath)) return;
  const lock = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  lock.version = newVersion;
  if (lock.packages && lock.packages['']) {
    lock.packages[''].version = newVersion;
  }
  fs.writeFileSync(filePath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
  console.log(`✓ Updated ${filePath}`);
}

const args = process.argv.slice(2);
const type = args.find(a => ['patch', 'minor', 'major'].includes(a)) || 'patch';
const shouldPr = args.includes('--pr');

if (args.includes('--push')) {
  console.error('\n✗ --push está deprecado. Los cambios van vía PR:');
  console.error('  npm run push:ship -- --message "release: vX.Y.Z"');
  console.error('  o: node scripts/bump-version.js patch --pr\n');
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

updateLockfileVersion('package-lock.json', newVersion);
updateLockfileVersion('frontend/package-lock.json', newVersion);

updateFile('backend/version.py', [
  { regex: /__version__\s*=\s*"[^"]+"/, template: `__version__ = "${newVersion}"` },
]);

updateFile('pyproject.toml', [
  { regex: /^version\s*=\s*"[^"]+"/m, template: `version = "${newVersion}"` },
]);

console.log(`\nVersion bumped to ${newVersion}`);

if (shouldPr) {
  try {
    const releaseBranch = `release/v${newVersion}`;
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    let pushArgs = `--ship --message "release: v${newVersion}" --title "release: v${newVersion}"`;

    if (currentBranch === 'main') {
      execSync(`git checkout -b "${releaseBranch}"`, { stdio: 'inherit' });
      pushArgs += ` --branch "${releaseBranch}"`;
    }

    console.log('\nEnviando bump vía PR...');
    execSync(`node scripts/push-loop.js ${pushArgs}`, { stdio: 'inherit' });
    console.log('\n✓ Versión bump enviada vía PR.');
    console.log('  Tras merge a main, ejecuta: npm run release:ship');
  } catch (err) {
    console.error('\n✗ Failed to open release PR:', err.message);
    process.exit(1);
  }
} else {
  console.log('Recuerda enviar vía PR:');
  console.log(`  node scripts/bump-version.js ${type} --pr`);
  console.log('  Tras merge: npm run release:ship');
}
