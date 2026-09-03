const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createStagedSession,
  appendStagedChunk,
  completeStagedSession,
  abortStagedSession,
  resolveCapability,
  cleanupAllStaged,
} = require('../electron/file-capabilities.js');

async function main() {
  const session = createStagedSession({ name: 'datos.xlsx', size: 4, webContentsId: 1 });
  assert.ok(session.tmpPath.endsWith('datos.xlsx'), `staged path should end with datos.xlsx, got ${session.tmpPath}`);
  assert.ok(!session.tmpPath.endsWith('.tmp'), 'staged path must not force .tmp suffix');

  const payload = Buffer.from('PK\x03\x04');
  await appendStagedChunk(session.token, payload.toString('base64'), 1);
  const cap = await completeStagedSession(session.token, 1);
  assert.strictEqual(cap.name, 'datos.xlsx');
  assert.ok(cap.path.endsWith('datos.xlsx'), `capability path should keep .xlsx, got ${cap.path}`);
  assert.strictEqual(path.extname(cap.path), '.xlsx');

  await abortStagedSession(session.token);
  await cleanupAllStaged();

  {
    const session2 = createStagedSession({ name: 'bin.xlsx', size: 6, webContentsId: 1 });
    const raw = new Uint8Array([1, 2, 3, 4, 255, 0]);
    await appendStagedChunk(session2.token, raw, 1);
    const cap2 = await completeStagedSession(session2.token, 1);
    const written = fs.readFileSync(cap2.path);
    assert.deepStrictEqual([...written], [...raw], 'Uint8Array chunk must be written verbatim');
    await abortStagedSession(session2.token);
  }

  {
    const session3 = createStagedSession({ name: 'ab.bin', size: 4, webContentsId: 1 });
    const ab = Uint8Array.from([9, 8, 7, 6]).buffer;
    await appendStagedChunk(session3.token, ab, 1);
    const cap3 = await completeStagedSession(session3.token, 1);
    assert.deepStrictEqual([...fs.readFileSync(cap3.path)], [9, 8, 7, 6], 'ArrayBuffer chunk must be written verbatim');
    await abortStagedSession(session3.token);
  }

  {
    const session4 = createStagedSession({ name: 'cleanup.xlsx', size: 4, webContentsId: 1 });
    await appendStagedChunk(session4.token, Buffer.from('data'), 1);
    const cap4 = await completeStagedSession(session4.token, 1);
    assert.ok(fs.existsSync(cap4.path), 'completed staged file exists before cleanup');

    const { handleDialogCall } = require('../electron/dialog-handlers.js');
    const cleaned = await handleDialogCall(
      'file_token_cleanup',
      { token: cap4.token },
      {},
      { webContents: { id: 1 } },
    );
    assert.strictEqual(cleaned.result.cleaned, true);
    assert.strictEqual(fs.existsSync(cap4.path), false, 'staged file deleted by token cleanup');
    assert.throws(() => resolveCapability(cap4.token, 'read', 1), /capability not found|expired/);
  }

  const root = path.join(os.tmpdir(), `antares-staged-${process.pid}`);
  if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const { createFileCapability, resolveCapability, revokeCapability } = require('../electron/file-capabilities.js');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-b5-'));
    try {
      const existing = path.join(tmpDir, 'salida.json');
      fs.writeFileSync(existing, '{}');

      const wCap = createFileCapability({ filePath: existing, mode: 'write' });
      assert.ok(wCap.token.startsWith('antares-write_'), 'write token usa prefijo antares-write_');
      revokeCapability(wCap.token);

      let newFileRejected = false;
      try {
        createFileCapability({ filePath: path.join(tmpDir, 'no-existe.pdf'), mode: 'write' });
      } catch {
        newFileRejected = true;
      }
      assert(newFileRejected, 'write token sobre archivo inexistente debe rechazarse');

      const rCap = createFileCapability({ filePath: existing, mode: 'read' });
      const resolved = resolveCapability(rCap.token, 'read', null);
      assert.strictEqual(resolved.path, existing, 'resolveCapability devuelve la ruta real');
      assert.strictEqual(resolved.mode, 'read');
      revokeCapability(rCap.token);

      if (process.platform !== 'win32') {
        const link = path.join(tmpDir, 'link.json');
        fs.symlinkSync(existing, link);
        let linkRejected = false;
        try {
          createFileCapability({ filePath: link, mode: 'read' });
        } catch {
          linkRejected = true;
        }
        assert(linkRejected, 'symlink debe rechazarse en createFileCapability');
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  console.log('  ✓ staging preserves .xlsx extension (no .tmp rewrite)');
  console.log('\nAll file-staging tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
