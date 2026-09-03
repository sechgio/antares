const assert = require('node:assert/strict');
let PDFDocument;
try {
  ({ PDFDocument } = require('pdf-lib'));
} catch {
  console.log('Skipping canvas PDF manifest helper test: pdf-lib not installed in current environment');
  process.exit(0);
}
const { embedCanvasManifest, MAX_MANIFEST_B64_CHARS } = require('../electron/canvas-pdf-manifest');

async function run() {
  const source = await PDFDocument.create();
  source.addPage([200, 200]);
  const sourceBytes = Buffer.from(await source.save());
  const manifest = Buffer.from(JSON.stringify({ schema: 'antares.canvas.pdf', version: 1 }));
  const output = await embedCanvasManifest(sourceBytes, manifest.toString('base64'));

  assert.ok(output.subarray(0, 5).toString() === '%PDF-', 'embedded result must remain a PDF');
  const loaded = await PDFDocument.load(output);
  const objects = loaded.context.enumerateIndirectObjects();
  assert.ok(
    objects.some(([, value]) => String(value).includes('antares-canvas-manifest.json')),
    'PDF must contain the manifest filename',
  );

  await assert.rejects(
    () => embedCanvasManifest(sourceBytes, 'not base64!'),
    /base64|manifiesto/i,
  );
  await assert.rejects(
    () => embedCanvasManifest(sourceBytes, 'A'.repeat(MAX_MANIFEST_B64_CHARS + 1)),
    /supera el límite/,
  );
  console.log('canvas PDF manifest helper passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
