
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { collectFragments, extractUnreleased, consolidateChangelog } = require('./lib/changelog-fragments');

function consolidateReleaseNotes(newVersion) {
  const changelogPath = 'CHANGELOG.md';
  if (!fs.existsSync(changelogPath)) return;
  const changelogText = fs.readFileSync(changelogPath, 'utf8');
  const versionEscaped = newVersion.replace(/\./g, '\\.');
  if (new RegExp(`## \\[${versionEscaped}\\]`).test(changelogText)) {
    console.log(`• CHANGELOG.md ya tiene entrada para [${newVersion}]: consolidación omitida.`);
    return;
  }

  const fragmentsDir = 'changelog.d';
  const fragments = collectFragments(path.resolve(fragmentsDir));
  const invalid = fragments.filter((fragment) => fragment.errors.length > 0);
  if (invalid.length > 0) {
    console.error('\n✗ Fragmentos de release notes con errores de formato:');
    for (const fragment of invalid) {
      for (const error of fragment.errors) console.error(`  ${fragment.name}: ${error}`);
    }
    console.error('  Corrige los fragmentos en changelog.d/ antes del bump.');
    process.exit(1);
  }

  const unreleased = extractUnreleased(changelogText);
  const hasUnreleasedItems = Boolean(
    unreleased && [...unreleased.sections.values()].some((items) => items.length > 0),
  );
  if (fragments.length === 0 && !hasUnreleasedItems) {
    console.log('• Sin fragmentos en changelog.d/ ni items en [Unreleased]: CHANGELOG.md sin cambios.');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const consolidated = consolidateChangelog(changelogText, newVersion, today, fragments);
  fs.writeFileSync(changelogPath, consolidated.endsWith('\n') ? consolidated : `${consolidated}\n`, 'utf8');
  for (const fragment of fragments) fs.unlinkSync(path.join(fragmentsDir, fragment.name));
  console.log(`✓ CHANGELOG.md: ${fragments.length} fragmento(s) y [Unreleased] consolidados en [${newVersion}]`);
}

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
const shouldPr = args.includes('--pr');

if (args.includes('--push')) {
  console.error('\n✗ --push está deprecado. Los cambios van vía PR:');
  console.error('  bun run push:ship -- --message "release: vX.Y.Z"');
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

updateFile('backend/version.py', [
  { regex: /__version__\s*=\s*"[^"]+"/, template: `__version__ = "${newVersion}"` },
]);

updateFile('pyproject.toml', [
  { regex: /^version\s*=\s*"[^"]+"/m, template: `version = "${newVersion}"` },
]);

consolidateReleaseNotes(newVersion);

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
    console.log('  Tras merge a main, ejecuta: bun run release:ship');
  } catch (err) {
    console.error('\n✗ Failed to open release PR:', err.message);
    process.exit(1);
  }
} else {
  console.log('Recuerda enviar vía PR:');
  console.log(`  node scripts/bump-version.js ${type} --pr`);
  console.log('  Tras merge: bun run release:ship');
}
