// Parity contract test: every case in shared/html-sanitizer-spec.json must
// hold for the JS adapters (sanitizeHtmlForPdf + sanitizeHtmlForPreview).
// The same corpus runs against the Python adapter in
// tests/test_html_sanitizer_spec.py — drift between the twins becomes a
// failing build.
const { sanitizeHtmlForPdf, sanitizeHtmlForPreview } = require('../shared/html-sanitizer');
const spec = require('../shared/html-sanitizer-spec.json');

const ADAPTERS = {
  pdf: sanitizeHtmlForPdf,
  preview: sanitizeHtmlForPreview,
};

let passed = 0;
let failed = 0;

function report(ok, message, output) {
  if (ok) {
    passed++;
    return;
  }
  console.error(`  ✗ ${message}`);
  if (output !== undefined) {
    console.error(`      output: ${output.slice(0, 200)}`);
  }
  failed++;
}

function checkCase(testCase) {
  for (const [adapterName, sanitize] of Object.entries(ADAPTERS)) {
    const output = sanitize(testCase.html);
    const lowered = output.toLowerCase();
    const tag = `[${adapterName}] ${testCase.id}`;

    for (const needle of testCase.absent || []) {
      report(
        !lowered.includes(needle.toLowerCase()),
        `${tag}: output no debería contener "${needle}"`,
        output,
      );
    }
    for (const needle of testCase.present || []) {
      report(
        lowered.includes(needle.toLowerCase()),
        `${tag}: output debería contener "${needle}"`,
        output,
      );
    }
    const perAdapter = (testCase.adapters && testCase.adapters[adapterName]) || {};
    for (const needle of perAdapter.absent || []) {
      report(
        !lowered.includes(needle.toLowerCase()),
        `${tag}: output no debería contener "${needle}"`,
        output,
      );
    }
    for (const needle of perAdapter.present || []) {
      report(
        lowered.includes(needle.toLowerCase()),
        `${tag}: output debería contener "${needle}"`,
        output,
      );
    }
  }
}

function run() {
  console.log(`Testing shared sanitizer spec (${spec.cases.length} cases × ${Object.keys(ADAPTERS).length} adapters)...\n`);

  for (const testCase of spec.cases) {
    checkCase(testCase);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed > 0) process.exit(1);
}

run();
