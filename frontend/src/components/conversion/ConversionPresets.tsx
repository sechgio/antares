import { useState, useRef, useEffect } from 'react';
import { Save, FolderOpen, ChevronDown, Trash2, Check, Settings2 } from 'lucide-react';

export interface ConversionConfig {
  formato: string;
  calidad: number;
  conversionEnabled?: boolean;
  resizeEnabled: boolean;
  resizeAncho: string;
  resizeAlto: string;
  keepExif: boolean;
  usarRename: boolean;
  patron: string;
  secuencia: number;
  useFilenameSeq: boolean;
  namingMode: string;
}

interface SavedPreset {
  id: string;
  name: string;
  config: ConversionConfig;
  createdAt: number;
}

interface ConversionPresetsProps {
  currentConfig: ConversionConfig;
  onLoadConfig: (config: ConversionConfig) => void;
  className?: string;
}

const DEFAULT_PRESETS: SavedPreset[] = [
  {
    id: 'preset_web',
    name: 'Web Rápida',
    createdAt: 0,
    config: {
      formato: 'WEBP',
      calidad: 80,
      conversionEnabled: true,
      resizeEnabled: true,
      resizeAncho: '1920',
      resizeAlto: '1080',
      keepExif: false,
      usarRename: true,
      patron: '{codigo}_{nombre}_{seq}{ext}',
      secuencia: 1,
      useFilenameSeq: true,
      namingMode: 'code_name',
    },
  },
  {
    id: 'preset_print',
    name: 'Alta Calidad',
    createdAt: 0,
    config: {
      formato: 'PNG',
      calidad: 100,
      conversionEnabled: true,
      resizeEnabled: false,
      resizeAncho: '',
      resizeAlto: '',
      keepExif: true,
      usarRename: true,
      patron: '{codigo}_{nombre}_{seq}{ext}',
      secuencia: 1,
      useFilenameSeq: true,
      namingMode: 'code_name',
    },
  },
  {
    id: 'preset_archive',
    name: 'Archivo JPEG',
    createdAt: 0,
    config: {
      formato: 'JPEG',
      calidad: 95,
      conversionEnabled: true,
      resizeEnabled: false,
      resizeAncho: '',
      resizeAlto: '',
      keepExif: true,
      usarRename: true,
      patron: 'img_{seq}{ext}',
      secuencia: 1,
      useFilenameSeq: false,
      namingMode: 'sequential',
    },
  },
  {
    id: 'preset_social',
    name: 'Redes Sociales',
    createdAt: 0,
    config: {
      formato: 'JPEG',
      calidad: 85,
      conversionEnabled: true,
      resizeEnabled: true,
      resizeAncho: '1080',
      resizeAlto: '1080',
      keepExif: false,
      usarRename: false,
      patron: '',
      secuencia: 1,
      useFilenameSeq: true,
      namingMode: 'keep',
    },
  },
];

const STORAGE_KEY = 'antares_conversion_presets';

function loadPresets(): SavedPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function savePresets(presets: SavedPreset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch { /* ignore */ }
}

export default function ConversionPresets({ currentConfig, onLoadConfig, className = '' }: ConversionPresetsProps) {
  const [open, setOpen] = useState(false);
  const [saveMode, setSaveMode] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [customPresets, setCustomPresets] = useState<SavedPreset[]>(loadPresets);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSaveMode(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleSave = () => {
    const name = saveName.trim();
    if (!name) return;
    const newPreset: SavedPreset = {
      id: `custom_${Date.now()}`,
      name,
      config: { ...currentConfig },
      createdAt: Date.now(),
    };
    const updated = [...customPresets, newPreset];
    setCustomPresets(updated);
    savePresets(updated);
    setSaveName('');
    setSaveMode(false);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = customPresets.filter((p) => p.id !== id);
    setCustomPresets(updated);
    savePresets(updated);
  };

  const handleLoad = (preset: SavedPreset) => {
    onLoadConfig(preset.config);
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)] transition-all"
      >
        <Settings2 className="h-4 w-4" />
        <span>Configuración</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl z-50 overflow-hidden animate-scale-in">
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">Presets</span>
            <button
              onClick={() => setSaveMode((v) => !v)}
              className="text-[11px] font-semibold text-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)] transition-colors"
            >
              {saveMode ? 'Cancelar' : '+ Guardar actual'}
            </button>
          </div>

          {saveMode && (
            <div className="p-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 space-y-2">
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Nombre del preset..."
                className="w-full bg-[var(--bg-input)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--accent-primary)] transition-colors"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                autoFocus
              />
              <button
                onClick={handleSave}
                disabled={!saveName.trim()}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-[var(--accent-primary)] text-white disabled:opacity-40 hover:bg-[var(--accent-primary-hover)] transition-colors"
              >
                <Save className="h-3.5 w-3.5" />
                Guardar configuración
              </button>
            </div>
          )}

          <div className="max-h-80 overflow-y-auto py-1">
            <div className="px-3 py-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Predeterminados</span>
            </div>
            {DEFAULT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handleLoad(preset)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--bg-elevated)] transition-colors group"
              >
                <FolderOpen className="h-4 w-4 text-[var(--text-muted)] group-hover:text-[var(--accent-primary)] transition-colors shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-[var(--text-primary)]">{preset.name}</span>
                  <span className="block text-[11px] text-[var(--text-muted)] truncate">
                    {preset.config.formato} · {preset.config.calidad}% · {preset.config.resizeEnabled ? `${preset.config.resizeAncho}×${preset.config.resizeAlto}` : 'Original'}
                  </span>
                </div>
              </button>
            ))}

            {customPresets.length > 0 && (
              <>
                <div className="px-3 py-1.5 mt-1 border-t border-[var(--border-subtle)]">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Personalizados</span>
                </div>
                {customPresets.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => handleLoad(preset)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--bg-elevated)] transition-colors group"
                  >
                    <Check className="h-4 w-4 text-[var(--text-muted)] group-hover:text-[var(--accent-green)] transition-colors shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-[var(--text-primary)]">{preset.name}</span>
                      <span className="block text-[11px] text-[var(--text-muted)] truncate">
                        {preset.config.formato} · {preset.config.calidad}%
                      </span>
                    </div>
                    <button
                      onClick={(e) => handleDelete(preset.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10 transition-all"
                      title="Eliminar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
