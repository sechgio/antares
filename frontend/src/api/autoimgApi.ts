import type { AutoImgFolder } from '../components/autoimg/types';

type IpcInvoke = <T>(method: string, params?: Record<string, unknown> | object) => Promise<T>;

export function createAutoimgApi(invoke: IpcInvoke) {
  return {
    autoimgOAuthConfigStatus: () => invoke<{ configured: boolean; client_id_masked?: string }>('autoimg_oauth_config_status'),
    autoimgOAuthConfigSave: (client_id: string, client_secret: string) =>
      invoke<{ success: boolean }>('autoimg_oauth_config_save', { client_id, client_secret }),
    autoimgSheetsAuthUrl: () => invoke<{ url: string; redirect_uri: string }>('autoimg_sheets_auth_url'),
    autoimgSheetsAuthCancel: () => invoke<{ success: boolean }>('autoimg_sheets_auth_cancel'),
    autoimgSheetsAuthStatus: () => invoke<{ authenticated: boolean; email?: string }>('autoimg_sheets_auth_status'),
    autoimgSheetsAuthRevoke: () => invoke<{ success: boolean }>('autoimg_sheets_auth_revoke'),
    autoimgSheetsOpen: (sheet_id: string) =>
      invoke<{ success: boolean; sheet_id?: string; name?: string; sheets?: string[]; created_tabs?: string[] }>('autoimg_sheets_open', { sheet_id }),
    autoimgSheetsGetConfig: () => invoke<{ sheet_id: string; name: string; linked: boolean }>('autoimg_sheets_get_config'),
    autoimgSheetsReadRange: (range: string) => invoke<{ values: string[][] }>('autoimg_sheets_read_range', { range }),
    autoimgSheetsWriteRange: (range: string, values: string[][]) =>
      invoke<{ updated: number }>('autoimg_sheets_write_range', { range, values }),
    autoimgSheetsAppendRow: (range: string, values: string[]) =>
      invoke<{ row: number }>('autoimg_sheets_append_row', { range, values }),
    autoimgDriveListFolder: (folder_id: string) =>
      invoke<{ files: Array<{ name: string; id: string; modifiedTime: string }> }>('autoimg_drive_list_folder', { folder_id }),
    autoimgDriveScanNis: (folder_id: string, folder_name?: string) =>
      invoke<{ nis_map: Record<string, { count: number; files: unknown[] }> }>('autoimg_drive_scan_nis', { folder_id, folder_name }),
    autoimgDriveVerifyFolder: (urlOrId: string) =>
      invoke<{ accessible: boolean; folder_id: string; name: string; image_count: number; sample_files: string[] }>('autoimg_drive_verify_folder', { url: urlOrId }),
    autoimgDriveFolderPreview: (folder_id: string, force = false) =>
      invoke<{
        folder_id: string;
        thumbs: Array<{ id: string; name: string; dataUrl: string | null }>;
      }>('autoimg_drive_folder_preview', { folder_id, force }),
    autoimgDriveStatus: () => invoke<{ connected: boolean }>('autoimg_drive_status'),
    autoimgFoldersList: (force = false) =>
      invoke<{ folders: Array<{ name: string; folder_id: string; activo: boolean; ultimo_scan: string; cant_archivos: number }>; cached?: boolean }>('autoimg_folders_list', { force }),
    autoimgFoldersAdd: (body: { name: string; folder_id: string; activo: boolean }) =>
      invoke<{ success: boolean; folder_id?: string; drive_name?: string; folders?: AutoImgFolder[] }>('autoimg_folders_add', body),
    autoimgFoldersRemove: (body: { folder_id: string }) =>
      invoke<{ success: boolean; folders?: AutoImgFolder[] }>('autoimg_folders_remove', body),
    autoimgFoldersToggle: (body: { folder_id: string; activo: boolean }) =>
      invoke<{ success: boolean; folders?: AutoImgFolder[] }>('autoimg_folders_toggle', body),
    autoimgScanAndSync: () => invoke<{
      success: boolean;
      updated: number;
      matched?: number;
      unmatched_scan?: number;
      new_rows: number;
      duplicate_nis?: number;
      logs: string[];
      folder_errors: number;
      scan: {
        summary: {
          total: number;
          completos: number;
          faltantes: number;
          sobrantes: number;
          fuera_padron: number;
          /** @deprecated alias de fuera_padron */
          sin_sgio?: number;
        };
        folders_failed: number;
      };
    }>('autoimg_scan_and_sync'),
    autoimgSyncToSheet: () => invoke<{
      success: boolean;
      updated: number;
      matched?: number;
      unmatched_scan?: number;
      new_rows: number;
      duplicate_nis?: number;
      logs: string[];
    }>('autoimg_sync_to_sheet'),
    autoimgSyncFromSheet: () =>
      invoke<{ success: boolean; rows: string[][]; arrastre?: Array<{ nis: string; sgio: string; motivo: string; fecha: string; observacion: string }> }>('autoimg_sync_from_sheet'),
    autoimgRenameExport: (body: { dest_folder_id: string; only_completos?: boolean }) => invoke<{
      success: boolean;
      dest_folder_id: string;
      dest_name: string;
      destinos: string[];
      folders_created: string[];
      planned: number;
      copied: Array<{
        nis: string;
        sgio: string;
        destino?: string;
        slot: number;
        from: string;
        to: string;
        folder?: string;
        file_id: string;
      }>;
      failed: Array<{
        nis: string;
        sgio: string;
        destino?: string;
        from: string;
        to: string;
        error: string;
      }>;
      skipped: Array<{
        nis: string;
        sgio?: string;
        destino?: string;
        reason: string;
        detail?: string;
      }>;
      scan_summary?: {
        total: number;
        completos: number;
        faltantes: number;
        sobrantes: number;
        sin_sgio: number;
      };
    }>('autoimg_rename_export', body),
    autoimgRenameDestConfig: () => invoke<{ folder_id: string }>('autoimg_rename_dest_config'),
    autoimgArrastreList: (force = false) =>
      invoke<{ entries: Array<{ nis: string; sgio: string; motivo: string; fecha: string; observacion: string }>; cached?: boolean }>('autoimg_arrastre_list', { force }),
    autoimgLogsList: (force = false) =>
      invoke<{ values: string[][]; cached?: boolean }>('autoimg_logs_list', { force }),
    autoimgBootstrap: (refresh = true) => invoke<{
      connected: boolean;
      sheetName?: string;
      sheetId?: string;
      sheetLinked?: boolean;
      lastSync?: string;
      autoSync: boolean;
      totalNis?: number;
      completos?: number;
      faltantes?: number;
      sobrantes?: number;
      sinSgio?: number;
      carpetasActivas?: number;
      folders: Array<{ name: string; folder_id: string; activo: boolean; ultimo_scan: string; cant_archivos: number }>;
      bdRows: string[][];
      logRows: string[][];
      arrastre: Array<{ nis: string; sgio: string; motivo: string; fecha: string; observacion: string }>;
      error?: string;
      error_code?: string;
      stale?: boolean;
      cached?: boolean;
    }>('autoimg_bootstrap', { refresh }),
    autoimgAutoSyncToggle: (enabled: boolean) => invoke<{ enabled: boolean }>('autoimg_auto_sync_toggle', { enabled }),
    autoimgScanAll: () => invoke<{ success: boolean; results?: unknown }>('autoimg_scan_all'),
    autoimgCancelOperation: () => invoke<{ success: boolean; operation?: string; reason?: string }>('autoimg_cancel_operation'),
    autoimgOperationStatus: () =>
      invoke<{ running: boolean; operation?: string; progress?: number; message?: string; started_at?: string }>('autoimg_operation_status'),
    autoimgStatus: () => invoke<{
      connected: boolean;
      sheetName?: string;
      sheetId?: string;
      sheetLinked?: boolean;
      lastSync?: string;
      autoSync: boolean;
      totalNis?: number;
      completos?: number;
      faltantes?: number;
      sobrantes?: number;
      sinSgio?: number;
      carpetasActivas?: number;
    }>('autoimg_status'),
  };
}
