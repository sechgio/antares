import { useState } from 'react';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Input from '../ui/Input';
import Toggle from '../ui/Toggle';
import type { RenamePattern, PreviewItem } from '../../types';
import { ChevronRight, PencilLine, Tags, LayoutGrid, List, Database, Hash, FileType, GripHorizontal } from 'lucide-react';

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
  const [showManager, setShowManager] = useState(false);
  const [previewMode, setPreviewMode] = useState<'compact' | 'full'>('compact');

  const namingExample = exampleFromPattern(usarRename ? patron : '', fields, files[0]);
  const usesSeq = patron.includes('{seq}');
  const previewRows = preview?.slice(0, previewMode === 'compact' ? 3 : 8) || [];
  const hiddenPreviewCount = preview ? Math.max(0, preview.length - previewRows.length) : 0;
  const dbMatchedCount = preview?.filter((item) => item.en_bd).length ?? 0;

  return (
    <Card className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-secondary)]/10 text-[var(--accent-secondary)]">
            <Tags className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Renombrado</span>
            <span className="text-xs text-[var(--text-secondary)] truncate block max-w-[200px]">
              {usarRename ? namingExample : 'Mantener nombres originales'}
            </span>
          </div>
        </div>
        {files.length > 0 && usarRename && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Database className="h-3 w-3 text-[var(--text-muted)]" />
            <span className={`text-[11px] font-bold ${dbMatchedCount === files.length ? 'text-[var(--accent-green)]' : 'text-[var(--accent-yellow)]'}`}>
              {dbMatchedCount}/{files.length}
            </span>
          </div>
        )}
      </div>

      {hasVideos && (
        <div className="rounded-lg border border-[var(--accent-blue)]/25 bg-[var(--accent-blue)]/10 px-3 py-2">
          <p className="text-[11px] font-medium text-[var(--accent-blue)]">Videos: conserva extensión original</p>
        </div>
      )}

      {/* Naming Mode Presets */}
      <div className="grid grid-cols-2 gap-2">
        {namingPresets.map((preset) => {
          const active = namingMode === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => onNamingModeChange(preset.id)}
              className={`min-h-[68px] rounded-xl border px-3 py-2.5 text-left transition-all duration-200 ${
                active
                  ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border-[var(--accent-primary)]/40 shadow-[0_0_0_3px_var(--accent-primary-glow)]'
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

      {/* Quick Actions */}
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

      {/* Advanced Pattern Editor */}
      {showAdvanced && (
        <div className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 p-4 animate-fade-in">
          {/* Visual Token Builder */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Patrón visual</label>
            <div className="flex flex-wrap gap-2">
              {fields.map((f) => (
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

          {/* Pattern Input */}
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
              <span className="font-mono text-[var(--text-primary)] bg-[var(--bg-input)] px-2 py-0.5 rounded">{namingExample}</span>
            </div>
          </div>

          {/* Sequence Controls */}
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

      {/* Pattern Manager */}
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
                    {exampleFromPattern(preset.pattern, fields, files[0])}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Preview Section */}
      {files.length > 0 && usarRename && preview && (
        <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Vista previa</span>
              {dbMatchedCount < files.length && (
                <span className="text-[10px] text-[var(--accent-yellow)]">{files.length - dbMatchedCount} sin BD</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPreviewMode('compact')}
                className={`p-1.5 rounded-md transition-colors ${previewMode === 'compact' ? 'bg-[var(--bg-input)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                title="Vista compacta"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setPreviewMode('full')}
                className={`p-1.5 rounded-md transition-colors ${previewMode === 'full' ? 'bg-[var(--bg-input)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                title="Vista completa"
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <span className="text-[10px] text-[var(--text-muted)] ml-1">{preview.length} archivos</span>
            </div>
          </div>
          <div>
            {previewRows.map((p, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 px-4 py-2 text-sm ${i % 2 === 0 ? 'bg-[var(--bg-base)]' : 'bg-transparent'}`}
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
              <button
                onClick={() => setPreviewMode('full')}
                className="w-full border-t border-[var(--border-subtle)] px-4 py-2 text-center text-[11px] text-[var(--text-muted)] hover:text-[var(--accent-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
              >
                +{hiddenPreviewCount} archivos más — ver todo
              </button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
