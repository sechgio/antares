import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import {
  buildDemoFillContext,
  collectDemoFieldKeys,
  placeholderImageDataUrl,
  renderDemoPreviewHtml,
  sampleValueForKey,
} from '../runtime/demoFill';
import { createEmptyDocument, newId } from '../types';

describe('demoFill', () => {
  it('sampleValueForKey returns known samples for common keys', () => {
    expect(sampleValueForKey('NIS')).toBe('45871203');
    expect(sampleValueForKey('direccion')).toBe('Av. Los Olivos 1245');
    expect(sampleValueForKey('CUSTOM_X')).toBeTruthy();
  });

  it('placeholderImageDataUrl returns an svg data url', () => {
    const src = placeholderImageDataUrl(0, 'Foto 1');
    expect(src.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(src)).toContain('Foto 1');
  });

  it('buildDemoFillContext fills fields, checkboxes, logos and image slots', () => {
    const doc = createEmptyDocument('Demo');
    doc.layers.push(
      { ...createLayer('field'), id: newId(), meta: { key: 'NIS', fallback: '-' } },
      { ...createLayer('field'), id: newId(), meta: { key: 'DIRECCION', fallback: '-' } },
      { ...createLayer('checkbox'), id: newId(), meta: { key: 'OK', checked: false } },
      { ...createLayer('logo'), id: newId(), meta: { side: 'left' } },
      { ...createLayer('logo'), id: newId(), meta: { side: 'right' } },
      { ...createLayer('imageSlot'), id: newId(), meta: { index: 0 } },
      { ...createLayer('imageSlot'), id: newId(), meta: { index: 1 } },
    );

    expect(collectDemoFieldKeys(doc).sort()).toEqual(['DIRECCION', 'NIS', 'OK'].sort());

    const ctx = buildDemoFillContext(doc);
    expect(ctx.data.NIS).toBe('45871203');
    expect(ctx.data.DIRECCION).toBe('Av. Los Olivos 1245');
    expect(ctx.data.OK).toBe('1');
    expect(ctx.images.length).toBeGreaterThanOrEqual(2);
    expect(ctx.logoLeft).toMatch(/^data:image\/svg\+xml/);
    expect(ctx.logoRight).toMatch(/^data:image\/svg\+xml/);
    expect(ctx.imageMeta?.[0]?.name).toBe('foto-1.jpg');
  });

  it('renderDemoPreviewHtml embeds sample field values', () => {
    const doc = createEmptyDocument('Demo');
    doc.layers.push({
      ...createLayer('field'),
      id: newId(),
      meta: { key: 'NIS', fallback: '-' },
      cssVars: {
        '--width': '40mm',
        '--height': '8mm',
        '--translate-x': '10mm',
        '--translate-y': '10mm',
      },
    });
    const html = renderDemoPreviewHtml(doc);
    expect(html).toContain('45871203');
  });
});
