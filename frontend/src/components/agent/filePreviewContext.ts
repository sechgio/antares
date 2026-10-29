import { createContext } from 'react';

export const FilePreviewContext = createContext<((resource: string) => void) | null>(null);

export function localPreviewResource(href: string): string | null {
  let resource = href.replace(/^<|>$/g, '');
  try {
    if (/^file:/i.test(resource)) {
      const url = new URL(resource);
      if (url.hostname && url.hostname !== 'localhost') return null;
      resource = decodeURIComponent(url.pathname).replace(/^\/(?=[a-z]:[\\/])/i, '');
    } else {
      if (/^[a-z][a-z\d+.-]*:/i.test(resource) && !/^[a-z]:[\\/]/i.test(resource)) return null;
      resource = decodeURIComponent(resource);
    }
  } catch { return null; }
  if (resource.startsWith('//') || resource.startsWith('\\\\') || /[\x00-\x1f]/.test(resource)) return null;
  return /\.(pdf|xlsx?|xlsm|csv|tsv|docx|png|jpe?g|gif|webp|bmp|tiff?|txt|md|json|xml|html?|css|js|jsx|ts|tsx|py|yaml|yml|log|sql|ini|toml)$/i.test(resource) ? resource : null;
}
