'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assert, finish } = require('./helpers/harness');
const script = require('../electron/agent-script');
const native = require('../electron/agent-native-tools');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  assert(script.isReadOnlyTool({ name: 'fs_read', kind: 'backend', gated: false, replay_safe: true }),
    'las lecturas backend idempotentes son válidas para script_run');
  assert(!script.isReadOnlyTool({ name: 'fs_write', kind: 'backend', gated: true, replay_safe: false }),
    'un efecto backend queda fuera del sandbox');
  assert(!script.isReadOnlyTool({ name: 'fs_read', kind: 'backend', gated: false, replay_safe: false }),
    'una lectura backend no idempotente queda fuera por precaución');
  assert(script.isReadOnlyTool({ name: 'web_read', kind: 'native', gated: false, module: 'computer' }),
    'las lecturas nativas del navegador son válidas');
  assert(script.isReadOnlyTool({ name: 'padron_describe', kind: 'native', gated: false, module: 'padron' }),
    'los descriptores nativos de Padrones son lecturas');
  assert(script.isReadOnlyTool({ name: 'autoimg_status', kind: 'native', gated: false, module: 'autoimg' }),
    'las consultas de AutoIMG están permitidas explícitamente');
  assert(!script.isReadOnlyTool({ name: 'document_generate', kind: 'native', gated: false, module: 'documents' }),
    'generar un documento no es una lectura aunque no pida aprobación');
  assert(!script.isReadOnlyTool({ name: 'padron_export_pdf', kind: 'native', gated: false, module: 'padron' }),
    'exportar un PDF queda fuera del sandbox');
  assert(!script.isReadOnlyTool({ name: 'web_open', kind: 'native', gated: false, module: 'computer' }),
    'navegar no es una lectura aunque no pida aprobación');
  assert(!script.isReadOnlyTool({ name: 'gdrive_download', kind: 'native', gated: false, module: 'connections' }),
    'descargar escribe un archivo y queda fuera del sandbox');
  assert(!script.isReadOnlyTool({ name: 'espacios_futuro_create', kind: 'native', gated: false, module: 'espacios' }),
    'una nativa nueva no se presume lectura: la allowlist es fail-closed');
  assert(!script.isReadOnlyTool({ name: 'script_run', kind: 'native', gated: false, module: 'agent' }),
    'el sandbox no puede invocarse a sí mismo');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-agent-script-'));
  try {
    const isolated = await script.runScript({
      dir,
      code: `let dynamicImport;
      try { await import('fs'); dynamicImport = 'ESCAPED'; }
      catch (error) { dynamicImport = String((error && error.message) || error); }
      return {
        require: typeof require, process: typeof process, fetch: typeof fetch,
        Buffer: typeof Buffer, module: typeof module, exports: typeof exports,
        setTimeout: typeof setTimeout, setInterval: typeof setInterval,
        globalRequire: typeof globalThis.require, globalProcess: typeof globalThis.process,
        finish: typeof __finish, print: typeof print, tools: typeof tools.call, console: typeof console.log,
        dynamicImport,
      };`,
      tools: [],
      callTool: async () => null,
    });
    assert(!isolated.error && isolated.result, `el sandbox devuelve un resultado: ${isolated.error || ''}`);
    for (const key of ['require', 'process', 'fetch', 'Buffer', 'module', 'exports', 'setTimeout', 'setInterval',
      'globalRequire', 'globalProcess', 'finish']) {
      assert(isolated.result[key] === 'undefined', `el sandbox no expone ${key}`);
    }
    assert(isolated.result.print === 'function' && isolated.result.tools === 'function'
      && isolated.result.console === 'function', 'el sandbox expone print, tools.call y console.log');
    assert(/dynamic import callback/i.test(isolated.result.dynamicImport),
      'el sandbox no ofrece un cargador para importaciones dinámicas');

    const escaped = await script.runScript({
      dir,
      code: `const out = {};
        for (const [key, attempt] of Object.entries({
          this: () => this.constructor.constructor('return process')(),
          global: () => globalThis.constructor.constructor('return process')(),
          console: () => console.log.constructor('return process')(),
          tools: () => tools.call.constructor('return process')(),
        })) {
          try { attempt(); out[key] = 'ESCAPED'; } catch (error) { out[key] = String(error.message || error); }
        }
        return out;`,
      tools: [],
      callTool: async () => null,
    });
    assert(!escaped.error, 'los intentos de fuga se responden sin romper el sandbox');
    assert(Object.values(escaped.result).every((value) => /Code generation from strings disallowed/.test(value)),
      'la generación dinámica de código está bloqueada dentro del sandbox');

    const capped = await script.runScript({
      dir,
      maxOutputChars: 120,
      code: `print('x'.repeat(5000)); return { ok: true };`,
      tools: [],
      callTool: async () => null,
    });
    assert(capped.output.length === 120 && capped.output_chars === 120 && capped.output_total_chars === 5000
      && capped.output_truncated, 'la salida devuelta respeta el tope y distingue lo mostrado de lo producido');
    assert(capped.result && capped.result.ok === true, 'el resultado estructurado no se pierde al recortar la salida');
    assert(capped.saved_path && fs.existsSync(capped.saved_path), 'el volcado completo queda en un archivo');
    const dump = JSON.parse(fs.readFileSync(capped.saved_path, 'utf8'));
    assert(dump.output.length === 5000 && dump.output_chars === 5000 && dump.output_total_chars === 5000
      && dump.result.ok === true && dump.output_truncated === false,
      'el archivo conserva la salida completa y el resultado');

    const oversized = await script.runScript({
      dir,
      maxOutputChars: 100,
      maxStoredChars: 1_000_000,
      code: "print('\\u0001'.repeat(1000000)); return 1;",
      tools: [],
      callTool: async () => null,
    });
    assert(oversized.file_truncated === true && oversized.saved_path && fs.existsSync(oversized.saved_path),
      'un volcado que excede el archivo se recorta y se anuncia');
    const partial = JSON.parse(fs.readFileSync(oversized.saved_path, 'utf8'));
    assert(partial.file_truncated === true && partial.output_total_chars === 1_000_000
      && partial.output_chars < 1_000_000 && partial.output.length === partial.output_chars,
      'el archivo recortado conserva el total producido y el tamaño realmente guardado');

    const large = await script.runScript({
      dir,
      code: `return 'x'.repeat(3000);`,
      tools: [],
      callTool: async () => null,
    });
    assert(large.result === undefined && large.result_preview && large.result_in_file === true
      && large.result_truncated !== true, 'un resultado grande se previsualiza y se remite al volcado completo');

    let active = 0;
    let maxActive = 0;
    const parallel = await script.runScript({
      dir,
      maxConcurrentCalls: 3,
      code: `const [a, b, c] = await Promise.all([
        tools.call('fs_read', { n: 1 }),
        tools.call('fs_read', { n: 2 }),
        tools.call('fs_read', { n: 3 }),
      ]);
      return [a, b, c];`,
      tools: [{ name: 'fs_read', module: 'computer', description: 'Leer un archivo' }],
      callTool: async (name, args) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          await delay(40);
          return { name, args };
        } finally {
          active -= 1;
        }
      },
    });
    assert(!parallel.error && parallel.calls === 3, 'el script puede hacer varias llamadas');
    assert(maxActive >= 2, 'las llamadas independientes se ejecutan en paralelo');
    assert(parallel.result.length === 3 && parallel.result.every((item, index) => item.args.n === index + 1),
      'Promise.all conserva el resultado de cada llamada');

    const cappedCalls = await script.runScript({
      dir,
      code: `const results = await Promise.allSettled(Array.from({ length: 26 }, (_, i) => tools.call('fs_read', { i })));
        return results.filter((item) => item.status === 'rejected').length;`,
      tools: [{ name: 'fs_read', module: 'computer', description: 'Leer un archivo' }],
      callTool: async () => null,
    });
    assert(cappedCalls.result === 1 && cappedCalls.calls === 26, 'el script rechaza las llamadas que superan el tope');

    let deniedCalls = 0;
    const denied = await script.runScript({
      dir,
      code: `try { await tools.call('fs_write', { path: 'x', content: 'y' }); return 'NO'; }
        catch (error) { return String(error.message || error); }`,
      tools: [{ name: 'fs_read', module: 'computer' }],
      callTool: async () => { deniedCalls += 1; return null; },
    });
    assert(!denied.error && /no permitida/.test(denied.result) && deniedCalls === 0,
      'el sandbox rechaza una herramienta fuera del catálogo de lectura');

    const failure = await script.runScript({
      dir,
      code: `try { await tools.call('fs_read', { path: 'x' }); return 'NO'; }
        catch (error) { return String(error.message || error); }`,
      tools: [{ name: 'fs_read', module: 'computer' }],
      callTool: async () => { throw new Error('sin grant'); },
    });
    assert(!failure.error && failure.result === 'sin grant', 'un fallo de herramienta rechaza la promesa del script');

    const syntax = await script.runScript({
      dir,
      code: 'return (',
      tools: [],
      callTool: async () => null,
    });
    assert(syntax.error && /SyntaxError/.test(syntax.error), 'un script inválido devuelve el error de sintaxis');
    assert(syntax.saved_path && fs.existsSync(syntax.saved_path), 'un script fallido también deja su volcado');

    const started = Date.now();
    const timeout = await script.runScript({
      dir,
      timeoutMs: 400,
      code: `await tools.call('fs_read', {}); while (true) {}`,
      tools: [{ name: 'fs_read', module: 'computer' }],
      callTool: async () => ({ ok: true }),
    });
    assert(timeout.timed_out === true && timeout.error && Date.now() - started < 5000,
      'el worker se termina cuando el script agota su tiempo');

    const specs = native.nativeToolSpecs();
    const spec = specs.find((item) => item.name === 'script_run');
    assert(spec && spec.kind === 'native' && spec.gated === false && spec.module === 'agent',
      'script_run se registra como herramienta nativa de solo lectura');
    assert(spec.inputSchema.required.includes('script') && spec.description.includes('sandbox'),
      'script_run describe el sandbox y exige el código');
    assert(spec.inputSchema.properties.script.maxLength === script.SCRIPT_MAX_CHARS
      && spec.inputSchema.properties.max_output_chars.maximum === script.MAX_OUTPUT_CHARS,
      'el contrato de script_run reutiliza los topes del sandbox');
    let directRun = false;
    try { await native.runNativeTool('script_run', {}, {}); } catch { directRun = true; }
    assert(directRun, 'script_run no se despacha por el backend nativo');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('[PASS] script_run: sandbox aislado, lecturas paralelas, tope de salida y volcado completo.');
}

main().then(() => finish(), (error) => { console.error('[FAIL]', error); process.exit(1); });
