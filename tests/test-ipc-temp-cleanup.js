const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const {
  MAX_AGE_MS,
  cleanupSpreadsheetSpillFile,
  sweepIpcTempDirs,
  ipcTempDirs,
} = require('../electron/ipc-temp-cleanup.js');

async function main() {
  console.log('Testing IPC temp cleanup...\n');

  const spillDir = path.join(os.tmpdir(), 'antares-spreadsheet-results');
  const pdfDir = path.join(os.tmpdir(), 'antares-pdf-out');
  await fsp.mkdir(spillDir, { recursive: true });
  await fsp.mkdir(pdfDir, { recursive: true });

  const spillFile = path.join(spillDir, `test-${process.pid}.json`);
  await fsp.writeFile(spillFile, '{"ok":true}', 'utf8');
  await cleanupSpreadsheetSpillFile(spillFile);
  assert.strictEqual(fs.existsSync(spillFile), false, 'spill file deleted after cleanup');

  // Outside spill dir must not be deleted
  const other = path.join(os.tmpdir(), `antares-not-spill-${process.pid}.json`);
  await fsp.writeFile(other, 'x', 'utf8');
  await cleanupSpreadsheetSpillFile(other);
  assert.ok(fs.existsSync(other), 'non-spill path must remain');
  await fsp.rm(other, { force: true });

  const stalePdf = path.join(pdfDir, `stale-${process.pid}.pdf`);
  const freshPdf = path.join(pdfDir, `fresh-${process.pid}.pdf`);
  await fsp.writeFile(stalePdf, '%PDF', 'utf8');
  await fsp.writeFile(freshPdf, '%PDF', 'utf8');
  const staleTime = Date.now() - MAX_AGE_MS - 60_000;
  fs.utimesSync(stalePdf, new Date(staleTime / 1000), new Date(staleTime / 1000));

  const removed = await sweepIpcTempDirs(Date.now());
  assert.ok(removed >= 1, 'sweep should remove at least the stale PDF');
  assert.strictEqual(fs.existsSync(stalePdf), false, 'stale PDF removed');
  assert.ok(fs.existsSync(freshPdf), 'fresh PDF kept');
  await fsp.rm(freshPdf, { force: true });

  assert.ok(ipcTempDirs().length >= 2);
  console.log('  ✓ spill cleanup + age sweep');

  // file_token_cleanup via dialog-handlers: delete spill + revoke capability
  const { handleDialogCall } = require('../electron/dialog-handlers.js');
  const { createFileCapability, resolveCapability } = require('../electron/file-capabilities.js');
  const cleanupSpill = path.join(spillDir, `cleanup-token-${process.pid}.json`);
  await fsp.writeFile(cleanupSpill, '{"sheets":[]}', 'utf8');
  const cap = createFileCapability({ filePath: cleanupSpill, mode: 'read', webContentsId: 1 });
  const cleaned = await handleDialogCall('file_token_cleanup', { token: cap.token }, {}, { webContents: { id: 1 } });
  assert.strictEqual(cleaned.handled, true);
  assert.strictEqual(cleaned.result.cleaned, true);
  assert.strictEqual(fs.existsSync(cleanupSpill), false, 'file_token_cleanup deletes spill');
  let revoked = false;
  try {
    resolveCapability(cap.token, 'read', 1);
  } catch {
    revoked = true;
  }
  assert.ok(revoked, 'file_token_cleanup revokes capability');
  console.log('  ✓ file_token_cleanup deletes spill and revokes token');

  console.log('\nAll ipc-temp-cleanup tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
