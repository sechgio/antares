
const GOOGLE_FONT_HOST_RE = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//i;

const CSP_META =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src data: file:; font-src data: https://fonts.gstatic.com;\">";

const PREVIEW_CSP_META =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'\">";

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

function neutralizeUrlAttr(match, attr, quote, urlValue) {
  const cleaned = String(urlValue).replace(/\s+/g, '').toLowerCase();
  const schemeMatch = cleaned.match(/^([a-z][a-z0-9+.-]*):/);
  const scheme = schemeMatch ? schemeMatch[1] : '';
  if (cleaned.startsWith('data:')) {
    if (!isSafeDataUrl(urlValue)) return `${attr}=${quote}${quote}`;
    if (cleaned.startsWith('data:text/html')) return `${attr}=${quote}${quote}`;
    return match;
  }
  if (isAllowedGoogleFontUrl(urlValue)) {
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

function stripOrKeepLink(fullTag) {
  const hrefMatch = fullTag.match(/\bhref\s*=\s*(['"])([^'"]+)\1/i)
    || fullTag.match(/\bhref\s*=\s*([^\s>]+)/i);
  if (!hrefMatch) return '';
  const href = hrefMatch[2] || hrefMatch[1];
  return isAllowedGoogleFontUrl(href) ? fullTag : '';
}

function sanitizeHtmlForPdf(html) {
  const stripped = String(html)
    // Strip comments first so fake/pseudo-heads or payloads in comments cannot fool regex
    .replace(/<!--[\s\S]*?-->/g, '')
    // Strip any pre-existing CSP meta tags to prevent spoofing or bypassing CSP
    .replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '')
    // Strip <script>/<iframe>/<object> pairs non-greedily first.
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/<link[^>]*>/gi, (tag) => stripOrKeepLink(tag))
    // Second pass to mop up residuals from nested/script-trick payloads
    // (e.g. `<script><script>x</script>` leaves an orphan `<script>`
    // after pass 1) and bare `<script ...>` with no closing tag.
    .replace(/<script[^>]*>/gi, '')
    .replace(/<\/script>/gi, '')
    .replace(/<iframe[^>]*>/gi, '')
    .replace(/<\/iframe>/gi, '')
    // Strip inline event handlers (onload=, onerror=, onclick=, ...) which
    // can execute script even after <script> tags are removed. Cover all
    // quote styles: double, single, backtick, and unquoted. Also handle
    // boolean form `<svg onload>` (no `=value`) which the browser treats
    // as a present attribute and fires on load.
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*`[^`]*`/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\son[a-z]+\b(?=\s|>|\/)/gi, '')
    // Neutralise unsafe URIs in href/src/xlink:href (javascript, remote, file,
    // and data: except allowlisted safe image prefixes). Google Fonts hrefs
    // are preserved by neutralizeUrlAttr.
    .replace(/(href|src|xlink:href)\s*=\s*(['"]?)\s*([^"'>]+)\2/gi, neutralizeUrlAttr)
    // Neutralise javascript:/vbscript: URIs inside CSS url(...) — the
    // href/src regex above does not reach into CSS. Without this, a
    // payload like `<style>.x{background:url(javascript:alert(1))}</style>`
    // survives intact.
    .replace(/url\(\s*(['"]?)\s*(?:javascript|vbscript):[^'")\s]*\1\s*\)/gi, "url('')")
    // For all other url(...) references, allow only safe data: image URIs;
    // everything else (http, file, blob without an allowlisted token, etc.)
    // is collapsed to an empty url so the renderer never tries to fetch it.
    // External resources are blocked by the webRequest interceptor too,
    // but collapsing here avoids even triggering that path.
    // Note: Google Fonts CSS uses url(https://fonts.gstatic.com/...) which
    // Chromium loads as font fetches (font-src), not as CSS url() kept here —
    // those requests are allowed by CSP font-src + webRequest whitelist.
    .replace(/url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi, (match, _quote, urlValue) => {
      if (isSafeDataUrl(urlValue)) return match;
      if (isAllowedGoogleFontUrl(urlValue)) return match;
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
    .replace(/(href|src|xlink:href)\s*=\s*(['"]?)\s*([^"'>]+)\2/gi, (match, attr, quote, urlValue) => {
      const lowered = String(urlValue).trim().toLowerCase();
      const q = quote || '"';
      if (lowered.startsWith('data:')) {
        return isSafeDataUrl(urlValue) ? match : `${attr}=${q}${q}`;
      }
      if (lowered.startsWith('blob:')) return match;
      return `${attr}=${q}${q}`;
    })
    .replace(/url\(\s*(['"]?)\s*(?:javascript|vbscript):[^'")\s]*\1\s*\)/gi, "url('')")
    .replace(/url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi, (match, _quote, urlValue) => {
      const lowered = String(urlValue).trim().toLowerCase();
      if (lowered.startsWith('blob:')) return match;
      if (lowered.startsWith('data:')) {
        return isSafeDataUrl(urlValue) ? match : "url('')";
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

module.exports = { sanitizeHtmlForPdf, sanitizeHtmlForPreview, CSP_META, PREVIEW_CSP_META, isSafeDataUrl, isAllowedGoogleFontUrl };
