import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderPreviewHtml } from './PreviewPanel';

describe('report.html adaptive photo grid layout', () => {
  const templatePath = path.resolve(__dirname, '../../../../backend/templates/report.html');
  const templateContent = fs.readFileSync(templatePath, 'utf8');
  const customTemplate = { name: 'report.html', content: templateContent };

  const createMockFile = (name: string): File => {
    return new File(['mock content'], name, { type: 'image/jpeg', lastModified: Date.now() });
  };

  it('renders layout-2 vertically centered with exactly 2 photo-items and no placeholders when 2 images are loaded', () => {
    const images = [createMockFile('foto1.jpg'), createMockFile('foto2.jpg')];
    const imageUrls = ['data:image/jpeg;base64,img1', 'data:image/jpeg;base64,img2'];

    const html = renderPreviewHtml({
      data: { CENTRO: 'SURCO', NIS: '12345', OT: '67890' },
      images,
      imageUrls,
      customTemplate,
    });

    expect(html).toContain('class="photo-grid layout-2"');

    expect(html).toContain('.layout-2');
    expect(html).toContain('align-items: center');
    expect(html).toContain('height: calc(50% - 1mm)');

    const photoItemMatches = html.match(/<div class="photo-item">/g) || [];
    expect(photoItemMatches.length).toBe(2);

    expect(html).not.toContain('<div class="photo-placeholder">');

    expect(html).toContain('src="data:image/jpeg;base64,img1"');
    expect(html).toContain('alt="foto1.jpg"');
    expect(html).toContain('src="data:image/jpeg;base64,img2"');
    expect(html).toContain('alt="foto2.jpg"');
  });

  it('preserves layout-3 with 3 images', () => {
    const images = [createMockFile('foto1.jpg'), createMockFile('foto2.jpg'), createMockFile('foto3.jpg')];
    const imageUrls = ['url1', 'url2', 'url3'];

    const html = renderPreviewHtml({
      data: {},
      images,
      imageUrls,
      customTemplate,
    });

    expect(html).toContain('class="photo-grid layout-3"');
    const photoItemMatches = html.match(/<div class="photo-item">/g) || [];
    expect(photoItemMatches.length).toBe(3);
    expect(html).not.toContain('<div class="photo-placeholder">');
  });

  it('preserves layout-4 with 4 images', () => {
    const images = [
      createMockFile('f1.jpg'),
      createMockFile('f2.jpg'),
      createMockFile('f3.jpg'),
      createMockFile('f4.jpg'),
    ];
    const imageUrls = ['url1', 'url2', 'url3', 'url4'];

    const html = renderPreviewHtml({
      data: {},
      images,
      imageUrls,
      customTemplate,
    });

    expect(html).toContain('class="photo-grid layout-4"');
    const photoItemMatches = html.match(/<div class="photo-item">/g) || [];
    expect(photoItemMatches.length).toBe(4);
    expect(html).not.toContain('<div class="photo-placeholder">');
  });
});
