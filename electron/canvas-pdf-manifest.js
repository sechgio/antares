const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_B64_CHARS = Math.ceil(MAX_MANIFEST_BYTES / 3) * 4;
const MANIFEST_FILENAME = 'antares-canvas-manifest.json';

function decodeManifest(manifestB64) {
  if (typeof manifestB64 !== 'string' || !manifestB64 || /[^A-Za-z0-9+/=]/.test(manifestB64)) {
    throw new Error('El manifiesto PDF debe ser base64 válido');
  }
  if (manifestB64.length > MAX_MANIFEST_B64_CHARS) {
    throw new Error('El manifiesto PDF supera el límite de 2 MiB');
  }
  if (manifestB64.length % 4 === 1 || (manifestB64.includes('=') && !/=+$/.test(manifestB64))) {
    throw new Error('El manifiesto PDF debe ser base64 válido');
  }
  const bytes = Buffer.from(manifestB64, 'base64');
  const normalizedInput = manifestB64.replace(/=+$/, '');
  const normalizedOutput = bytes.toString('base64').replace(/=+$/, '');
  if (!bytes.length || normalizedInput !== normalizedOutput) {
    throw new Error('El manifiesto PDF debe ser base64 válido');
  }
  if (bytes.length > MAX_MANIFEST_BYTES) {
    throw new Error('El manifiesto PDF supera el límite de 2 MiB');
  }
  return bytes;
}

async function embedCanvasManifest(pdfBytes, manifestB64) {
  if (!pdfBytes || (typeof pdfBytes !== 'string' && !Buffer.isBuffer(pdfBytes) && !(pdfBytes instanceof Uint8Array))) {
    throw new Error('PDF requerido para adjuntar el manifiesto');
  }
  const manifest = decodeManifest(manifestB64);
  // Keep pdf-lib out of Electron startup and load it only for this opt-in path.
  const { PDFDocument } = await import('pdf-lib');
  const source = Buffer.from(pdfBytes);
  const pdf = await PDFDocument.load(source, { updateMetadata: false });
  await pdf.attach(manifest, MANIFEST_FILENAME, {
    mimeType: 'application/json',
    description: 'Antares Canvas document manifest',
  });
  return Buffer.from(await pdf.save({ useObjectStreams: true }));
}

module.exports = {
  embedCanvasManifest,
  MAX_MANIFEST_BYTES,
  MAX_MANIFEST_B64_CHARS,
  MANIFEST_FILENAME,
};
