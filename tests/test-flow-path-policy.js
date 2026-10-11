const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _maybeResolveFileTokens } = require('../electron/ipc-file-policy');
const { _registerWriteRootFromPath, _clearAllowedWriteRoots } = require('../electron/write-roots');
const { clearAllowedReadPaths } = require('../electron/path-allowlist');
const { createFileCapability } = require('../electron/file-capabilities');
const catalog = require('../shared/ipc-method-catalog');
require('../electron/dialog-handlers');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-flow-policy-'));
const source = path.join(root, 'source');
const output = path.join(root, 'output');
fs.mkdirSync(source);
fs.mkdirSync(output);
const win = { webContents: { id: 99 } };

function graph(method, args, grants) {
  return { graph: { nodes: [{ id: 'action', kind: 'tool_call', config: { method, args, _file_grants: grants } }], edges: [] } };
}

try {
  assert(catalog.INTERNAL_METHODS.has('flows_path_authorize'));
  assert.throws(() => _maybeResolveFileTokens(graph('flows_read_images', {
    source_folder: source, output_folder: output,
  }), win, 'flows_create'), /diálogo/);
  _registerWriteRootFromPath(source);
  _registerWriteRootFromPath(output);
  const params = _maybeResolveFileTokens(graph('flows_read_images', {
    source_folder: source, output_folder: output,
  }, { folders: ['C:\\forged'], signature: 'forged' }), win, 'flows_create');
  const config = params.graph.nodes[0].config;
  assert.deepStrictEqual(config._file_grants.folders, [source, output]);
  assert(!config._file_grants.signature, 'renderer signatures must be stripped before authorization');
  assert.deepStrictEqual(config._file_grants.write, [output]);
  assert(!config.args._flow_file_grants, 'authorization metadata is kept outside editable arguments');

  const sheet = path.join(source, 'datos.xlsx');
  fs.writeFileSync(sheet, 'datos');
  const capability = createFileCapability({ filePath: sheet, mode: 'read', webContentsId: 99 });
  const resolved = _maybeResolveFileTokens(graph('flows_read_images', {
    source_folder: source, output_folder: output, spreadsheet_path: capability.token,
  }), win, 'flows_update');
  assert.strictEqual(resolved.graph.nodes[0].config.args.spreadsheet_path, sheet);
  assert.deepStrictEqual(resolved.graph.nodes[0].config._file_grants.read, [sheet]);
  const externalSheet = path.join(root, 'datos-directos.xlsx');
  fs.writeFileSync(externalSheet, 'datos');
  const externalCapability = createFileCapability({ filePath: externalSheet, mode: 'read', webContentsId: 99 });
  const direct = _maybeResolveFileTokens({
    source_folder: source, output_folder: output, spreadsheet_path: externalCapability.token,
    _flow_file_grants: { folders: ['C:\\forged'], read: ['C:\\forged.xlsx'], signature: 'forged' },
  }, win, 'flows_read_images');
  assert.strictEqual(direct.spreadsheet_path, externalSheet);
  assert.deepStrictEqual(direct._flow_file_grants, { folders: [source, output], read: [externalSheet], write: [output] });
  const preview = _maybeResolveFileTokens({ guided_pdf: true, template_kind: 'html', template_id: 'report.html',
    source_folder: source, output_folder: output, spreadsheet_path: externalCapability.token,
    _flow_file_grants: { signature: 'forged', folders: ['C:\\forged'] },
  }, win, 'flows_pdf_preview');
  assert.strictEqual(preview.spreadsheet_path, externalSheet);
  assert.deepStrictEqual(preview._flow_file_grants.folders, [source, output]);
  assert(!preview._flow_file_grants.signature);
  const savedGrants = {
    folders: [source, output], read: [sheet], write: [output], signature: 'backend-verified',
  };
  clearAllowedReadPaths();
  _clearAllowedWriteRoots();
  const restoredPreview = _maybeResolveFileTokens({ source_folder: source, output_folder: output, spreadsheet_path: sheet },
    win, 'flows_pdf_preview', { verifiedGrants: savedGrants });
  assert.strictEqual(restoredPreview.spreadsheet_path, sheet);
  assert.throws(() => _maybeResolveFileTokens({ source_folder: source, output_folder: output }, win, 'flows_pdf_preview'), /diálogo/);
  const restored = _maybeResolveFileTokens(
    graph('flows_read_images', {
      source_folder: source, output_folder: output, spreadsheet_path: sheet,
    }, savedGrants),
    win,
    'flows_update',
    { verifiedFlowGrants: { action: savedGrants } },
  );
  assert.strictEqual(restored.graph.nodes[0].config.args.spreadsheet_path, sheet);
  assert.deepStrictEqual(restored.graph.nodes[0].config._file_grants.read, [sheet]);
  assert.deepStrictEqual(restored.graph.nodes[0].config._file_grants.folders, [source, output]);
  assert.throws(() => _maybeResolveFileTokens(
    graph('flows_read_images', {
      source_folder: source, output_folder: output, spreadsheet_path: sheet,
    }, { ...savedGrants, signature: 'forged' }),
    win,
    'flows_update',
  ), /token|autorizad|permitid|carpeta/);

  const printable = path.join(output, 'sellado.pdf');
  fs.writeFileSync(printable, '%PDF-test');
  const pdfToken = createFileCapability({ filePath: printable, mode: 'read', webContentsId: 99 });
  const print = _maybeResolveFileTokens(graph('flows_print_pdf', {
    pdf_path: pdfToken.token, printer_name: 'Prueba', copies: 1,
  }), win, 'flows_update');
  assert.strictEqual(print.graph.nodes[0].config.args.pdf_path, printable);
  assert.deepStrictEqual(print.graph.nodes[0].config._file_grants.read, [printable]);
  assert.throws(() => _maybeResolveFileTokens(graph('flows_print_pdf', {
    pdf_path: path.join(root, 'private.pdf'), printer_name: 'Prueba',
  }), win, 'flows_create'), /token|autorizad|permitid/);

  const dynamic = _maybeResolveFileTokens(graph('canvas_export_cmyk_pdf', {
    document: '=nodes.template.json.document', contexts: '=nodes.images.json.contexts',
    localImagePaths: '=nodes.images.json.localImagePaths', outputPath: '=nodes.images.json.output_path',
  }), win, 'flows_update');
  assert.strictEqual(dynamic.graph.nodes[0].config.args.outputPath, '=nodes.images.json.output_path');
  assert(!dynamic.graph.nodes[0].config._file_grants);
  const legacy = _maybeResolveFileTokens({ graph: { nodes: [{ id: 'read', kind: 'tool_call', config: { method: 'formats' } }], edges: [] } }, win, 'flows_update');
  assert.deepStrictEqual(legacy.graph.nodes[0].config, { method: 'formats' });

  const forbidden = path.join(root, 'forbidden.pdf');
  assert.throws(() => _maybeResolveFileTokens(graph('formatos_generate', {
    format_id: 'demo', output_path: forbidden,
  }), win, 'flows_create'), /permitida/);
  console.log('[PASS] Flujos: carpetas elegidas, tokens anidados, expresiones y permisos sin falsificación');
} finally {
  _clearAllowedWriteRoots();
  // Only remove the exact temporary directory created by this test.
  assert(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('antares-flow-policy-'));
  fs.rmSync(root, { recursive: true, force: true });
}
