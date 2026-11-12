'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { neutralizeCell, neutralizeCells } = require('../electron/sheets-formula-guard');

function main() {
  let failed = false;
  const check = (name, fn) => {
    try {
      fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed = true;
      console.error(`  ✗ ${name}: ${err.message}`);
    }
  };

  const cases = [
    ['=SUM(A1:A9)', "'=SUM(A1:A9)"],
    ['+IMPORTXML("https://malo","//a")', "'+IMPORTXML(\"https://malo\",\"//a\")"],
    ['-SUM(A1)', "'-SUM(A1)"],
    ['@tabla', "'@tabla"],
    ['-123.45', '-123.45'],
    ['+7', '+7'],
    ['-1e9', '-1e9'],
    ['+50%', '+50%'],
    ['3,14', '3,14'],
    ['total general', 'total general'],
    ['=1+1\t\tcmd', "'=1+1\t\tcmd"],
    ['\t9', "'\t9"],
    ['\rcmd', "'\rcmd"],
    ['', ''],
    ['=', "'="],
  ];
  check('neutralizeCell: prefijos de fórmula neutralizados, números intactos', () => {
    for (const [input, expected] of cases) {
      assert.strictEqual(neutralizeCell(input), expected, `entrada ${JSON.stringify(input)}`);
    }
    assert.strictEqual(neutralizeCell(1234), 1234, 'los números nativos pasan sin tocar');
    assert.strictEqual(neutralizeCell(null), null);
  });

  check('neutralizeCells: matriz por filas y filas sueltas', () => {
    assert.deepStrictEqual(
      neutralizeCells([['=HACK()', 'ok', 5], ['-1.5', { keep: true }]]),
      [["'=HACK()", 'ok', 5], ['-1.5', { keep: true }]],
    );
    assert.deepStrictEqual(neutralizeCells(['=a', 'b']), ["'=a", 'b'], 'fila suelta se trata como celdas');
    assert.strictEqual(neutralizeCells('no-arreglo'), 'no-arreglo');
  });

  const sheets = fs.readFileSync(path.join(__dirname, '..', 'electron', 'google-sheets-service.js'), 'utf8');
  const workspace = fs.readFileSync(path.join(__dirname, '..', 'electron', 'google-workspace-service.js'), 'utf8');
  check('google-sheets-service: writeRange/appendRow/batchWriteRanges neutralizan', () => {
    assert.match(sheets, /body: JSON\.stringify\(\{ values: neutralizeCells\(values\) \}\)/);
    assert.match(sheets, /body: JSON\.stringify\(\{ values: neutralizeCells\(\[values\]\) \}\)/);
    assert.match(sheets, /values: neutralizeCells\(u\.values\)/);
  });
  check('google-workspace-service: updateRange/append neutralizan', () => {
    assert.match(workspace, /const values = neutralizeCells\(cloud\.matrix\(params\.values\)\)/);
    assert.match(workspace, /body: JSON\.stringify\(\{ values: neutralizeCells\(cloud\.matrix\(params\.values\)\) \}\)/);
  });

  console.log(failed ? '[FAIL] sheets formula guard' : '[PASS] sheets formula guard: fórmulas foráneas se guardan como texto');
  process.exitCode = failed ? 1 : 0;
}

main();
