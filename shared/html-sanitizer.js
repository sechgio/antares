const GOOGLE_FONT_HOST_RE = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//i;

const CSP_META =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src data:; font-src data: https://fonts.gstatic.com;\">";

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

// Delimita solo espacios de la especificación: JS \s deja fuera los controles C0
// (y DEL), que los parsers de URL eliminan antes de extraer el esquema
// («\u0001javascript:» es javascript: para el navegador).
const _URL_NOISE_RE = /[\s\x00-\x1f\x7f]+/g;

// (Evasión por nombre de atributo) Los parsers decodifican character references
// también en el NOMBRE del atributo: «sr&#99;="file://…"» es src= para el
// navegador e invisible para las regex que buscan el atributo literal. Un
// atributo legítimo nunca trae «&#» en su nombre; si al decodificarlo se
// convierte en manejador on* o en atributo de URL, se elimina el atributo
// entero. Puede alterar texto mostrado hospedado en raw-text (textarea…),
// que ya no es markup confiable: gana la seguridad del atributo plantado.
const DANGEROUS_DECODED_ATTR_NAMES = /^(?:on[a-z]+|href|src|xlink:href|srcset|poster|action|formaction|background|cite|ping|longdesc)$/i;
const _ATTR_NAME_TOKEN_RE = /([\s/])([^\s"'>=]+)(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/g;
const _TAG_OPEN_RE = /<[a-zA-Z](?:"[^"]*"|'[^']*'|[^"'>])*>/g;

function stripEntityEncodedAttributes(html) {
  return html.replace(_TAG_OPEN_RE, (tag) => {
    if (!tag.includes('&')) return tag;
    return tag.replace(_ATTR_NAME_TOKEN_RE, (attribute, lead, name, value) => {
      const decoded = _decodeUrlEntities(name);
      return decoded !== name && DANGEROUS_DECODED_ATTR_NAMES.test(decoded) ? lead : attribute;
    });
  });
}

function neutralizeUrlAttr(match, attr, quote, urlValue) {
  const decoded = _decodeUrlEntities(urlValue);
  const cleaned = decoded.replace(_URL_NOISE_RE, '').toLowerCase();
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
  if (cleaned.startsWith('//')) {
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
    const url = candidate.replace(_URL_NOISE_RE, '');
    const cleaned = url.toLowerCase();
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
    if (cleaned.startsWith('//')) {
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

function injectContentSecurityPolicy(stripped, cspMeta) {
  // La primera política manda (intersección): se antepone SIEMPRE una copia en el
  // índice 0 para que un raw-text hospedado antes del head real (textarea,
  // noscript, xmp…) no pueda desplazar la CSP efectiva con un head falso.
  if (/(^|[\s>])<head\b([^>]*)>/i.test(stripped)) {
    return cspMeta + stripped.replace(/(^|[\s>])<head\b([^>]*)>/i, `$1<head$2>${cspMeta}`);
  }
  return `${cspMeta}${stripped}`;
}

function sanitizeGoogleFontHtml(html, cspMeta, allowBlobUrl) {
  const stripped = stripEntityEncodedAttributes(String(html))
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
    .replace(/<(animate|set)\b[^>]*attributeName\s*=\s*['"]?\s*(?:xlink:)?href\s*['"]?[^>]*>/gi, '')
    .replace(/<script[^>]*>/gi, '')
    .replace(/<\/script>/gi, '')
    .replace(/<iframe[^>]*>/gi, '')
    .replace(/<\/iframe>/gi, '')
    .replace(/[\s/]on[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/[\s/]on[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/[\s/]on[a-z]+\s*=\s*`[^`]*`/gi, '')
    .replace(/[\s/]on[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/[\s/]on[a-z]+\b(?=\s|>|\/)/gi, '')
    .replace(URL_ATTR_RE, dispatchUrlAttr)
    .replace(/@import\s+(['"])([^'"]*)\1\s*;?/gi, neutralizeImportStatement)
    .replace(/expression\s*\(/gi, '')
    .replace(/url\(\s*(['"]?)\s*(?:javascript|vbscript):[^'")\s]*\1\s*\)/gi, "url('')")
    .replace(/url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi, (match, _quote, urlValue) => {
      const decoded = _decodeUrlEntities(urlValue);
      if (allowBlobUrl && decoded.trim().toLowerCase().startsWith('blob:')) return match;
      if (isSafeDataUrl(decoded)) return match;
      if (isAllowedGoogleFontUrl(decoded)) return match;
      return "url('')";
    });
  return injectContentSecurityPolicy(stripped, cspMeta);
}

function sanitizeHtmlForPdf(html) {
  return sanitizeGoogleFontHtml(html, CSP_META, false);
}

function sanitizeHtmlForPreview(html) {
  let stripped = stripEntityEncodedAttributes(String(html))
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
    .replace(/<(animate|set)\b[^>]*attributeName\s*=\s*['"]?\s*(?:xlink:)?href\s*['"]?[^>]*>/gi, '')
    .replace(/[\s/]on[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/[\s/]on[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/[\s/]on[a-z]+\s*=\s*`[^`]*`/gi, '')
    .replace(/[\s/]on[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/[\s/]on[a-z]+\b(?=\s|>|\/)/gi, '')
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

  return injectContentSecurityPolicy(stripped, PREVIEW_CSP_META);
}

function sanitizeHtmlForCanvasPreview(html) {
  return sanitizeGoogleFontHtml(html, CANVAS_PREVIEW_CSP_META, true);
}

module.exports = { sanitizeHtmlForPdf, sanitizeHtmlForPreview, sanitizeHtmlForCanvasPreview, CSP_META, PREVIEW_CSP_META, CANVAS_PREVIEW_CSP_META, isSafeDataUrl, isAllowedGoogleFontUrl };
