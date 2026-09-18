import type { HistoryRunRow } from '../components/history/runTypes';
import { _invoke } from './core';

export const historyApi = {
  historyList: (body?: { limit?: number; offset?: number; run_type?: string; date_from?: string; date_to?: string }) => _invoke<{ runs: HistoryRunRow[] }>('history_list', body),
  historyGet: (id: number) => _invoke<{ run: HistoryRunRow }>('history_get', { id }),
  historyDelete: (id: number) => _invoke<{ deleted_id: number | null }>('history_delete', { id }),
  historyDeleteMany: (ids: number[]) => _invoke<{ deleted_count: number; requested: number }>('history_delete_many', { ids }),
  historySave: (body: {
    files: string[];
    options: Record<string, unknown>;
    patron?: string;
    formato?: string;
    calidad?: number;
    resize?: string | null;
    ok_count?: number;
    err_count?: number;
    run_type: string;
    duration_ms?: number;
  }) => _invoke<{ id: number }>('history_save', body),
  historyExport: (body?: { ids?: number[]; limit?: number; run_type?: string }) => _invoke<{ csv: string; count: number; filename: string }>('history_export', body),
};
