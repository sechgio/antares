import { useState } from 'react';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Input from '../ui/Input';
import Toggle from '../ui/Toggle';
import type { RenamePattern, PreviewItem } from '../../types';

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
  preview: PreviewItem[] | null;
  fields: string[];
  onInsertVar: (v: string) => void;
  hasVideos?: boolean;
}

const fileNameFromPath = (path: string) => path.split(/[\\/]/).pop() || path;

const exampleFromPattern = (pattern: string, fields: string[], firstFile?: string) => {
  const originalName = firstFile ? fileNameFromPath(firstFile) : '1.jpg';
  const dotIndex = originalName.lastIndexOf('.');
  const ext = dotIndex >= 0 ? originalName.slice(dotIndex) : '.jpg';
  if (!pattern) return originalName;
  const values: Record<string, string> = { seq: '001', ext };
  fields.forEach((field, index) => { values[field] = index === 0 ? '1' : index === 1 ? 'producto' : ''; });
  return pattern.replace(/\{([^}]+)\}/g, (_, key: string) => values[key] ?? '').replace(/_+(?=\.)/g, '');
};

function TagIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

export default function RenameCard({
  files, usarRename, namingMode, onNamingModeChange,
  patron, onPatronChange, secuencia, onSecuenciaChange,
  useFilenameSeq, onToggleFilenameSeq, namingPresets, preview, fields, onInsertVar,
  hasVideos = false,
}: RenameCardProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const namingExample = exampleFromPattern(usarRename ? patron : '', fields, files[0]);
  const usesSeq = patron.includes('{seq}');

  return (
    <Card className="space-y-5">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-1 h-4 rounded-full bg-[var(--accent-secondary)]" />
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Nombres de salida</span>
      </div>

      {hasVideos && (
        <div className="p-3 bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/25 rounded-xl">
          <p className="text-xs text-[var(--accent-blue)] leading-relaxed">
            Los videos mantendrán su extensión original al renombrarse.
          </p>
        </div>
      )}

      {/* Presets */}
      <div className="grid grid-cols-2 gap-2">
        {namingPresets.map((preset) => {
          const active = namingMode === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => onNamingModeChange(preset.id)}
              className={`text-left px-3.5 py-3 rounded-xl border transition-all duration-200 ${
                active
                  ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] border-[var(--accent-primary)]/40'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span className="block text-[13px] font-semibold">{preset.label}</span>
              <span className={`block mt-1 font-mono text-[11px] truncate ${active ? 'text-[var(--accent-primary)]/80' : 'text-[var(--text-muted)]'}`}>
                {exampleFromPattern(preset.pattern, fields, files[0])}
              </span>
            </button>
          );
        })}
      </div>

      {/* Advanced toggle */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-[13px] text-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)] font-medium flex items-center gap-1.5 transition-colors"
        >
          <TagIcon className="w-3.5 h-3.5" />
          {showAdvanced ? 'Ocultar patrón avanzado' : 'Editar patrón avanzado'}
        </button>
        <span className="text-xs text-[var(--text-muted)]">
          Ej: <span className="font-mono text-[var(--text-primary)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded">{namingExample}</span>
        </span>
      </div>

      {showAdvanced && (
        <div className="space-y-4 p-4 bg-[var(--bg-elevated)]/50 rounded-xl border border-[var(--border-subtle)]">
          <Input
            value={patron}
            onChange={(e) => onPatronChange(e.target.value)}
            placeholder="{codigo}_{nombre}{ext}"
            className="font-mono text-sm"
          />
          <div className="flex flex-wrap gap-2">
            {fields.map((f) => (
              <button key={f} onClick={() => onInsertVar(`{${f}}`)} className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] text-xs font-mono border border-[var(--border-subtle)] hover:bg-[var(--accent-primary)] hover:text-white hover:border-[var(--accent-primary)] transition-all">
                {`{${f}}`}
              </button>
            ))}
            <button onClick={() => onInsertVar('{seq}')} className="px-3 py-1.5 rounded-lg bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] text-xs font-mono border border-[var(--accent-primary)]/30 hover:bg-[var(--accent-primary)] hover:text-white transition-all">{'{seq}'}</button>
            <button onClick={() => onInsertVar('{ext}')} className="px-3 py-1.5 rounded-lg bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] text-xs font-mono border border-[var(--accent-blue)]/30 hover:bg-[var(--accent-blue)] hover:text-white transition-all">{'{ext}'}</button>
          </div>

          {usesSeq && (
            <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-subtle)]">
              <Toggle checked={useFilenameSeq} onChange={onToggleFilenameSeq} />
              <div className="flex flex-col">
                <span className="text-sm text-[var(--text-primary)]">Usar número del archivo original</span>
                <span className="text-[11px] text-[var(--text-muted)]">Extrae la secuencia del nombre actual</span>
              </div>
              {!useFilenameSeq && (
                <Input
                  type="number"
                  min={1}
                  max={9999}
                  value={secuencia}
                  onChange={(e) => onSecuenciaChange(parseInt(e.target.value) || 1)}
                  className="w-24 text-center ml-auto"
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Preview list */}
      {files.length > 0 && usarRename && preview && (
        <div className="border border-[var(--border-subtle)] rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Vista previa</span>
            <span className="text-[10px] text-[var(--text-muted)]">{preview.length} archivos</span>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {preview.map((p, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 px-3 py-2 text-sm ${i % 2 === 0 ? 'bg-[var(--bg-base)]' : 'bg-transparent'}`}
              >
                <span className="flex-1 truncate font-mono text-[11px] text-[var(--text-muted)]">{p.origen}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--border-medium)] shrink-0">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span className="flex-1 truncate font-mono text-[12px] text-[var(--text-primary)] font-medium">{p.nuevo}</span>
                <Badge variant={p.en_bd ? 'success' : 'warning'} className="shrink-0 text-[10px]">
                  {p.en_bd ? 'BD' : 'Sin BD'}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
