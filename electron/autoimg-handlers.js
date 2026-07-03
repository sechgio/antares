const { getMainWindow } = require('./window-manager');

const AUTOIMG_METHODS = new Set([
  'autoimg_oauth_config_status',
  'autoimg_oauth_config_save',
  'autoimg_sheets_auth_url',
  'autoimg_sheets_auth_callback',
  'autoimg_sheets_auth_cancel',
  'autoimg_sheets_auth_status',
  'autoimg_sheets_auth_revoke',
  'autoimg_sheets_open',
  'autoimg_sheets_get_config',
  'autoimg_sheets_read_range',
  'autoimg_sheets_write_range',
  'autoimg_sheets_append_row',
  'autoimg_drive_list_folder',
  'autoimg_drive_scan_nis',
  'autoimg_drive_verify_folder',
  'autoimg_drive_status',
  'autoimg_folders_list',
  'autoimg_folders_add',
  'autoimg_folders_remove',
  'autoimg_folders_toggle',
  'autoimg_scan_all',
  'autoimg_scan_and_sync',
  'autoimg_sync_to_sheet',
  'autoimg_sync_from_sheet',
  'autoimg_arrastre_list',
  'autoimg_auto_sync_toggle',
  'autoimg_status',
]);

const sheets = require('./google-sheets-service');
const drive = require('./google-drive-service');
const engine = require('./autoimg-sync-engine');
const { sanitizeError, sanitizeErrorMessage, assertNoSecretInObject } = require('./autoimg-security');
const { assertAllowedSheetRange } = require('./autoimg-sheet-ranges');

function _emitNotify(method, params) {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send('ipc-notify', method, params);
}

async function handleAutoimgCall(method, params = {}) {
  if (!AUTOIMG_METHODS.has(method)) return { handled: false };

  try {
    switch (method) {
      case 'autoimg_oauth_config_status': {
        const result = sheets.getOAuthConfigStatus();
        assertNoSecretInObject(result);
        return { handled: true, result };
      }

      case 'autoimg_oauth_config_save': {
        const clientId = typeof params.client_id === 'string' ? params.client_id : '';
        const clientSecret = typeof params.client_secret === 'string' ? params.client_secret : '';
        const result = sheets.saveOAuthConfig(clientId, clientSecret);
        return { handled: true, result };
      }

      case 'autoimg_sheets_auth_url': {
        const { shell } = require('electron');
        const result = await sheets.beginBrowserOAuthFlow(
          (status) => _emitNotify('autoimg.auth.complete', status),
          (err) => _emitNotify('autoimg.auth.error', {
            message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
          }),
        );
        await shell.openExternal(result.url);
        return { handled: true, result: { ...result, opened: true } };
      }

      case 'autoimg_sheets_auth_callback': {
        await sheets.exchangeCode(params.code, params.redirect_uri);
        return { handled: true, result: { success: true } };
      }

      case 'autoimg_sheets_auth_cancel':
        sheets.cancelBrowserOAuthFlow();
        return { handled: true, result: { success: true } };

      case 'autoimg_sheets_auth_status':
        return { handled: true, result: await sheets.getAuthStatus() };

      case 'autoimg_sheets_auth_revoke':
        return { handled: true, result: await sheets.revokeAuth() };

      case 'autoimg_sheets_open':
        return { handled: true, result: await sheets.openSpreadsheet(params.sheet_id || params.url || '') };

      case 'autoimg_sheets_get_config':
        return { handled: true, result: await sheets.restorePersistedSheet() };

      case 'autoimg_sheets_read_range': {
        const range = assertAllowedSheetRange(params.range);
        return { handled: true, result: await sheets.readRange(range) };
      }

      case 'autoimg_sheets_write_range': {
        const range = assertAllowedSheetRange(params.range);
        return { handled: true, result: await sheets.writeRange(range, params.values) };
      }

      case 'autoimg_sheets_append_row': {
        const range = assertAllowedSheetRange(params.range);
        return { handled: true, result: await sheets.appendRow(range, params.values) };
      }

      case 'autoimg_drive_list_folder': {
        const folderId = drive.assertValidFolderId(params.folder_id);
        const files = await drive.listFolder(folderId);
        return { handled: true, result: { files } };
      }

      case 'autoimg_drive_scan_nis': {
        const folderId = drive.assertValidFolderId(params.folder_id);
        return { handled: true, result: await drive.scanNis(folderId, params.folder_name || '') };
      }

      case 'autoimg_drive_verify_folder':
        return { handled: true, result: await drive.verifyFolder(params.folder_id || params.url || '') };

      case 'autoimg_drive_status':
        return { handled: true, result: await drive.getDriveStatus() };

      case 'autoimg_folders_list':
        return { handled: true, result: await engine.listFolders() };

      case 'autoimg_folders_add':
        return { handled: true, result: await engine.addFolder(params) };

      case 'autoimg_folders_remove':
        return { handled: true, result: await engine.removeFolder(params) };

      case 'autoimg_folders_toggle':
        return { handled: true, result: await engine.toggleFolder(params) };

      case 'autoimg_scan_all':
        return { handled: true, result: await engine.scanAll() };

      case 'autoimg_scan_and_sync':
        return { handled: true, result: await engine.scanAndSync() };

      case 'autoimg_sync_to_sheet':
        return { handled: true, result: await engine.syncToSheet() };

      case 'autoimg_sync_from_sheet':
        return { handled: true, result: await engine.syncFromSheet() };

      case 'autoimg_arrastre_list':
        return { handled: true, result: await engine.listArrastre() };

      case 'autoimg_auto_sync_toggle':
        return { handled: true, result: engine.setAutoSync(params.enabled) };

      case 'autoimg_status':
        return { handled: true, result: await engine.getStatus() };

      default:
        return { handled: false };
    }
  } catch (err) {
    throw sanitizeError(err);
  }
}

module.exports = { AUTOIMG_METHODS, handleAutoimgCall };