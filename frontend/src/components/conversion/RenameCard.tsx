import { useState, useEffect } from 'react';
import Card from '../ui/Card';
import Input from '../ui/Input';
import Toggle from '../ui/Toggle';
import type { RenamePattern, DBRecord } from '../../types';
import { PencilLine, Tags, Database } from 'lucide-react';

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

export default function RenameCard(props: RenameCardProps) {
  const {
    files, usarRename, onNamingModeChange,
    patron, onPatronChange, fields,
    dbColumns = [], dbRecords = [],
    onInsertVar,
    hasVideos = false,
    keyColumn = '',
    onKeyColumnChange,
  } = props;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedRenameCols, setSelectedRenameCols] = useState<string[]>([]);
  const [separator, setSeparator] = useState('_');

  // Inicializar estado desde el patrón al montar el componente
  useEffect(() => {
    const matches = patron.match(/\{([^}]+)\}/g);
    if (matches) {
      const cols = matches.map(m => m.replace(/[\{\}]/g, '')).filter(c => c !== 'seq' && c !== 'ext');
      setSelectedRenameCols(cols);
    }
    // Intentar adivinar el separador
    if (patron.includes('_')) setSeparator('_');
    else if (patron.includes('-')) setSeparator('-');
    else if (patron.includes(' ')) setSeparator(' ');
  }, []);

  const updatePatron = (cols: string[], sep: string) => {
    const newPatron = cols.map(c => `{${c}}`).join(sep) + '{ext}';
    onPatronChange(newPatron);
  };

  const toggleCol = (col: string) => {
    const next = selectedRenameCols.includes(col)
      ? selectedRenameCols.filter(c => c !== col)
      : [...selectedRenameCols, col];
    setSelectedRenameCols(next);
    updatePatron(next, separator);
  };

  const changeSeparator = (sep: string) => {
    setSeparator(sep);
    updatePatron(selectedRenameCols, sep);
  };

  const namingExample = exampleFromPath(usarRename ? patron : '', fields, files[0]);
  const columnExample = keyColumn && dbRecords.length > 0 && dbColumns.length > 0
    ? exampleFromColumns(patron, dbColumns, dbRecords[0])
    : namingExample;
  const displayExample = keyColumn ? columnExample : namingExample;

  const hasExcel = dbColumns.length > 0;

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
        <div className="space-y-6 animate-fade-in">
          {!hasExcel ? (
            <div className="rounded-xl border border-dashed border-[var(--border-medium)] p-6 text-center space-y-3">
              <Database className="h-8 w-8 mx-auto text-[var(--text-muted)] opacity-50" />
              <p className="text-xs text-[var(--text-secondary)]">Carga un Excel para renombrar por columnas fácilmente.</p>
            </div>
          ) : (
            <>
              {/* Paso 1: Columna ID */}
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-primary)] text-white text-[10px] font-bold">1</div>
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

              {/* Paso 2: Columnas para renombrar */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-primary)] text-white text-[10px] font-bold">2</div>
                  <label className="text-xs font-bold text-[var(--text-primary)]">¿Qué columnas quieres en el nuevo nombre?</label>
                </div>
                <div className="flex flex-wrap gap-2">
                  {dbColumns.map((col) => {
                    const active = selectedRenameCols.includes(col);
                    return (
                      <button
                        key={col}
                        onClick={() => toggleCol(col)}
                        className={`px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                          active
                            ? 'bg-[var(--accent-primary)] text-white border-[var(--accent-primary)] shadow-sm'
                            : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-medium)]'
                        }`}
                      >
                        {col}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Paso 3: Separador */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-primary)] text-white text-[10px] font-bold">3</div>
                  <label className="text-xs font-bold text-[var(--text-primary)]">¿Cómo quieres separar las palabras?</label>
                </div>
                <div className="flex gap-2">
                  {[
                    { id: '_', label: 'Guion bajo (_)' },
                    { id: '-', label: 'Guion medio (-)' },
                    { id: ' ', label: 'Espacio ( )' },
                    { id: '', label: 'Pegado' },
                  ].map((sep) => (
                    <button
                      key={sep.id}
                      onClick={() => changeSeparator(sep.id)}
                      className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-all ${
                        separator === sep.id
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
                  placeholder="{codigo}_{nombre}{ext}"
                  className="font-mono text-sm"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {['seq', 'ext', ...fields].map(f => (
                  <button
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
