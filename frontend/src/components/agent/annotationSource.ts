import { ensurePdfJs } from '../../lib/pdfjs';

export type AnnotationPage = { png_base64: string; width: number; height: number };
// Lo que se anota: una captura de la web, una imagen, un PDF o un texto, página a página.
export type AnnotationSource = { name: string; count: number; page: (index: number) => Promise<AnnotationPage> };

const MAX_SIDE = 1800;
const TEXT_FILE = /\.(txt|md|markdown|json|jsonl|csv|tsv|log|xml|ya?ml|ini|toml|env\.example|html?|css|s[ac]ss|jsx?|tsx?|mjs|cjs|py|java|kt|cs|cpp|cc|c|h|hpp|go|rs|rb|php|swift|sh|ps1|bat|sql)$/i;
const TEXT_COLUMNS = 110;
const TEXT_LINES = 60;

export const ANNOTATABLE_FILES = 'image/*,application/pdf,text/*,.md,.json,.csv,.log,.xml,.yaml,.yml,.ts,.tsx,.js,.jsx,.py,.sql';

function canvas(width: number, height: number) {
  const element = document.createElement('canvas');
  element.width = Math.max(1, Math.round(width));
  element.height = Math.max(1, Math.round(height));
  const ctx = element.getContext('2d');
  if (!ctx) throw new Error('No se pudo preparar el lienzo');
  return { element, ctx };
}

function toPage(element: HTMLCanvasElement): AnnotationPage {
  return { png_base64: element.toDataURL('image/png').split(',')[1] ?? '', width: element.width, height: element.height };
}

async function imageSource(file: File): Promise<AnnotationSource> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('No se pudo abrir la imagen'));
      element.src = url;
    });
    const natural = { width: image.naturalWidth || 1200, height: image.naturalHeight || 800 };
    const scale = Math.min(1, MAX_SIDE / Math.max(natural.width, natural.height));
    const { element, ctx } = canvas(natural.width * scale, natural.height * scale);
    ctx.drawImage(image, 0, 0, element.width, element.height);
    const page = toPage(element);
    return { name: file.name, count: 1, page: async () => page };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function pdfSource(file: File): Promise<AnnotationSource> {
  const pdfjs = await ensurePdfJs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  return {
    name: file.name,
    count: pdf.numPages,
    page: async (index) => {
      const page = await pdf.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, MAX_SIDE / Math.max(base.width, base.height)) });
      const { element, ctx } = canvas(viewport.width, viewport.height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, element.width, element.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      return toPage(element);
    },
  };
}

export function textPages(text: string) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').flatMap((line, index) => {
    const parts = line.match(new RegExp(`.{1,${TEXT_COLUMNS}}`, 'g')) ?? [''];
    return parts.map((part, wrap) => ({ n: wrap ? '' : String(index + 1), text: part.replace(/\t/g, '  ') }));
  });
  const pages: (typeof lines)[] = [];
  for (let start = 0; start < lines.length; start += TEXT_LINES) pages.push(lines.slice(start, start + TEXT_LINES));
  return pages.length ? pages : [[{ n: '1', text: '' }]];
}

async function textSource(file: File): Promise<AnnotationSource> {
  const pages = textPages(await file.text());
  return {
    name: file.name,
    count: pages.length,
    page: async (index) => {
      const { element, ctx } = canvas(1100, 64 + TEXT_LINES * 18);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, element.width, element.height);
      ctx.font = '13px Consolas, "Cascadia Mono", monospace';
      ctx.textBaseline = 'top';
      pages[index].forEach((line, row) => {
        const y = 32 + row * 18;
        ctx.fillStyle = '#9ca3af';
        ctx.textAlign = 'right';
        ctx.fillText(line.n, 64, y);
        ctx.fillStyle = '#1f2937';
        ctx.textAlign = 'left';
        ctx.fillText(line.text, 80, y);
      });
      return toPage(element);
    },
  };
}

export function fileSource(file: File): Promise<AnnotationSource> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return pdfSource(file);
  if (file.type.startsWith('image/')) return imageSource(file);
  if (file.type.startsWith('text/') || TEXT_FILE.test(file.name)) return textSource(file);
  return Promise.reject(new Error('Este archivo no se puede anotar: usa una imagen, un PDF o un archivo de texto o código'));
}
