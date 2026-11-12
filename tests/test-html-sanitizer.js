const { sanitizeHtmlForPdf, sanitizeHtmlForPreview } = require('../shared/html-sanitizer');

const { assert, finish } = require('./helpers/harness');

function run() {
  console.log('Testing shared html sanitizer...\n');

  const html = `
    <html>
      <head><style>
        .safe { background-image: url(data:image/png;base64,AAAA); }
        .local { background-image: url("file:///etc/passwd"); }
        .remote { background-image: url(https://example.com/a.png); }
      </style></head>
      <body>
        <script>alert(1)</script>
        <iframe src="file:///etc/passwd"></iframe>
      </body>
    </html>
  `;

  const shared = sanitizeHtmlForPdf(html);

  assert(shared.includes('Content-Security-Policy'), 'sanitizer injects CSP meta tag');
  assert(!shared.toLowerCase().includes('<script'), 'sanitizer removes script tags');
  assert(!shared.toLowerCase().includes('<iframe'), 'sanitizer removes iframe tags');
  assert(!shared.includes('file:///etc/passwd'), 'sanitizer blocks local file URLs');
  assert(!shared.includes('https://example.com/a.png'), 'sanitizer blocks remote URLs');
  assert(shared.includes('url(data:image/png;base64,AAAA)'), 'sanitizer keeps data URLs');

  const cssJsPayload = "<head></head><style>.x{background:url(javascript:alert(1))}</style>";
  const cssJsOut = sanitizeHtmlForPdf(cssJsPayload);
  assert(!cssJsOut.toLowerCase().includes('javascript:alert'), 'S-CRÍTICO-1: neutralises url(javascript:) in CSS');
  assert(cssJsOut.includes("url('')"), 'S-CRÍTICO-1: replaces url(javascript:) with empty url()');

  const pngDataPayload = "<head></head><style>.x{background:url(data:image/png;base64,iVBOR=)}</style>";
  const pngDataOut = sanitizeHtmlForPdf(pngDataPayload);
  assert(pngDataOut.includes('data:image/png;base64,iVBOR='), 'S-MEDIO-1: keeps data:image/png URIs in CSS');

  const gfLink =
    '<head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter&display=swap"></head>';
  const gfOut = sanitizeHtmlForPdf(gfLink);
  assert(
    gfOut.includes('https://fonts.googleapis.com/css2?family=Inter'),
    'keeps Google Fonts stylesheet <link>',
  );
  assert(gfOut.includes('fonts.gstatic.com'), 'CSP allows fonts.gstatic.com');
  assert(gfOut.includes('fonts.googleapis.com'), 'CSP allows fonts.googleapis.com for style-src');

  const attrHeadPayload = '<div data-meta="<head>">Content</div>';
  const attrHeadOut = sanitizeHtmlForPdf(attrHeadPayload);
  assert(
    attrHeadOut.startsWith('<meta http-equiv="Content-Security-Policy"'),
    'C2: prepends CSP when <head> is only present inside an attribute',
  );

  const spoofedCsp = '<head><meta http-equiv="Content-Security-Policy" content="default-src *;"></head><div>Hi</div>';
  const spoofedOut = sanitizeHtmlForPdf(spoofedCsp);
  assert(!spoofedOut.includes('default-src *'), 'C2: strips pre-existing spoofed CSP meta tags');
  assert(spoofedOut.includes("default-src 'none'"), 'C2: enforces official strict CSP');

  const slashPayload = '<img src="x"/onerror=alert(1)><a href="y"/onclick=steal()>z</a><p /onmouseover=alert(2)>q</p>';
  const slashPdfOut = sanitizeHtmlForPdf(slashPayload);
  assert(!/onerror|onclick|onmouseover/i.test(slashPdfOut), 'S-R2-4: el PDF elimina manejadores separados por «/»');
  assert(slashPdfOut.includes('<img') && slashPdfOut.includes('<a'), 'S-R2-4: se conservan las etiquetas legítimas');
  const slashPreviewOut = sanitizeHtmlForPreview(slashPayload);
  assert(!/onerror|onclick|onmouseover/i.test(slashPreviewOut), 'S-R2-4: la vista previa elimina los mismos manejadores');
  assert(!/onerror/i.test(sanitizeHtmlForPreview('<img src=x onerror=alert(1)>')), 'S-R2-4: el caso con espacio sigue cubierto');

  const entityName = '<img sr&#99;="file:///C:/secreto.png" alt="ok">';
  const entityPdfOut = sanitizeHtmlForPdf(entityName);
  assert(!entityPdfOut.toLowerCase().includes('file:///c:'), 'el PDF elimina atributos con nombre ofuscado por character references');
  assert(entityPdfOut.includes('alt="ok"'), 'el PDF conserva los atributos legítimos del mismo tag');
  assert(!sanitizeHtmlForPreview(entityName).toLowerCase().includes('file:///c:'), 'la vista previa elimina el atributo de nombre ofuscado');

  const hexName = '<img &#x73;rc="file:///etc/passwd">';
  assert(!sanitizeHtmlForPdf(hexName).toLowerCase().includes('file:///etc/passwd'), 'el nombre ofuscado en hexadecimal también se elimina');

  const handlerName = '<div o&#110;error="alert(1)" data-x="y">z</div>';
  assert(!/onerror/i.test(sanitizeHtmlForPreview(handlerName)), 'un manejador con nombre ofuscado se elimina en vista previa');
  assert(!/onerror/i.test(sanitizeHtmlForPdf(handlerName)), 'un manejador con nombre ofuscado se elimina en PDF');

  const c0Payload = '<a href="&#1;javascript:alert(1)">x</a>';
  assert(!sanitizeHtmlForPdf(c0Payload).toLowerCase().includes('javascript:'), 'un carácter C0 delante del esquema no burla el neutralizador (PDF)');
  assert(!sanitizeHtmlForPreview(c0Payload).toLowerCase().includes('javascript:'), 'un carácter C0 delante del esquema no burla el neutralizador (vista previa)');

  const fakeHead = '<textarea>contenido</textarea><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body>x</body>';
  const fakeHeadOut = sanitizeHtmlForPdf(fakeHead);
  assert(fakeHeadOut.startsWith('<meta http-equiv="Content-Security-Policy"'), 'la CSP efectiva va siempre en el índice 0');

  finish();
}

run();
