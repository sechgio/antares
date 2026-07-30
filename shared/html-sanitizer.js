/**
 * Shared HTML sanitizer for PDF rendering (Electron main + renderer).
 * Strips active content and external resource URLs before printToPDF.
 *
 * This is a defense-in-depth layer. The authoritative guard against
 * external resources is the webRequest interceptor in dialog-handlers.js
 * (which now covers both HTTP/HTTPS schemes and the file scheme), plus
 * the CSP meta injected below. The regexes here catch the common payload
 * shapes so the rendered HTML never even attempts a blocked request.
 *
 * Exception: Google Fonts (fonts.googleapis.com / fonts.gstatic.com) are
 * allowlisted so canvas PDF export can load webfonts for WYSIWYG parity.
 */

const GOOGLE_FONT_HOST_RE = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//i;

const CSP_META =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src data: file:; font-src data: https://fonts.gstatic.com;\">";

// data: URIs we consider safe to keep in CSS url() / img src. SVG is
// intentionally excluded — `data:image/svg+xml` can carry `<script>` and
// event handlers, and Chromium will execute them in some contexts.
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
  const lowered = String(urlValue).trim().toLowerCase();
  if (lowered.startsWith('data:') && !isSafeDataUrl(urlValue)) {
    return `${attr}=${quote}${quote}`;
  }
  if (isAllowedGoogleFontUrl(urlValue)) {
    return match;
  }
  if (
    lowered.startsWith('javascript:')
    || lowered.startsWith('vbscript:')
    || lowered.startsWith('http:')
    || lowered.startsWith('https:')
    || lowered.startsWith('file:')
  ) {
    return `${attr}=${quote}${quote}`;
  }
  return match;
}

/** Keep only stylesheet/preconnect links pointing at Google Fonts hosts. */
function stripOrKeepLink(fullTag) {
  const hrefMatch = fullTag.match(/\bhref\s*=\s*(['"])([^'"]+)\1/i)
    || fullTag.match(/\bhref\s*=\s*([^\s>]+)/i);
  if (!hrefMatch) return '';
  const href = hrefMatch[2] || hrefMatch[1];
  return isAllowedGoogleFontUrl(href) ? fullTag : '';
}

function sanitizeHtmlForPdf(html) {
  const stripped = String(html)
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
    .replace(/(href|src|xlink:href)\s*=\s*(['"]?)\s*([^"'>\s]+)\2/gi, neutralizeUrlAttr)
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
  // Inject CSP into the first <head> only. Multiple <head> elements would
  // be malformed HTML and a second one would bypass CSP, so if there's no
  // <head> at all we prepend the meta to guarantee coverage.
  const injectedHtml = stripped.replace(/<head([^>]*)>/i, `<head$1>${CSP_META}`);
  return /<head/i.test(injectedHtml) ? injectedHtml : CSP_META + injectedHtml;
}

module.exports = { sanitizeHtmlForPdf, CSP_META, isSafeDataUrl, isAllowedGoogleFontUrl };
