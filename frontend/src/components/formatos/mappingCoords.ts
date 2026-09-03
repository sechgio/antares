export interface PdfPageSize {
  width: number;
  height: number;
}

export interface MappingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_WIDTH = 20;
const MIN_HEIGHT = 12;

export function clampMappingRect(rect: MappingRect, page: PdfPageSize): MappingRect {
  const width = Math.max(MIN_WIDTH, Math.min(rect.width, page.width));
  const height = Math.max(MIN_HEIGHT, Math.min(rect.height, page.height));
  const x = Math.max(0, Math.min(rect.x, page.width - width));
  const y = Math.max(0, Math.min(rect.y, page.height - height));
  return { x, y, width, height };
}

export function screenToMappingPoint(
  clientX: number,
  clientY: number,
  imgEl: Pick<HTMLElement, 'getBoundingClientRect'>,
  pageSize: PdfPageSize,
): { x: number; y: number } {
  const bounds = imgEl.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0 };
  return {
    x: ((clientX - bounds.left) / bounds.width) * pageSize.width,
    y: ((clientY - bounds.top) / bounds.height) * pageSize.height,
  };
}

export function mappingRectToOverlayStyle(rect: MappingRect, pageSize: PdfPageSize): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  return {
    left: `${(rect.x / pageSize.width) * 100}%`,
    top: `${(rect.y / pageSize.height) * 100}%`,
    width: `${(rect.width / pageSize.width) * 100}%`,
    height: `${(rect.height / pageSize.height) * 100}%`,
  };
}

export function computePageDisplayScale(displayHeight: number, pageHeight: number): number {
  if (displayHeight <= 0 || pageHeight <= 0) return 1;
  return displayHeight / pageHeight;
}

export function mappingFontNameToCss(fontName: string): string {
  if (fontName.startsWith('Courier')) return '"Courier New", Courier, monospace';
  return '"Helvetica Neue", Helvetica, Arial, sans-serif';
}

export function mappingFontWeight(fontName: string): number {
  return fontName.includes('Bold') ? 700 : 400;
}

export function mappingColorCss(colorR: number, colorG: number, colorB: number): string {
  return `rgb(${Math.round(colorR * 255)}, ${Math.round(colorG * 255)}, ${Math.round(colorB * 255)})`;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function channelToHex(value: number): string {
  return Math.round(clamp01(value) * 255).toString(16).padStart(2, '0');
}

export function mappingColorToHex(colorR: number, colorG: number, colorB: number): string {
  return `#${channelToHex(colorR)}${channelToHex(colorG)}${channelToHex(colorB)}`;
}

export function hexToMappingColor(hex: string): { color_r: number; color_g: number; color_b: number } {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return { color_r: 0, color_g: 0, color_b: 0 };
  const int = parseInt(match[1], 16);
  const round4 = (channel: number) => Math.round((channel / 255) * 10000) / 10000;
  return {
    color_r: round4((int >> 16) & 0xff),
    color_g: round4((int >> 8) & 0xff),
    color_b: round4(int & 0xff),
  };
}

export function mappingTextTopPercent(y: number, fontSize: number, pageHeight: number): string {
  const baselineFromTop = y + fontSize;
  const ascenderRatio = 0.718;
  const topFromPage = Math.max(0, baselineFromTop - fontSize * ascenderRatio);
  return `${(topFromPage / pageHeight) * 100}%`;
}
