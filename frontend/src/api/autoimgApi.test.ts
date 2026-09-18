import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutoimgApi } from './autoimgApi';

describe('createAutoimgApi', () => {
  const invoke = vi.fn(async () => ({}));
  const api = createAutoimgApi(invoke);

  beforeEach(() => {
    invoke.mockClear();
    invoke.mockResolvedValue({});
  });

  it('mapea cada método a su nombre IPC con los params correctos', async () => {
    const cases: Array<[keyof ReturnType<typeof createAutoimgApi>, unknown[], string, unknown?]> = [
      ['autoimgOAuthConfigStatus', [], 'autoimg_oauth_config_status'],
      ['autoimgOAuthConfigSave', ['id', 'secret'], 'autoimg_oauth_config_save', { client_id: 'id', client_secret: 'secret' }],
      ['autoimgSheetsAuthUrl', [], 'autoimg_sheets_auth_url'],
      ['autoimgSheetsAuthCancel', [], 'autoimg_sheets_auth_cancel'],
      ['autoimgSheetsAuthStatus', [], 'autoimg_sheets_auth_status'],
      ['autoimgSheetsAuthRevoke', [], 'autoimg_sheets_auth_revoke'],
      ['autoimgSheetsOpen', ['sheet-1'], 'autoimg_sheets_open', { sheet_id: 'sheet-1' }],
      ['autoimgSheetsGetConfig', [], 'autoimg_sheets_get_config'],
      ['autoimgSheetsReadRange', ['A1:B2'], 'autoimg_sheets_read_range', { range: 'A1:B2' }],
      ['autoimgSheetsWriteRange', ['A1', [['a']]], 'autoimg_sheets_write_range', { range: 'A1', values: [['a']] }],
      ['autoimgSheetsAppendRow', ['A1', ['a']], 'autoimg_sheets_append_row', { range: 'A1', values: ['a'] }],
      ['autoimgDriveListFolder', ['f1'], 'autoimg_drive_list_folder', { folder_id: 'f1' }],
      ['autoimgDriveScanNis', ['f1', 'nombre'], 'autoimg_drive_scan_nis', { folder_id: 'f1', folder_name: 'nombre' }],
      ['autoimgDriveVerifyFolder', ['https://x'], 'autoimg_drive_verify_folder', { url: 'https://x' }],
      ['autoimgDriveFolderPreview', ['f1'], 'autoimg_drive_folder_preview', { folder_id: 'f1', force: false }],
      ['autoimgDriveFolderPreview', ['f1', true], 'autoimg_drive_folder_preview', { folder_id: 'f1', force: true }],
      ['autoimgDriveStatus', [], 'autoimg_drive_status'],
      ['autoimgFoldersList', [], 'autoimg_folders_list', { force: false }],
      ['autoimgFoldersAdd', [{ name: 'n', folder_id: 'f', activo: true }], 'autoimg_folders_add', { name: 'n', folder_id: 'f', activo: true }],
      ['autoimgFoldersRemove', [{ folder_id: 'f' }], 'autoimg_folders_remove', { folder_id: 'f' }],
      ['autoimgFoldersToggle', [{ folder_id: 'f', activo: false }], 'autoimg_folders_toggle', { folder_id: 'f', activo: false }],
      ['autoimgScanAndSync', [], 'autoimg_scan_and_sync'],
      ['autoimgSyncToSheet', [], 'autoimg_sync_to_sheet'],
      ['autoimgSyncFromSheet', [], 'autoimg_sync_from_sheet'],
      ['autoimgRenameExport', [{ dest_folder_id: 'd', only_completos: true }], 'autoimg_rename_export', { dest_folder_id: 'd', only_completos: true }],
      ['autoimgRenameDestConfig', [], 'autoimg_rename_dest_config'],
      ['autoimgArrastreList', [true], 'autoimg_arrastre_list', { force: true }],
      ['autoimgLogsList', [], 'autoimg_logs_list', { force: false }],
      ['autoimgBootstrap', [], 'autoimg_bootstrap', { refresh: true }],
      ['autoimgBootstrap', [false], 'autoimg_bootstrap', { refresh: false }],
      ['autoimgAutoSyncToggle', [true], 'autoimg_auto_sync_toggle', { enabled: true }],
      ['autoimgScanAll', [], 'autoimg_scan_all'],
      ['autoimgCancelOperation', [], 'autoimg_cancel_operation'],
      ['autoimgOperationStatus', [], 'autoimg_operation_status'],
      ['autoimgStatus', [], 'autoimg_status'],
    ];

    for (const [method, args, ipcName, expectedParams] of cases) {
      invoke.mockClear();
      await (api[method] as unknown as (...a: unknown[]) => Promise<unknown>)(...args);
      expect(invoke, `${String(method)} debe invocar ${ipcName}`).toHaveBeenCalledTimes(1);
      const call = invoke.mock.calls[0];
      expect(call[0], `${String(method)} → nombre IPC`).toBe(ipcName);
      expect(call.length > 1 ? call[1] : undefined, `${String(method)} → params`).toEqual(
        expectedParams,
      );
    }
  });

  it('propaga el resultado y los errores de invoke', async () => {
    invoke.mockResolvedValueOnce({ ok: 1 });
    await expect(api.autoimgStatus()).resolves.toEqual({ ok: 1 });
    invoke.mockRejectedValueOnce(new Error('ipc caído'));
    await expect(api.autoimgStatus()).rejects.toThrow('ipc caído');
  });
});
