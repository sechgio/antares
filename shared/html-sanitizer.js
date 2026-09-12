const GOOGLE_FONT_HOST_RE = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//i;

const CSP_META =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src data: file:; font-src data: https://fonts.gstatic.com;\">";

const PREVIEW_CSP_META =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'\">";

const CANVAS_PREVIEW_CSP_META =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src data: blob:; font-src data: https://fonts.gstatic.com; connect-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'\">";

const SAFE_DATA_URI_PREFIXES = [
  'data:image/png',
  'data:image/jpeg',
  'data:image/jpg',
  'data:image/gif',
  'data:image/bmp',
  'data:image/webp',
  'data:image/x-icon',
];

function isSafeDataUrl(url) {
  const lowered = String(url).trim().toLowerCase();
  return SAFE_DATA_URI_PREFIXES.some((prefix) => lowered.startsWith(prefix));
}

function isAllowedGoogleFontUrl(url) {
  return GOOGLE_FONT_HOST_RE.test(String(url).trim());
}

// Numeric refs decode in browsers without the trailing semicolon; named refs
// keep it required (the no-semicolon legacy named set is not decoded inside
// attributes when followed by alnum/'=', so requiring ';' matches that).
const _URL_ENTITY_RE = /&(?:#(x[0-9a-fA-F]+|\d+);?|([a-zA-Z][a-zA-Z0-9]*);)/g;
const _NAMED_URL_ENTITIES = {
  colon: ':', tab: '\t', newline: '\n', sol: '/', bsol: '\\',
  period: '.', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

function _decodeUrlEntities(value) {
  return String(value).replace(_URL_ENTITY_RE, (m, num, name) => {
    if (num !== undefined) {
      const code = num[0].toLowerCase() === 'x' ? parseInt(num.slice(1), 16) : parseInt(num, 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    const mapped = _NAMED_URL_ENTITIES[name.toLowerCase()];
    return mapped !== undefined ? mapped : m;
  });
}

const URL_ATTR_RE = /(href|src|xlink:href|srcset|poster|action|formaction|background|cite|ping|longdesc)\s*=\s*(['"]?)\s*([^"'>]+)\2/gi;

function neutralizeUrlAttr(match, attr, quote, urlValue) {
  const decoded = _decodeUrlEntities(urlValue);
  const cleaned = decoded.replace(/\s+/g, '').toLowerCase();
  const schemeMatch = cleaned.match(/^([a-z][a-z0-9+.-]*):/);
  const scheme = schemeMatch ? schemeMatch[1] : '';
  if (cleaned.startsWith('data:')) {
    if (!isSafeDataUrl(decoded)) return `${attr}=${quote}${quote}`;
    if (cleaned.startsWith('data:text/html')) return `${attr}=${quote}${quote}`;
    return match;
  }
  if (isAllowedGoogleFontUrl(decoded)) {
    return match;
  }
  if (scheme === 'javascript' || scheme === 'vbscript') {
    return `${attr}=${quote}${quote}`;
  }
  if (scheme === 'http' || scheme === 'https' || scheme === 'file') {
    return `${attr}=${quote}${quote}`;
  }
  return match;
}

function neutralizeSrcsetAttr(match, attr, quote, urlValue) {
  const decoded = _decodeUrlEntities(urlValue);
  for (const candidate of decoded.split(',')) {
    const url = candidate.trim().split(/\s+/)[0] || '';
    const cleaned = url.replace(/\s+/g, '').toLowerCase();
    if (cleaned.startsWith('data:')) {
      if (!isSafeDataUrl(url) || cleaned.startsWith('data:text/html')) {
        return `${attr}=${quote}${quote}`;
      }
      continue;
    }
    const schemeMatch = cleaned.match(/^([a-z][a-z0-9+.-]*):/);
    const scheme = schemeMatch ? schemeMatch[1] : '';
    if (scheme === 'javascript' || scheme === 'vbscript' || scheme === 'http' || scheme === 'https' || scheme === 'file') {
      return `${attr}=${quote}${quote}`;
    }
  }
  return match;
}

function dispatchUrlAttr(match, attr, quote, urlValue) {
  if (String(attr).toLowerCase() === 'srcset') {
    return neutralizeSrcsetAttr(match, attr, quote, urlValue);
  }
  return neutralizeUrlAttr(match, attr, quote, urlValue);
}

function neutralizeImportStatement(match, quote, urlValue) {
  const decoded = _decodeUrlEntities(urlValue);
  if (isSafeDataUrl(decoded)) return match;
  if (isAllowedGoogleFontUrl(decoded)) return match;
  return '';
}

function stripOrKeepLink(fullTag) {
  const hrefMatch = fullTag.match(/\bhref\s*=\s*(['"])([^'"]+)\1/i)
    || fullTag.match(/\bhref\s*=\s*([^\s>]+)/i);
  if (!hrefMatch) return '';
  const href = hrefMatch[2] || hrefMatch[1];
  return isAllowedGoogleFontUrl(href) ? fullTag : '';
}

function sanitizeHtmlForPdf(html) {
  const stripped = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '')
    .replace(/<meta[^>]*http-equiv[^>]*>/gi, '')
    .replace(/<base[^>]*>/gi, '')
    .replace(/<\/base>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/<link[^>]*>/gi, (tag) => stripOrKeepLink(tag))
    .replace(/<script[^>]*>/gi, '')
    .replace(/<\/script>/gi, '')
    .replace(/<iframe[^>]*>/gi, '')
    .replace(/<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*`[^`]*`/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\son[a-z]+\b(?=\s|>|\/)/gi, '')
    .replace(URL_ATTR_RE, dispatchUrlAttr)
    .replace(/@import\s+(['"])([^'"]*)\1\s*;?/gi, neutralizeImportStatement)
    .replace(/expression\s*\(/gi, '')
    .replace(/url\(\s*(['"]?)\s*(?:javascript|vbscript):[^'")\s]*\1\s*\)/gi, "url('')")
    .replace(/url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi, (match, _quote, urlValue) => {
      const decoded = _decodeUrlEntities(urlValue);
      if (isSafeDataUrl(decoded)) return match;
      if (isAllowedGoogleFontUrl(decoded)) return match;
      return "url('')";
    });
  if (/(^|[\s>])<head\b([^>]*)>/i.test(stripped)) {
    return stripped.replace(/(^|[\s>])<head\b([^>]*)>/i, `$1<head$2>${CSP_META}`);
  }
  return `${CSP_META}${stripped}`;
}

function sanitizeHtmlForPreview(html) {
  const raw = String(html);
  let stripped = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script[^>]*>/gi, '')
    .replace(/<\/script>/gi, '')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<iframe[^>]*>/gi, '')
    .replace(/<\/iframe>/gi, '')
    .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<object[^>]*>/gi, '')
    .replace(/<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/<\/embed>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<base[^>]*>/gi, '')
    .replace(/<\/base>/gi, '')
    .replace(/<meta[^>]*http-equiv[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*`[^`]*`/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\son[a-z]+\b(?=\s|>|\/)/gi, '')
    .replace(URL_ATTR_RE, (match, attr, quote, urlValue) => {
      if (String(attr).toLowerCase() === 'srcset') {
        return neutralizeSrcsetAttr(match, attr, quote, urlValue);
      }
      const decoded = _decodeUrlEntities(urlValue);
      const lowered = decoded.trim().toLowerCase();
      const q = quote || '"';
      if (lowered.startsWith('data:')) {
        return isSafeDataUrl(decoded) ? match : `${attr}=${q}${q}`;
      }
      if (lowered.startsWith('blob:')) return match;
      return `${attr}=${q}${q}`;
    })
    .replace(/url\(\s*(['"]?)\s*(?:javascript|vbscript):[^'")\s]*\1\s*\)/gi, "url('')")
    .replace(/url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi, (match, _quote, urlValue) => {
      const decoded = _decodeUrlEntities(urlValue);
      const lowered = decoded.trim().toLowerCase();
      if (lowered.startsWith('blob:')) return match;
      if (lowered.startsWith('data:')) {
        return isSafeDataUrl(decoded) ? match : "url('')";
      }
      return "url('')";
    })
    .replace(/@import\s+[^;]+;/gi, '')
    .replace(/expression\s*\(/gi, '');

  stripped = stripped.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, (block) => {
    let inner = block.replace(/^<style[^>]*>/i, '').replace(/<\/style>$/i, '');
    inner = inner.replace(/url\([^)]+\)/gi, (m) => {
      const urlMatch = m.match(/url\(\s*(['"]?)([^'")]+)\1\s*\)/i);
      if (!urlMatch) return "url('')";
      const v = String(urlMatch[2]).trim().toLowerCase();
      if (v.startsWith('blob:')) return m;
      if (v.startsWith('data:') && isSafeDataUrl(urlMatch[2])) return m;
      return "url('')";
    });
    inner = inner.replace(/@import[^;]+;/gi, '');
    return `<style>${inner}</style>`;
  });

  if (/(^|[\s>])<head\b([^>]*)>/i.test(stripped)) {
    return stripped.replace(/(^|[\s>])<head\b([^>]*)>/i, `$1<head$2>${PREVIEW_CSP_META}`);
  }
  return `${PREVIEW_CSP_META}${stripped}`;
}

function sanitizeHtmlForCanvasPreview(html) {
  const stripped = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '')
    .replace(/<meta[^>]*http-equiv[^>]*>/gi, '')
    .replace(/<base[^>]*>/gi, '')
    .replace(/<\/base>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/<link[^>]*>/gi, (tag) => stripOrKeepLink(tag))
    .replace(/<script[^>]*>/gi, '')
    .replace(/<\/script>/gi, '')
    .replace(/<iframe[^>]*>/gi, '')
    .replace(/<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*`[^`]*`/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\son[a-z]+\b(?=\s|>|\/)/gi, '')
    .replace(URL_ATTR_RE, dispatchUrlAttr)
    .replace(/@import\s+(['"])([^'"]*)\1\s*;?/gi, neutralizeImportStatement)
    .replace(/expression\s*\(/gi, '')
    .replace(/url\(\s*(['"]?)\s*(?:javascript|vbscript):[^'")\s]*\1\s*\)/gi, "url('')")
    .replace(/url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi, (match, _quote, urlValue) => {
      const decoded = _decodeUrlEntities(urlValue);
      const lowered = decoded.trim().toLowerCase();
      if (lowered.startsWith('blob:')) return match;
      if (isSafeDataUrl(decoded)) return match;
      if (isAllowedGoogleFontUrl(decoded)) return match;
      return "url('')";
    });

  if (/(^|[\s>])<head\b([^>]*)>/i.test(stripped)) {
    return stripped.replace(/(^|[\s>])<head\b([^>]*)>/i, `$1<head$2>${CANVAS_PREVIEW_CSP_META}`);
  }
  return `${CANVAS_PREVIEW_CSP_META}${stripped}`;
}

module.exports = { sanitizeHtmlForPdf, sanitizeHtmlForPreview, sanitizeHtmlForCanvasPreview, CSP_META, PREVIEW_CSP_META, CANVAS_PREVIEW_CSP_META, isSafeDataUrl, isAllowedGoogleFontUrl };
