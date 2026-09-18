import type { DBField, DBRecord, MappingResult, RenamePattern, ThemeConfig } from '../types';
import {
  _invoke,
  _invokeInvalidating,
  cachedInvoke,
  invalidateApiCache,
  invalidateDatabaseCaches,
} from './core';

export const catalogApi = {
  importExcel: (path: string) =>
    _invokeInvalidating<{ imported: number; inserted?: number; skipped?: number }>('db_import', invalidateDatabaseCaches, { path }),
  dbExport: (path: string) => _invoke<{ exported: number }>('db_export', { path }),
  dbTemplate: (path: string) => _invoke<{ path: string }>('db_template', { path }),
  clearDatabase: () =>
    _invokeInvalidating<{ cleared: number }>('db_clear', () => invalidateApiCache('db_columns')),

  getFields: () => cachedInvoke('db_fields', () => _invoke<{ fields: DBField[] }>('db_fields')),
  updateFields: (fields: DBField[]) =>
    _invokeInvalidating<{ fields: DBField[] }>('db_fields_update', invalidateDatabaseCaches, { fields }),
  resetFields: () =>
    _invokeInvalidating<{ fields: DBField[] }>('db_fields_reset', invalidateDatabaseCaches),

  getDbColumns: () => cachedInvoke('db_columns', () => _invoke<{ columns: string[]; records: DBRecord[]; total: number }>('db_columns')),
  dbParseMapping: (path: string, files?: string[], id_column?: string, rename_column?: string) =>
    _invoke<MappingResult>('db_parse_mapping', { path, files: files ?? [], id_column, rename_column }),
  dbValidateMapping: (mapping: Record<string, string>, files: string[]) =>
    _invoke<{ valid: boolean; mapped_count: number; unmapped_files: string[]; missing_keys: string[] }>('db_validate_mapping', { mapping, files }),

  getRenamePatterns: () => cachedInvoke('rename_patterns_get', () => _invoke<{ patterns: RenamePattern[] }>('rename_patterns_get')),
  updateRenamePatterns: (patterns: RenamePattern[]) =>
    _invokeInvalidating<{ patterns: RenamePattern[] }>('rename_patterns_update', () => invalidateApiCache('rename_patterns_get'), { patterns }),
  resetRenamePatterns: () =>
    _invokeInvalidating<{ patterns: RenamePattern[] }>('rename_patterns_reset', () => invalidateApiCache('rename_patterns_get')),

  getTheme: () => cachedInvoke('theme_get', () => _invoke<ThemeConfig>('theme_get')),
  saveTheme: (theme: ThemeConfig) => {
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(theme)) {
      if (typeof v === 'string') safe[k] = v;
    }
    return _invokeInvalidating<ThemeConfig>('theme_save', () => invalidateApiCache('theme_get'), safe);
  },
  getPresets: () => _invoke<{ presets: string[] }>('theme_presets'),
  applyPreset: (name: string) =>
    _invokeInvalidating<ThemeConfig>('theme_preset', () => invalidateApiCache('theme_get'), { name }),
  resetTheme: () =>
    _invokeInvalidating<ThemeConfig>('theme_reset', () => invalidateApiCache('theme_get')),
};
