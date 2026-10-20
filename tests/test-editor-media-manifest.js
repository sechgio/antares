const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { assert, finish, counters } = require('./helpers/harness');

function run() {
  console.log('Testing editor media manifest...\n');

  const root = path.join(__dirname, '..');
  const manifestPath = path.join(root, 'media', 'manifest.json');
  assert(fs.existsSync(manifestPath), 'media/manifest.json exists');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert(manifest.schemaVersion === 1, 'manifest schemaVersion is 1');
  assert(Array.isArray(manifest.binaries) && manifest.binaries.length === 2, 'two binaries declared');
  assert(manifest.build && manifest.build.license, 'build license declared');

  assert(/GPL/i.test(manifest.build.license), 'build declares a GPL license');
  assert(
    manifest.build.configurationFlags.includes('--enable-gpl'),
    'build declares --enable-gpl'
  );
  assert(
    manifest.build.configurationFlags.includes('--enable-libvidstab'),
    'build declares --enable-libvidstab'
  );
  assert(
    manifest.build.configurationFlags.includes('--enable-librubberband'),
    'build declares --enable-librubberband'
  );

  const notices = path.join(root, 'media', 'LICENSE-THIRD-PARTY.txt');
  assert(fs.existsSync(notices), 'media/LICENSE-THIRD-PARTY.txt exists');

  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert(/^media\/\*$/m.test(gitignore), 'gitignore ignores media/*');
  assert(/^!media\/manifest\.json$/m.test(gitignore), 'gitignore un-ignores manifest');
  assert(
    /^!media\/LICENSE-THIRD-PARTY\.txt$/m.test(gitignore),
    'gitignore un-ignores license notices'
  );

  const anyPresent = manifest.binaries.some((b) =>
    fs.existsSync(path.join(root, 'media', b.path))
  );
  if (anyPresent) {
    for (const bin of manifest.binaries) {
      const file = path.join(root, 'media', bin.path);
      if (!fs.existsSync(file)) {
        assert(false, `declared binary ${bin.path} is missing`);
        continue;
      }
      const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      assert(digest === bin.sha256, `sha256 of ${bin.path} matches manifest`);
      assert(fs.statSync(file).size === bin.byteSize, `byteSize of ${bin.path} matches manifest`);
    }
    console.log('Binarios preparados: hashes verificados.');
  } else {
    console.log('Binarios no preparados en este entorno: solo estructura verificada.');
  }

  const script = path.join(root, 'scripts', 'prepare-editor-media.js');
  assert(fs.existsSync(script), 'scripts/prepare-editor-media.js exists');
  const scriptText = fs.readFileSync(script, 'utf8');
  assert(scriptText.includes('sha256'), 'prepare script verifies sha256');
  assert(!/git add -A|git add \./.test(scriptText), 'prepare script does not stage broadly');

  const toolchain = fs.readFileSync(path.join(root, 'backend', 'core', 'editor', 'toolchain.py'), 'utf8');
  assert(toolchain.includes("resource_path(\"media\")"), 'toolchain resolves media via resource_path');
  assert(
    /ANTARES_FFMPEG_ALLOW_PATH/.test(toolchain),
    'PATH fallback requires explicit env opt-in'
  );

  console.log(`\n${counters.passed} passed, ${counters.failed} failed`);
  finish();
}

run();
