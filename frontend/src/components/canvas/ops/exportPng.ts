
const SELECTION_RING = '0 0 0 1px var(--cv-accent)';

export function needsImageCacheBust(root: HTMLElement): boolean {
  const imgs = root.querySelectorAll('img');
  for (let i = 0; i < imgs.length; i++) {
    const src = imgs[i]?.getAttribute('src') || imgs[i]?.src || '';
    if (!src) continue;
    if (!(src.startsWith('blob:') || src.startsWith('data:'))) return true;
  }
  return false;
}

export function stripSelectionChrome(el: HTMLElement): HTMLElement {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.removeAttribute('data-selected');
  clone.style.transform = 'none';
  const shadows = (clone.style.boxShadow || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== SELECTION_RING);
  clone.style.boxShadow = shadows.join(',') || 'none';
  clone.querySelectorAll('[data-handle]').forEach((handle) => handle.remove());
  return clone;
}

async function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
  a.click();
}

export async function exportLayerPng(layerId: string, name: string, scale: number): Promise<void> {
  const el = document.querySelector(`[data-layer-id="${layerId}"]`) as HTMLElement | null;
  if (!el) return;

  const rect = el.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));

  const wrap = document.createElement('div');
  wrap.setAttribute('data-testid', 'canvas-export-wrap');
  wrap.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;overflow:hidden;background:transparent;pointer-events:none;`;

  const clone = stripSelectionChrome(el);
  clone.style.position = 'relative';
  clone.style.left = '0';
  clone.style.top = '0';
  clone.style.width = '100%';
  clone.style.height = '100%';
  clone.style.margin = '0';
  clone.style.outline = 'none';

  wrap.appendChild(clone);
  document.body.appendChild(wrap);

  try {
    const { toPng } = await import('html-to-image');
    const dataUrl = await toPng(wrap, {
      pixelRatio: scale,
      cacheBust: needsImageCacheBust(wrap),
    });
    await downloadDataUrl(dataUrl, name || 'layer');
  } catch (err) {
    console.error('Error exporting layer PNG:', err);
  } finally {
    wrap.remove();
  }
}

export async function exportSelectionPng(
  layerIds: string[],
  name: string,
  scale: number,
): Promise<void> {
  const ids = [...new Set(layerIds)].filter(Boolean);
  if (!ids.length) return;
  if (ids.length === 1) {
    await exportLayerPng(ids[0], name, scale);
    return;
  }

  const artboard = document.querySelector('[data-testid="canvas-artboard"]') as HTMLElement | null;
  if (!artboard) return;

  const nodes = ids
    .map((id) => document.querySelector(`[data-layer-id="${id}"]`) as HTMLElement | null)
    .filter((el): el is HTMLElement => Boolean(el));
  if (!nodes.length) return;

  const boardRect = artboard.getBoundingClientRect();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const rects: Array<{ el: HTMLElement; left: number; top: number; width: number; height: number }> =
    [];
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    const left = r.left - boardRect.left;
    const top = r.top - boardRect.top;
    rects.push({ el, left, top, width: r.width, height: r.height });
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, left + r.width);
    maxY = Math.max(maxY, top + r.height);
  }

  const width = Math.max(1, Math.ceil(maxX - minX));
  const height = Math.max(1, Math.ceil(maxY - minY));
  const wrap = document.createElement('div');
  wrap.setAttribute('data-testid', 'canvas-export-wrap');
  wrap.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;overflow:hidden;background:transparent;pointer-events:none;`;

  for (const item of rects) {
    const clone = stripSelectionChrome(item.el);
    clone.style.position = 'absolute';
    clone.style.left = `${item.left - minX}px`;
    clone.style.top = `${item.top - minY}px`;
    clone.style.width = `${item.width}px`;
    clone.style.height = `${item.height}px`;
    clone.style.margin = '0';
    clone.style.outline = 'none';
    wrap.appendChild(clone);
  }

  document.body.appendChild(wrap);
  try {
    const { toPng } = await import('html-to-image');
    const dataUrl = await toPng(wrap, {
      pixelRatio: scale,
      cacheBust: needsImageCacheBust(wrap),
    });
    await downloadDataUrl(dataUrl, name || 'seleccion');
  } catch (err) {
    console.error('Error exporting selection PNG:', err);
  } finally {
    wrap.remove();
  }
}
