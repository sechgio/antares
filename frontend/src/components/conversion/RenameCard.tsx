import { useState } from 'react';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Input from '../ui/Input';
import Toggle from '../ui/Toggle';
import type { RenamePattern, PreviewItem } from '../../types';
import { ChevronRight, PencilLine, Tags } from 'lucide-react';

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

export default function RenameCard({
  files, usarRename, namingMode, onNamingModeChange,
  patron, onPatronChange, secuencia, onSecuenciaChange,
  useFilenameSeq, onToggleFilenameSeq, namingPresets, preview, fields, onInsertVar,
  hasVideos = false,
}: RenameCardProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const namingExample = exampleFromPattern(usarRename ? patron : '', fields, files[0]);
  const usesSeq = patron.includes('{seq}');
  const previewRows = preview?.slice(0, 4) || [];
  const hiddenPreviewCount = preview ? Math.max(0, preview.length - previewRows.length) : 0;

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-secondary)]/10 text-[var(--accent-secondary)]">
            <Tags className="h-4 w-4" />
          </div>
          <div>
            <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Renombrado</span>
            <span className="text-xs text-[var(--text-secondary)] truncate block max-w-[220px]">{namingExample}</span>
          </div>
        </div>
      </div>

      {hasVideos && (
        <div className="rounded-lg border border-[var(--accent-blue)]/25 bg-[var(--accent-blue)]/10 px-3 py-2">
          <p className="text-xs leading-relaxed text-[var(--accent-blue)]">Videos: conserva extensión original.</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {namingPresets.map((preset) => {
          const active = namingMode === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => onNamingModeChange(preset.id)}
              className={`min-h-[66px] rounded-lg border px-3 py-2.5 text-left transition-all duration-200 ${
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

      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--accent-primary)] transition-colors hover:text-[var(--accent-primary-hover)]"
        >
          <PencilLine className="h-3.5 w-3.5" />
          {showAdvanced ? 'Ocultar patrón avanzado' : 'Editar patrón avanzado'}
        </button>
      </div>

      {showAdvanced && (
        <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 p-3">
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

      {files.length > 0 && usarRename && preview && (
        <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Vista previa</span>
            <span className="text-[10px] text-[var(--text-muted)]">{preview.length} archivos</span>
          </div>
          <div>
            {previewRows.map((p, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 px-3 py-2 text-sm ${i % 2 === 0 ? 'bg-[var(--bg-base)]' : 'bg-transparent'}`}
              >
                <span className="flex-1 truncate font-mono text-[11px] text-[var(--text-muted)]">{p.origen}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--border-medium)]" />
                <span className="flex-1 truncate font-mono text-[12px] text-[var(--text-primary)] font-medium">{p.nuevo}</span>
                <Badge variant={p.en_bd ? 'success' : 'warning'} className="shrink-0 text-[10px]">
                  {p.en_bd ? 'BD' : 'Sin BD'}
                </Badge>
              </div>
            ))}
            {hiddenPreviewCount > 0 && (
              <div className="border-t border-[var(--border-subtle)] px-3 py-2 text-center text-[11px] text-[var(--text-muted)]">
                +{hiddenPreviewCount} archivos más
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
