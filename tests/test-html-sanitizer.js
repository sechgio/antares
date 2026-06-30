// Regression test: shared HTML sanitizer used by Electron and frontend.
const { sanitizeHtmlForPdf } = require('../shared/html-sanitizer');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

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

  // ─── Regression guards for S-CRÍTICO-1 / S-CRÍTICO-2 / M1 fixes ───────
  // CSS url(javascript:) used to survive because the href/src regex did
  // not reach into CSS. It must now be neutralised.
  const cssJsPayload = "<head></head><style>.x{background:url(javascript:alert(1))}</style>";
  const cssJsOut = sanitizeHtmlForPdf(cssJsPayload);
  assert(!cssJsOut.toLowerCase().includes('javascript:alert'), 'S-CRÍTICO-1: neutralises url(javascript:) in CSS');
  assert(cssJsOut.includes("url('')"), 'S-CRÍTICO-1: replaces url(javascript:) with empty url()');

  // Backtick-quoted event handlers used to bypass the double/single-quote
  // regexes. All quote styles must now be stripped.
  const backtickPayload = "<head></head><img src=x onerror=`alert(1)`>";
  const backtickOut = sanitizeHtmlForPdf(backtickPayload);
  assert(!backtickOut.toLowerCase().includes('onerror'), 'S-CRÍTICO-2: strips backtick-quoted event handlers');

  // Boolean-form event handler attribute (no `=value`) used to survive
  // because the regexes required `=`. The browser fires it on load.
  const booleanPayload = "<head></head><svg onload>";
  const booleanOut = sanitizeHtmlForPdf(booleanPayload);
  assert(!booleanOut.toLowerCase().includes('onload'), 'S-CRÍTICO-2: strips boolean-form event handler attributes');

  // Nested script trick: `<script><script>x</script>` left an orphan
  // `<script>` after the non-greedy first pass consumed the inner
  // closing tag. A second pass must mop up the residual.
  const nestedPayload = "<head></head><script><script>alert(1)</script>";
  const nestedOut = sanitizeHtmlForPdf(nestedPayload);
  assert(!nestedOut.toLowerCase().includes('<script'), 'S-ALTO-1: strips residual <script> after nested-trick payload');

  // SVG data: URIs can carry <script> and event handlers, so they must
  // be collapsed like other unsafe url() references.
  const svgDataPayload = "<head></head><style>.x{background:url(data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)}</style>";
  const svgDataOut = sanitizeHtmlForPdf(svgDataPayload);
  assert(!svgDataOut.toLowerCase().includes('data:image/svg'), 'S-MEDIO-1: collapses data:image/svg+xml URIs in CSS');

  // data:image/png must still pass through (parity with the safe case).
  const pngDataPayload = "<head></head><style>.x{background:url(data:image/png;base64,iVBOR=)}</style>";
  const pngDataOut = sanitizeHtmlForPdf(pngDataPayload);
  assert(pngDataOut.includes('data:image/png;base64,iVBOR='), 'S-MEDIO-1: keeps data:image/png URIs in CSS');

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed > 0) process.exit(1);
}

run();
