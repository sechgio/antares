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
    <Card>
      <div className="eyebrow mb-4">NOMBRES</div>
      {hasVideos && (
        <div className="mb-4 p-3 bg-[#3B82F6]/10 border border-[#3B82F6]/30 rounded-lg">
          <p className="text-xs text-[#3B82F6]">
            ℹ️ Los videos mantendrán su extensión original al renombrarse.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {namingPresets.map((preset) => {
          const active = namingMode === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => onNamingModeChange(preset.id)}
              className={`text-left px-4 py-3 rounded-xl border transition-all ${
                active
                  ? 'bg-[#5E6AD2] text-white border-[#5E6AD2]'
                  : 'bg-[#1A1A1A] text-[#A0A0A0] border-[#222222] hover:border-[#444444] hover:text-white'
              }`}
            >
              <span className="block text-[13px] font-semibold">{preset.label}</span>
              <span className={`block mt-1 font-mono text-[11px] truncate ${active ? 'text-white/75' : 'text-[#666666]'}`}>
                {exampleFromPattern(preset.pattern, fields, files[0])}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-[13px] text-[#5E6AD2] hover:underline font-medium"
        >
          {showAdvanced ? 'Ocultar patrón avanzado' : 'Editar patrón avanzado'}
        </button>
        <span className="text-xs text-[#666666]">
          Ej: <span className="font-mono text-white">{namingExample}</span>
        </span>
      </div>

      {showAdvanced && (
        <div className="space-y-3 mb-4">
          <Input
            value={patron}
            onChange={(e) => onPatronChange(e.target.value)}
            placeholder="{codigo}_{nombre}{ext}"
            className="font-mono"
          />
          <div className="flex flex-wrap gap-2">
            {fields.map((f) => (
              <button key={f} onClick={() => onInsertVar(`{${f}}`)} className="px-3 py-1.5 rounded-lg bg-[#1A1A1A] text-white text-xs font-mono border border-[#222222] hover:bg-[#5E6AD2] hover:text-white hover:border-[#5E6AD2] transition-colors">
                {`{${f}}`}
              </button>
            ))}
            <button onClick={() => onInsertVar('{seq}')} className="px-3 py-1.5 rounded-lg bg-[#5E6AD2]/10 text-[#5E6AD2] text-xs font-mono border border-[#5E6AD2]/30 hover:bg-[#5E6AD2] hover:text-white transition-colors">{'{seq}'}</button>
            <button onClick={() => onInsertVar('{ext}')} className="px-3 py-1.5 rounded-lg bg-[#3B82F6]/10 text-[#3B82F6] text-xs font-mono border border-[#3B82F6]/30 hover:bg-[#3B82F6] hover:text-white transition-colors">{'{ext}'}</button>
          </div>
          {usesSeq && (
            <div className="flex items-center gap-3">
              <Toggle checked={useFilenameSeq} onChange={onToggleFilenameSeq} />
              <span className="text-sm text-white">Usar número del archivo original</span>
              {!useFilenameSeq && (
                <Input
                  type="number"
                  min={1}
                  max={9999}
                  value={secuencia}
                  onChange={(e) => onSecuenciaChange(parseInt(e.target.value) || 1)}
                  className="w-24 text-center"
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Preview list */}
      {files.length > 0 && usarRename && preview && (
        <div className="border border-[#1A1A1A] rounded-xl overflow-hidden max-h-60 overflow-y-auto">
          {preview.map((p, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 px-4 py-2 text-sm ${i % 2 === 0 ? 'bg-[#0A0A0A]' : 'bg-transparent'}`}
            >
              <span className="flex-1 truncate font-mono text-[11px] text-[#666666]">{p.origen}</span>
              <span className="text-[#333333]">→</span>
              <span className="flex-1 truncate font-mono text-[13px] text-white font-medium">{p.nuevo}</span>
              <Badge variant={p.en_bd ? 'success' : 'warning'} className="shrink-0 text-[10px]">
                {p.en_bd ? 'BD' : 'Sin BD'}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
