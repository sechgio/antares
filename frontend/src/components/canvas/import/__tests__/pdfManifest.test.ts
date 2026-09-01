import { describe, expect, it } from 'vitest';
import { createEmptyDocument, newId } from '../../types';
import { parseCanvasManifest, serializeCanvasManifest } from '../pdfManifest';

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

describe('Canvas PDF manifest', () => {
  it('round-trips a normalized Canvas document', async () => {
    const document = createEmptyDocument('Round trip');
    const encoded = await serializeCanvasManifest(document);
    expect(parseCanvasManifest(decodeBase64(encoded))).toMatchObject({
      name: 'Round trip',
      version: 2,
    });
  });

  it('does not persist data URLs in the semantic manifest', async () => {
    const document = createEmptyDocument('Assets');
    document.layers.push({
      id: newId(),
      type: 'image',
      name: 'Inline',
      value: 'data:image/png;base64,AAAA',
      cssVars: {
        '--width': '10mm',
        '--height': '10mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
      },
    });
    const decoded = new TextDecoder().decode(decodeBase64(await serializeCanvasManifest(document)));
    expect(decoded).not.toContain('data:image');
  });

  it('rejects an unknown manifest schema', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ schema: 'other', version: 1, document: {} }),
    );
    expect(parseCanvasManifest(bytes)).toBeNull();
  });

  it('rejects a manifest that exceeds the imported layer budget', async () => {
    const document = createEmptyDocument('Too many layers');
    document.layers.push(
      ...Array.from({ length: 1_001 }, (_, index) => ({
        id: `layer-${index}`,
        type: 'text' as const,
        name: `Layer ${index}`,
        value: 'x',
        pageIndex: 0,
        cssVars: {
          '--width': '1mm',
          '--height': '1mm',
          '--translate-x': '0mm',
          '--translate-y': '0mm',
        },
      })),
    );

    const bytes = decodeBase64(await serializeCanvasManifest(document));

    expect(parseCanvasManifest(bytes)).toBeNull();
  });

  it('rejects a structurally incomplete document before exact reconstruction', async () => {
    const document = createEmptyDocument('Incomplete');
    const manifest = JSON.stringify({
      schema: 'antares.canvas.pdf',
      version: 1,
      document: { ...document, fields: undefined },
    });

    expect(parseCanvasManifest(new TextEncoder().encode(manifest))).toBeNull();
  });
});
