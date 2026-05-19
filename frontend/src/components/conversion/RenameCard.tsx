import { useState } from 'react';
import Card from '../ui/Card';
import Input from '../ui/Input';
import Toggle from '../ui/Toggle';
import type { RenamePattern, DBRecord } from '../../types';
import { PencilLine, Tags, LayoutGrid, Database, Hash, FileType, GripHorizontal, Table } from 'lucide-react';

interface RenameCardProps {
  files: string[];
  usarRename: boolean;
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
  useColumnRename?: boolean;
  onToggleColumnRename?: (v: boolean) => void;
  onInsertVar: (v: string) => void;
  hasVideos?: boolean;
  keyColumn?: string;
  onKeyColumnChange?: (col: string) => void;
}

const fileNameFromPath = (path: string) => path.split(/[\\/]/).pop() || path;

const exampleFromPath = (pattern: string, fields: string[], firstFile?: string) => {
  const originalName = firstFile ? fileNameFromPath(firstFile) : '1.jpg';
  const dotIndex = originalName.lastIndexOf('.');
  const ext = dotIndex >= 0 ? originalName.slice(dotIndex) : '.jpg';
  if (!pattern) return originalName;
  const values: Record<string, string> = { seq: '001', ext };
  fields.forEach((field, index) => { values[field] = index === 0 ? '1' : index === 1 ? 'producto' : ''; });
  return pattern.replace(/\{([^}]+)\}/g, (_, key: string) => values[key] ?? '').replace(/_+(?=\.)/g, '');
};

const exampleFromColumns = (pattern: string, columns: string[], sampleRecord: DBRecord) => {
  const firstCol = columns[0];
  const firstVal = String(sampleRecord[firstCol] || '');
  const dotIndex = firstVal.lastIndexOf('.');
  const ext = dotIndex >= 0 ? firstVal.slice(dotIndex) : '.jpg';
  if (!pattern) return 'archivo.jpg';
  const values: Record<string, string> = { seq: '001', ext };
  columns.forEach((col) => { values[col] = String(sampleRecord[col] || '').substring(0, 20); });
  return pattern.replace(/\{([^}]+)\}/g, (_, key: string) => values[key] ?? '').replace(/_+(?=\.)/g, '');
};

export default function RenameCard({
  files, usarRename, namingMode, onNamingModeChange,
  patron, onPatronChange, secuencia, onSecuenciaChange,
  useFilenameSeq, onToggleFilenameSeq, namingPresets, fields,
  dbColumns = [], dbRecords = [], useColumnRename = false, onToggleColumnRename,
  onInsertVar,
  hasVideos = false,
  keyColumn = '',
  onKeyColumnChange,
}: RenameCardProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showManager, setShowManager] = useState(false);

  const namingExample = exampleFromPath(usarRename ? patron : '', fields, files[0]);
  const columnExample = useColumnRename && dbRecords.length > 0 && dbColumns.length > 0
    ? exampleFromColumns(patron, dbColumns, dbRecords[0])
    : namingExample;
  const usesSeq = patron.includes('{seq}');
  const displayExample = useColumnRename ? columnExample : namingExample;

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-secondary)]/10 text-[var(--accent-secondary)]">
            <Tags className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Renombrado</span>
            <span className="text-xs text-[var(--text-secondary)] truncate block max-w-[200px]">
              {usarRename ? displayExample : 'Mantener nombres originales'}
            </span>
          </div>
        </div>
      </div>

      {hasVideos && (
        <div className="rounded-lg border border-[var(--accent-blue)]/25 bg-[var(--accent-blue)]/10 px-3 py-2">
          <p className="text-[11px] font-medium text-[var(--accent-blue)]">Videos: conserva extensión original</p>
        </div>
      )}

      {dbColumns.length > 0 && onToggleColumnRename && (
        <div className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-secondary)]/10 text-[var(--accent-secondary)]">
              <Table className="h-4 w-4" />
            </div>
            <div>
              <span className="block text-xs font-semibold text-[var(--text-primary)]">Renombrado por columnas</span>
              <span className="text-[11px] text-[var(--text-muted)]">{dbRecords.length} registros · {dbColumns.length} columnas</span>
            </div>
          </div>
          <Toggle checked={useColumnRename} onChange={onToggleColumnRename} />
        </div>
      )}

      {dbColumns.length > 0 && onKeyColumnChange && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]">
              <Database className="h-4 w-4" />
            </div>
            <div>
              <span className="block text-xs font-semibold text-[var(--text-primary)]">Buscar código en columna</span>
              <span className="text-[11px] text-[var(--text-muted)]">Coincidencia exacta con valor de celda</span>
            </div>
          </div>
          <select
            value={keyColumn}
            onChange={(e) => onKeyColumnChange(e.target.value)}
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
          >
            <option value="">Sin búsqueda por columna</option>
            {dbColumns.map((col) => (
              <option key={col} value={col}>{col}</option>
            ))}
          </select>
          {keyColumn && (
            <p className="text-[11px] text-[var(--accent-primary)]">
              Los archivos se renombran según la fila donde <strong>{keyColumn}</strong> coincida con el código extraído del nombre. Si no hay coincidencia, se mantiene el nombre original.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {namingPresets.map((preset) => {
          const active = namingMode === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => onNamingModeChange(preset.id)}
              className={`min-h-[48px] rounded-xl border px-3 py-2 text-left transition-all duration-200 ${
                active
                  ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border-[var(--accent-primary)]/40 shadow-[0_0_0_3px_var(--accent-primary-glow)]'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span className="block text-xs font-semibold leading-4">{preset.label}</span>
              <span className={`block mt-0.5 font-mono text-[10px] leading-3 truncate ${active ? 'text-[var(--accent-primary)]/80' : 'text-[var(--text-muted)]'}`}>
                {useColumnRename && dbRecords.length > 0
                  ? exampleFromColumns(preset.pattern, dbColumns, dbRecords[0])
                  : exampleFromPath(preset.pattern, fields, files[0])}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className={`flex items-center gap-1.5 text-[13px] font-medium transition-colors px-3 py-1.5 rounded-lg ${
            showAdvanced ? 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/10' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
          }`}
        >
          <PencilLine className="h-3.5 w-3.5" />
          {showAdvanced ? 'Ocultar editor' : 'Editor avanzado'}
        </button>
        <button
          onClick={() => setShowManager(!showManager)}
          className={`flex items-center gap-1.5 text-[13px] font-medium transition-colors px-3 py-1.5 rounded-lg ${
            showManager ? 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/10' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
          }`}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          {showManager ? 'Ocultar patrones' : 'Gestionar patrones'}
        </button>
      </div>

      {showAdvanced && (
        <div className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 p-4 animate-fade-in">
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              {useColumnRename ? 'Columnas de la base de datos' : 'Patrón visual'}
            </label>
            <div className="flex flex-wrap gap-2">
              {(useColumnRename ? dbColumns : fields).map((f) => (
                <button
                  key={f}
                  onClick={() => onInsertVar(`{${f}}`)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] text-xs font-mono border border-[var(--border-subtle)] hover:bg-[var(--accent-primary)] hover:text-white hover:border-[var(--accent-primary)] transition-all shadow-sm"
                  title={`Insertar {${f}}`}
                >
                  <Database className="h-3 w-3 opacity-60" />
                  {`{${f}}`}
                </button>
              ))}
              <button
                onClick={() => onInsertVar('{seq}')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] text-xs font-mono border border-[var(--accent-primary)]/30 hover:bg-[var(--accent-primary)] hover:text-white transition-all"
                title="Insertar secuencia numérica"
              >
                <Hash className="h-3 w-3" />
                {'{seq}'}
              </button>
              <button
                onClick={() => onInsertVar('{ext}')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] text-xs font-mono border border-[var(--accent-blue)]/30 hover:bg-[var(--accent-blue)] hover:text-white transition-all"
                title="Insertar extensión"
              >
                <FileType className="h-3 w-3" />
                {'{ext}'}
              </button>
              <button
                onClick={() => onInsertVar('_')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-input)] text-[var(--text-muted)] text-xs font-mono border border-[var(--border-subtle)] hover:bg-[var(--border-medium)] hover:text-[var(--text-primary)] transition-all"
                title="Insertar guión bajo"
              >
                <GripHorizontal className="h-3 w-3" />
                _
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Patrón actual</label>
            <Input
              value={patron}
              onChange={(e) => onPatronChange(e.target.value)}
              placeholder="{codigo}_{nombre}{ext}"
              className="font-mono text-sm"
            />
            <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
              <span>Resultado:</span>
              <span className="font-mono text-[var(--text-primary)] bg-[var(--bg-input)] px-2 py-0.5 rounded">{displayExample}</span>
            </div>
          </div>

          {usesSeq && (
            <div className="flex items-center gap-4 pt-3 border-t border-[var(--border-subtle)]">
              <div className="flex items-center gap-3">
                <Toggle checked={useFilenameSeq} onChange={onToggleFilenameSeq} />
                <div className="flex flex-col">
                  <span className="text-sm text-[var(--text-primary)]">Usar número del archivo original</span>
                  <span className="text-[11px] text-[var(--text-muted)]">Extrae la secuencia del nombre actual</span>
                </div>
              </div>
              {!useFilenameSeq && (
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-[11px] text-[var(--text-muted)]">Iniciar en</span>
                  <Input
                    type="number"
                    min={1}
                    max={9999}
                    value={secuencia}
                    onChange={(e) => onSecuenciaChange(parseInt(e.target.value) || 1)}
                    className="w-20 text-center"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showManager && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 overflow-hidden animate-fade-in">
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Patrones disponibles</span>
            <span className="text-[11px] text-[var(--text-muted)]">{namingPresets.length} total</span>
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {namingPresets.map((preset) => {
              const active = namingMode === preset.id;
              return (
                <button
                  key={preset.id}
                  onClick={() => onNamingModeChange(preset.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                    active ? 'bg-[var(--accent-primary)]/5' : 'hover:bg-[var(--bg-surface)]'
                  }`}
                >
                  <div className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${
                    active ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]' : 'border-[var(--border-medium)]'
                  }`}>
                    {active && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`block text-sm font-medium ${active ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'}`}>
                      {preset.label}
                    </span>
                    <span className="block text-[11px] font-mono text-[var(--text-muted)] truncate">{preset.pattern || 'Sin cambios'}</span>
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono">
                    {useColumnRename && dbRecords.length > 0
                      ? exampleFromColumns(preset.pattern, dbColumns, dbRecords[0])
                      : exampleFromPath(preset.pattern, fields, files[0])}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
