import { useState, useEffect, useCallback, useRef } from 'react';
import Card from '../ui/Card';
import Input from '../ui/Input';
import Toggle from '../ui/Toggle';
import type { RenamePattern, DBRecord, MappingResult, PreviewItem } from '../../types';
import { PencilLine, Tags, Database, ArrowRight, AlertTriangle } from 'lucide-react';
import { fileNameFromPath } from './helpers';

interface RenameCardProps {
  files: string[];
  usarRename: boolean;
  mappingMode?: boolean;
  mappingResult?: MappingResult | null;
  mappingColumns?: string[];
  mappingIdColumn?: string;
  mappingRenameColumn?: string;
  renamePreview?: PreviewItem[];
  /** Backend capped the rename preview batch. */
  previewTruncated?: boolean;
  /** Full file count before preview truncation. */
  previewTotalFiles?: number | null;
  onClearMapping?: () => void;
  namingMode: string;
  onNamingModeChange: (mode: string) => void;
  patron: string;
  onPatronChange: (p: string) => void;
  secuencia: number;
  onSecuenciaChange: (s: number) => void;
  useFilenameSeq: boolean;
  onToggleFilenameSeq: (v: boolean) => void;
  namingPresets: RenamePattern[];
  fields: string[];
  dbColumns?: string[];
  dbRecords?: DBRecord[];
  onInsertVar: (v: string) => void;
  hasVideos?: boolean;
  keyColumn?: string;
  onKeyColumnChange?: (col: string) => void;
  onMappingIdColumnChange?: (col: string) => void;
  onMappingRenameColumnChange?: (col: string) => void;
  wordSeparator?: string;
  onWordSeparatorChange?: (sep: string) => void;
}

const RESERVED_PATTERN_KEYS = new Set(['seq', 'ext', 'sep']);

const getPatternColumns = (pattern: string) => {
  const columns: string[] = [];
  const re = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(pattern)) !== null) {
    const key = match[1];
    if (!RESERVED_PATTERN_KEYS.has(key) && !columns.includes(key)) columns.push(key);
  }
  return columns;
};

const sameArray = (a: string[], b: string[]) => (
  a.length === b.length && a.every((value, index) => value === b[index])
);

const inferSeparator = (pattern: string, fallback: string) => {
  if (pattern.includes('_')) return '_';
  if (pattern.includes('-')) return '-';
  if (pattern.includes(' ')) return ' ';
  return fallback;
};

const patternUsesSep = (pattern: string) => pattern.includes('{sep}');

const cleanupTrailingSeparators = (name: string, sep: string) => {
  if (!sep) return name;
  const escaped = sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return name.replace(new RegExp(`${escaped}+(?=\\.)`), '');
};

const exampleFromPath = (pattern: string, fields: string[], firstFile?: string, sep = '_') => {
  const originalName = firstFile ? fileNameFromPath(firstFile) : '1.jpg';
  const dotIndex = originalName.lastIndexOf('.');
  const ext = dotIndex >= 0 ? originalName.slice(dotIndex) : '.jpg';
  if (!pattern) return originalName;
  const values: Record<string, string> = { seq: '001', ext, sep };
  fields.forEach((field, index) => { values[field] = index === 0 ? '1' : index === 1 ? 'producto' : ''; });
  return cleanupTrailingSeparators(
    pattern.replace(/\{([^}]+)\}/g, (_, key: string) => values[key] ?? ''),
    sep,
  );
};

const exampleFromColumns = (pattern: string, columns: string[], sampleRecord: DBRecord, sep = '_') => {
  const firstCol = columns[0];
  const firstVal = String(sampleRecord[firstCol] || '');
  const dotIndex = firstVal.lastIndexOf('.');
  const ext = dotIndex >= 0 ? firstVal.slice(dotIndex) : '.jpg';
  if (!pattern) return 'archivo.jpg';
  const values: Record<string, string> = { seq: '001', ext, sep };
  columns.forEach((col) => { values[col] = String(sampleRecord[col] || '').substring(0, 20); });
  return cleanupTrailingSeparators(
    pattern.replace(/\{([^}]+)\}/g, (_, key: string) => values[key] ?? ''),
    sep,
  );
};

export default function RenameCard(props: RenameCardProps) {
  const {
    files, usarRename, onNamingModeChange,
    patron, onPatronChange, secuencia, onSecuenciaChange,
    useFilenameSeq, onToggleFilenameSeq, fields,
    dbColumns = [], dbRecords = [],
    onInsertVar,
    hasVideos = false,
    keyColumn = '',
    onKeyColumnChange,
    mappingMode = false,
    mappingResult = null,
    mappingColumns = [],
    mappingIdColumn = '',
    mappingRenameColumn = '',
    renamePreview = [],
    previewTruncated = false,
    previewTotalFiles = null,
    onClearMapping,
    onMappingIdColumnChange,
    onMappingRenameColumnChange,
    wordSeparator = '_',
    onWordSeparatorChange,
  } = props;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAllMappings, setShowAllMappings] = useState(false);
  const [selectedRenameCols, setSelectedRenameCols] = useState<string[]>([]);
  const usesSepPlaceholder = patternUsesSep(patron);
  const hasCatalog = dbColumns.length > 0 && !mappingMode;
  const showSeparatorUi = !mappingMode && (hasCatalog || usesSepPlaceholder);
  const dbSyncRef = useRef<{ dbKey: string; keyColumn: string } | null>(null);

  useEffect(() => {
    if (!usesSepPlaceholder) {
      const inferred = inferSeparator(patron, wordSeparator);
      if (inferred !== wordSeparator) {
        onWordSeparatorChange?.(inferred);
      }
    }

    const available = new Set(dbColumns);
    const nextCols = getPatternColumns(patron).filter((col) => !hasCatalog || available.has(col));
    setSelectedRenameCols((prev) => (sameArray(prev, nextCols) ? prev : nextCols));
  }, [dbColumns, hasCatalog, patron, usesSepPlaceholder, wordSeparator, onWordSeparatorChange]);

  const usesSeq = patron.includes('{seq}');

  const updatePatron = useCallback((cols: string[], sep: string, withSeq: boolean) => {
    let newPatron: string;
    if (cols.length === 0) {
      newPatron = withSeq ? '{seq}{ext}' : '{ext}';
    } else {
      const base = cols.map((c) => `{${c}}`).join(sep);
      newPatron = withSeq ? `${base}${sep}{seq}{ext}` : `${base}{ext}`;
    }
    onPatronChange(newPatron);
  }, [onPatronChange]);

  useEffect(() => {
    if (!hasCatalog || !usarRename || mappingMode) return;

    const dbKey = dbColumns.join('\0');
    const prev = dbSyncRef.current;
    const dbContextChanged = !prev || prev.dbKey !== dbKey || prev.keyColumn !== keyColumn;
    dbSyncRef.current = { dbKey, keyColumn };

    if (!dbContextChanged) return;

    const available = new Set(dbColumns);
    const patternCols = getPatternColumns(patron);
    if (patternCols.length === 0 || patternCols.every((col) => available.has(col))) return;

    const validCols = patternCols.filter((col) => available.has(col));
    const fallbackCols = Array.from(new Set([keyColumn, ...dbColumns].filter(Boolean))).slice(0, 2);
    updatePatron(
      validCols.length > 0 ? validCols : fallbackCols,
      inferSeparator(patron, wordSeparator),
      patron.includes('{seq}'),
    );
  }, [dbColumns, hasCatalog, keyColumn, patron, wordSeparator, updatePatron, usarRename, mappingMode]);

  const previewRows = mappingMode && renamePreview.length > 0
    ? renamePreview
        .filter((row) => row.en_bd)
        .map((row) => ({ actual: row.origen, nuevo: row.nuevo }))
    : Object.entries(mappingResult?.mapping ?? {}).map(([actual, nuevo]) => ({
        actual,
        nuevo,
      }));
  const visibleRows = showAllMappings ? previewRows : previewRows.slice(0, 10);
  const unmatchedCount = mappingResult?.unmatchedFiles.length ?? 0;
  const orphanCount = mappingResult?.orphanEntries.length ?? 0;
  const matchedCount = mappingResult?.matchedFiles ?? 0;
  const collisionCount = mappingResult?.collisions.length ?? 0;

  const toggleCol = (col: string) => {
    const next = selectedRenameCols.includes(col)
      ? selectedRenameCols.filter(c => c !== col)
      : [...selectedRenameCols, col];
    setSelectedRenameCols(next);
    updatePatron(next, wordSeparator, usesSeq);
  };

  const toggleSeq = (enabled: boolean) => {
    updatePatron(selectedRenameCols, wordSeparator, enabled);
  };

  const changeSeparator = (sep: string) => {
    onWordSeparatorChange?.(sep);
    if (!usesSepPlaceholder) {
      updatePatron(selectedRenameCols, sep, usesSeq);
    }
  };

  const namingExample = exampleFromPath(usarRename ? patron : '', fields, files[0], wordSeparator);
  const columnExample = keyColumn && dbRecords.length > 0 && dbColumns.length > 0
    ? exampleFromColumns(patron, dbColumns, dbRecords[0], wordSeparator)
    : namingExample;
  const displayExample = keyColumn ? columnExample : namingExample;

  const variableFields = hasCatalog ? dbColumns : fields;

  return (
    <Card className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-secondary)]/10 text-[var(--accent-secondary)]">
            <Tags className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Renombrado</span>
            <span className="text-sm font-medium text-[var(--text-primary)] truncate block">
              {usarRename ? displayExample : 'Mantener nombres originales'}
            </span>
          </div>
        </div>
        <Toggle checked={usarRename} onChange={(v) => { if (!v) onNamingModeChange('keep'); else onNamingModeChange('custom'); }} />
      </div>

      {usarRename && (
        <div className="space-y-6">
          {previewTruncated && (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--accent-yellow)]/30 bg-[var(--accent-yellow)]/10 px-3 py-2 text-[11px] text-[var(--accent-yellow)]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                Vista previa limitada a {renamePreview.length || 200} archivo
                {(renamePreview.length || 200) === 1 ? '' : 's'}
                {typeof previewTotalFiles === 'number' ? ` de ${previewTotalFiles}` : ''}.
                El renombrado completo al procesar no se ve afectado.
              </span>
            </div>
          )}
          {!mappingMode && !hasCatalog ? (
            <div className="rounded-xl border border-dashed border-[var(--border-medium)] p-6 text-center space-y-3">
              <Database className="h-8 w-8 mx-auto text-[var(--text-muted)] opacity-50" />
              <p className="text-xs text-[var(--text-secondary)]">Importa una base de datos desde la barra superior para renombrar con columnas del catálogo.</p>
            </div>
          ) : mappingMode ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--accent-primary)]/25 bg-[var(--accent-primary)]/5 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ArrowRight className="h-4 w-4 text-[var(--accent-primary)]" />
                    <span className="text-xs font-bold text-[var(--text-primary)]">Mapeo directo activo</span>
                  </div>
                  {onClearMapping && (
                    <button
                      type="button"
                      onClick={onClearMapping}
                      className="text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--accent-red)] transition-colors"
                    >
                      Descartar mapeo
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  {matchedCount} archivo{matchedCount !== 1 ? 's' : ''} coincidirán
                  {' · '}
                  {unmatchedCount} archivo{unmatchedCount !== 1 ? 's' : ''} sin mapeo
                  {' · '}
                  {orphanCount} entrada{orphanCount !== 1 ? 's' : ''} huérfana{orphanCount !== 1 ? 's' : ''}
                  {collisionCount > 0 && (
                    <>
                      {' · '}
                      {collisionCount} colisión{collisionCount !== 1 ? 'es' : ''}
                    </>
                  )}
                </p>
                {mappingColumns.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] text-[var(--text-muted)]">Columnas del Excel:</p>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={mappingIdColumn}
                        onChange={(e) => onMappingIdColumnChange?.(e.target.value)}
                        className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                      >
                        <option value="">Columna ID...</option>
                        {mappingColumns.map((col) => (
                          <option key={col} value={col}>{col}</option>
                        ))}
                      </select>
                      <select
                        value={mappingRenameColumn}
                        onChange={(e) => onMappingRenameColumnChange?.(e.target.value)}
                        className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                      >
                        <option value="">Nuevo nombre...</option>
                        {mappingColumns.map((col) => (
                          <option key={col} value={col}>{col}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                {(unmatchedCount > 0 || orphanCount > 0) && (
                  <div className="flex items-center gap-2 rounded-lg border border-[var(--accent-yellow)]/30 bg-[var(--accent-yellow)]/10 px-3 py-2 text-[11px] text-[var(--accent-yellow)]">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>Revisa los archivos sin mapeo o las filas del Excel sin archivo correspondiente.</span>
                  </div>
                )}
                {collisionCount > 0 && (
                  <div className="rounded-lg border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 px-3 py-2 text-[11px] text-[var(--accent-red)] space-y-1">
                    <div className="flex items-center gap-2 font-medium">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>Varios archivos quedarían con el mismo nombre de salida.</span>
                    </div>
                    {mappingResult?.collisions.slice(0, 3).map((collision) => (
                      <p key={collision.output} className="font-mono pl-5">
                        {collision.output} ← {collision.sources.join(', ')}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {previewRows.length > 0 && (
                <div className="rounded-xl border border-[var(--border-subtle)] overflow-hidden">
                  <div className="grid grid-cols-[1fr_auto_1fr] gap-2 px-3 py-2 bg-[var(--bg-elevated)] text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    <span>Actual</span>
                    <span>→</span>
                    <span>Nuevo nombre</span>
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-[var(--border-subtle)]">
                    {visibleRows.map((row) => (
                      <div key={row.actual} className="grid grid-cols-[1fr_auto_1fr] gap-2 px-3 py-2 text-xs">
                        <span className="truncate font-mono text-[var(--text-secondary)]">{row.actual}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)] self-center" />
                        <span className="truncate font-mono text-[var(--text-primary)]">{row.nuevo}</span>
                      </div>
                    ))}
                  </div>
                  {previewRows.length > 10 && (
                    <button
                      type="button"
                      onClick={() => setShowAllMappings((prev) => !prev)}
                      className="w-full px-3 py-2 text-[11px] font-medium text-[var(--accent-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
                    >
                      {showAllMappings ? 'Ver menos' : `Ver todas (${previewRows.length})`}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Paso 1: Columna ID */}
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--text-on-accent)] text-[10px] font-bold">1</div>
                  <label className="text-xs font-bold text-[var(--text-primary)]">¿Qué columna identifica a tus archivos?</label>
                </div>
                <div className="grid grid-cols-1 gap-2">
                   <select
                    value={keyColumn}
                    onChange={(e) => onKeyColumnChange?.(e.target.value)}
                    className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none transition-colors"
                  >
                    <option value="">Selecciona la columna ID...</option>
                    {dbColumns.map((col) => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] px-1">
                  {keyColumn 
                    ? `Buscaremos el nombre del archivo en la columna "${keyColumn}"`
                    : "El nombre actual del archivo debe estar en esta columna del Excel."}
                </p>
              </div>

              {/* Pasos 2 y 3: Columna renombre + Secuencia */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--text-on-accent)] text-[10px] font-bold">2</div>
                    <label className="text-xs font-bold text-[var(--text-primary)]">Columna renombre</label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {dbColumns.map((col) => {
                      const active = selectedRenameCols.includes(col);
                      return (
                        <button
                          type="button"
                          key={col}
                          onClick={() => toggleCol(col)}
                          className={`px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                            active
                              ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)] border-[var(--accent-primary)] shadow-sm'
                              : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-medium)]'
                          }`}
                        >
                          {col}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--text-on-accent)] text-[10px] font-bold">3</div>
                    <label className="text-xs font-bold text-[var(--text-primary)]">Secuencia</label>
                  </div>
                  <div className="space-y-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-[var(--text-secondary)]">Incluir número</span>
                      <Toggle checked={usesSeq} onChange={toggleSeq} />
                    </div>
                    {usesSeq && (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <span className="block text-[11px] text-[var(--text-secondary)]">Por fila de BD</span>
                            {useFilenameSeq && (
                              <span className="block text-[10px] text-[var(--text-muted)]">Cada fila comienza en 001</span>
                            )}
                          </div>
                          <Toggle checked={useFilenameSeq} onChange={onToggleFilenameSeq} />
                        </div>
                        {!useFilenameSeq && (
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-[var(--text-muted)]">Inicial</span>
                            <Input
                              type="number"
                              min={1}
                              max={9999}
                              value={secuencia}
                              onChange={(e) => onSecuenciaChange(parseInt(e.target.value, 10) || 1)}
                              className="w-20 text-center"
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Paso 4: Separador */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--text-on-accent)] text-[10px] font-bold">4</div>
                  <label className="text-xs font-bold text-[var(--text-primary)]">Separador</label>
                </div>
                <div className="flex gap-2">
                  {[
                    { id: '_', label: 'Guion bajo (_)' },
                    { id: '-', label: 'Guion medio (-)' },
                    { id: ' ', label: 'Espacio ( )' },
                    { id: '', label: 'Pegado' },
                  ].map((sep) => (
                    <button
                      type="button"
                      key={sep.id || 'none'}
                      onClick={() => changeSeparator(sep.id)}
                      className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-all ${
                        wordSeparator === sep.id
                          ? 'bg-[var(--accent-secondary)]/20 text-[var(--accent-secondary)] border-[var(--accent-secondary)]/40'
                          : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-medium)]'
                      }`}
                    >
                      {sep.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition-colors"
            >
              <PencilLine className="h-3.5 w-3.5" />
              {showAdvanced ? 'Ocultar editor avanzado' : 'Editor avanzado (expertos)'}
            </button>
          </div>

          {showAdvanced && (
            <div className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/30 p-4 animate-fade-in">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Patrón personalizado</label>
                <Input
                  value={patron}
                  onChange={(e) => onPatronChange(e.target.value)}
                  placeholder="{codigo}{sep}{nombre}{ext}"
                  className="font-mono text-sm"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {['seq', 'ext', 'sep', ...variableFields].map(f => (
                  <button
                    type="button"
                    key={f}
                    onClick={() => onInsertVar(`{${f}}`)}
                    className="px-2 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[10px] font-mono"
                  >
                    {`{${f}}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showSeparatorUi && !hasCatalog && (
            <div className="space-y-3">
              <label className="text-xs font-bold text-[var(--text-primary)]">Separador</label>
              <div className="flex gap-2">
                {[
                  { id: '_', label: 'Guion bajo (_)' },
                  { id: '-', label: 'Guion medio (-)' },
                  { id: ' ', label: 'Espacio ( )' },
                  { id: '', label: 'Pegado' },
                ].map((sep) => (
                  <button
                    type="button"
                    key={sep.id || 'none'}
                    onClick={() => changeSeparator(sep.id)}
                    className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-all ${
                      wordSeparator === sep.id
                        ? 'bg-[var(--accent-secondary)]/20 text-[var(--accent-secondary)] border-[var(--accent-secondary)]/40'
                        : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-medium)]'
                    }`}
                  >
                    {sep.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {hasVideos && (
        <div className="rounded-lg border border-[var(--accent-blue)]/25 bg-[var(--accent-blue)]/10 px-3 py-2">
          <p className="text-[11px] font-medium text-[var(--accent-blue)] text-center">💡 Los videos conservan su extensión original</p>
        </div>
      )}
    </Card>
  );
}
