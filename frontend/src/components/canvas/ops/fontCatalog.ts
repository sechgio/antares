
export type CanvasFontSource = 'system' | 'google';

export interface CanvasFontEntry {
  id: string;
  label: string;
  family: string;
  stack: string;
  source: CanvasFontSource;
}

const GOOGLE_LINK_ID = 'antares-canvas-google-fonts';

export const CANVAS_FONTS: readonly CanvasFontEntry[] = [
  {
    id: 'segoe-ui',
    label: 'Segoe UI',
    family: 'Segoe UI',
    stack: 'Segoe UI, Arial, sans-serif',
    source: 'system',
  },
  {
    id: 'arial',
    label: 'Arial',
    family: 'Arial',
    stack: 'Arial, sans-serif',
    source: 'system',
  },
  {
    id: 'georgia',
    label: 'Georgia',
    family: 'Georgia',
    stack: 'Georgia, serif',
    source: 'system',
  },
  {
    id: 'consolas',
    label: 'Consolas',
    family: 'Consolas',
    stack: 'Consolas, monospace',
    source: 'system',
  },
  {
    id: 'inter',
    label: 'Inter',
    family: 'Inter',
    stack: "'Inter', sans-serif",
    source: 'google',
  },
  {
    id: 'roboto',
    label: 'Roboto',
    family: 'Roboto',
    stack: "'Roboto', sans-serif",
    source: 'google',
  },
  {
    id: 'open-sans',
    label: 'Open Sans',
    family: 'Open Sans',
    stack: "'Open Sans', sans-serif",
    source: 'google',
  },
  {
    id: 'lato',
    label: 'Lato',
    family: 'Lato',
    stack: "'Lato', sans-serif",
    source: 'google',
  },
  {
    id: 'montserrat',
    label: 'Montserrat',
    family: 'Montserrat',
    stack: "'Montserrat', sans-serif",
    source: 'google',
  },
  {
    id: 'poppins',
    label: 'Poppins',
    family: 'Poppins',
    stack: "'Poppins', sans-serif",
    source: 'google',
  },
  {
    id: 'nunito',
    label: 'Nunito',
    family: 'Nunito',
    stack: "'Nunito', sans-serif",
    source: 'google',
  },
  {
    id: 'raleway',
    label: 'Raleway',
    family: 'Raleway',
    stack: "'Raleway', sans-serif",
    source: 'google',
  },
  {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    family: 'Space Grotesk',
    stack: "'Space Grotesk', sans-serif",
    source: 'google',
  },
  {
    id: 'dm-sans',
    label: 'DM Sans',
    family: 'DM Sans',
    stack: "'DM Sans', sans-serif",
    source: 'google',
  },
  {
    id: 'work-sans',
    label: 'Work Sans',
    family: 'Work Sans',
    stack: "'Work Sans', sans-serif",
    source: 'google',
  },
  {
    id: 'oswald',
    label: 'Oswald',
    family: 'Oswald',
    stack: "'Oswald', sans-serif",
    source: 'google',
  },
  {
    id: 'playfair-display',
    label: 'Playfair Display',
    family: 'Playfair Display',
    stack: "'Playfair Display', serif",
    source: 'google',
  },
  {
    id: 'merriweather',
    label: 'Merriweather',
    family: 'Merriweather',
    stack: "'Merriweather', serif",
    source: 'google',
  },
  {
    id: 'lora',
    label: 'Lora',
    family: 'Lora',
    stack: "'Lora', serif",
    source: 'google',
  },
  {
    id: 'source-serif-4',
    label: 'Source Serif 4',
    family: 'Source Serif 4',
    stack: "'Source Serif 4', serif",
    source: 'google',
  },
  {
    id: 'libre-baskerville',
    label: 'Libre Baskerville',
    family: 'Libre Baskerville',
    stack: "'Libre Baskerville', serif",
    source: 'google',
  },
  {
    id: 'bebas-neue',
    label: 'Bebas Neue',
    family: 'Bebas Neue',
    stack: "'Bebas Neue', sans-serif",
    source: 'google',
  },
  {
    id: 'pacifico',
    label: 'Pacifico',
    family: 'Pacifico',
    stack: "'Pacifico', cursive",
    source: 'google',
  },
  {
    id: 'caveat',
    label: 'Caveat',
    family: 'Caveat',
    stack: "'Caveat', cursive",
    source: 'google',
  },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    family: 'JetBrains Mono',
    stack: "'JetBrains Mono', monospace",
    source: 'google',
  },
  {
    id: 'fira-code',
    label: 'Fira Code',
    family: 'Fira Code',
    stack: "'Fira Code', monospace",
    source: 'google',
  },
  {
    id: 'source-code-pro',
    label: 'Source Code Pro',
    family: 'Source Code Pro',
    stack: "'Source Code Pro', monospace",
    source: 'google',
  },
] as const;

const byStack = new Map(CANVAS_FONTS.map((f) => [f.stack, f]));
const byFamilyLower = new Map(CANVAS_FONTS.map((f) => [f.family.toLowerCase(), f]));

export function getFontByStack(stack: string | undefined | null): CanvasFontEntry | undefined {
  if (!stack) return undefined;
  const exact = byStack.get(stack);
  if (exact) return exact;
  const primary = stack.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
  return byFamilyLower.get(primary.toLowerCase());
}

export function buildGoogleFontsStylesheetUrl(families: string[]): string {
  const unique = [...new Set(families.filter(Boolean))];
  if (unique.length === 0) return '';
  const params = unique
    .map((name) => `family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@400;500;600;700`)
    .join('&');
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

export function allGoogleFontFamilies(): string[] {
  return CANVAS_FONTS.filter((f) => f.source === 'google').map((f) => f.family);
}

export function ensureCanvasFontsLoaded(doc: Document = document): void {
  if (typeof doc === 'undefined') return;
  if (doc.getElementById(GOOGLE_LINK_ID)) return;
  const url = buildGoogleFontsStylesheetUrl(allGoogleFontFamilies());
  if (!url) return;

  const preconnectApi = doc.createElement('link');
  preconnectApi.rel = 'preconnect';
  preconnectApi.href = 'https://fonts.googleapis.com';
  doc.head.appendChild(preconnectApi);

  const preconnectStatic = doc.createElement('link');
  preconnectStatic.rel = 'preconnect';
  preconnectStatic.href = 'https://fonts.gstatic.com';
  preconnectStatic.crossOrigin = '';
  doc.head.appendChild(preconnectStatic);

  const link = doc.createElement('link');
  link.id = GOOGLE_LINK_ID;
  link.rel = 'stylesheet';
  link.href = url;
  doc.head.appendChild(link);
}

export function collectGoogleFontFamilies(
  layers: Array<{ cssVars?: { '--font-family'?: string } }>,
): string[] {
  const names = new Set<string>();
  for (const layer of layers) {
    const entry = getFontByStack(layer.cssVars?.['--font-family']);
    if (entry?.source === 'google') names.add(entry.family);
  }
  return [...names].sort();
}

export function googleFontsHeadHtml(families: string[]): string {
  const url = buildGoogleFontsStylesheetUrl(families);
  if (!url) return '';
  return [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="${url}">`,
  ].join('\n');
}
