'use strict';

// Clasificación de las herramientas nativas que ve el agente: lecturas sin
// aprobación, efectos con aprobación y configuración humana fuera.

const { assert, finish } = require('./helpers/harness');
const { nativeToolSpecs } = require('../electron/agent-native-tools');
const { nativeMethods } = require('../shared/ipc-method-catalog');

const specs = nativeToolSpecs();
const names = new Set(specs.map((s) => s.name));
const autoimg = nativeMethods('autoimg');

assert(specs.every((s) => autoimg.has(s.name)), 'toda herramienta nativa existe en el catálogo native:autoimg');
assert(specs.every((s) => s.kind === 'native' && s.module === 'autoimg' && s.inputSchema.type === 'object'), 'specs completas');
for (const config of ['autoimg_oauth_config_save', 'autoimg_oauth_config_status', 'autoimg_sheets_auth_url',
  'autoimg_sheets_auth_revoke', 'autoimg_sheets_auth_cancel', 'autoimg_sheets_open', 'autoimg_auto_sync_toggle', 'autoimg_bootstrap']) {
  assert(!names.has(config), `${config} queda en la interfaz humana`);
}
for (const effect of ['autoimg_sheets_write_range', 'autoimg_sheets_append_row', 'autoimg_sync_to_sheet',
  'autoimg_sync_from_sheet', 'autoimg_scan_and_sync', 'autoimg_rename_export', 'autoimg_folders_remove']) {
  assert(specs.find((s) => s.name === effect).gated === true, `${effect} requiere aprobación`);
}
assert(specs.find((s) => s.name === 'autoimg_sheets_read_range').gated === false, 'leer un rango es automático');

finish();
