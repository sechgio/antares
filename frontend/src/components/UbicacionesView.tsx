import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Upload,
  Folder,
  MapPin,
  Loader2,
  FileSpreadsheet,
  CheckCircle2,
  X,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Eye,
  Files,
  FileOutput,
  PenTool,
} from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import Button from './ui/Button';
import ThemedSelect from './ui/ThemedSelect';
import { api } from '../api';
import { useToast } from '../hooks/useToast';
import { registerLocalPath } from '../utils/registerLocalPath';
import { getLocalImageDataUrl } from '../utils/localThumb';
import { parseCombinedCoords, isValidCoord } from '../utils/coords';

type Result = { success: boolean; data?: any; error?: string } | null;

type PreviewData = {
  image: string;
  image_path?: string;
  cod_componente: string;
  direccion: string;
  localidad: string;
  distrito: string;
  total_filas: number;
  row_index: number;
  formato?: string;
} | null;

function isCspSafeImageSrc(src: string | undefined | null): boolean {
  if (!src || typeof src !== 'string') return false;
  return src.startsWith('data:') || src.startsWith('blob:');
}

/**
 * Backend returns file:// + image_path for IPC size; Electron CSP blocks file:
 * in img-src, so resolve a data: URL from the allowlisted disk path.
 */
async function resolvePreviewImageSrc(data: {
  image?: string;
  image_path?: string;
}): Promise<string | null> {
  if (isCspSafeImageSrc(data.image)) return data.image ?? null;

  const localPath =
    (typeof data.image_path === 'string' && data.image_path.trim())
      ? data.image_path
      : (typeof data.image === 'string' && data.image.startsWith('file:')
        ? decodeURIComponent(data.image.replace(/^file:\/\//i, '').replace(/^\/([A-Za-z]:)/, '$1'))
        : '');

  if (!localPath) return null;
  await registerLocalPath(localPath);
  return getLocalImageDataUrl(localPath);
}

type OutputMode = 'individual' | 'consolidado';

// ──────────────────────────────────────────────
// Segmented Control (generic toggle pills)
// ──────────────────────────────────────────────
const SegmentedControl: React.FC<{
  options: { value: string; label: React.ReactNode }[];
  value: string;
  onChange: (v: string) => void;
}> = ({ options, value, onChange }) => (
  <div className="flex rounded-lg bg-[var(--bg-input)] p-0.5 gap-0.5">
    {options.map((opt) => (
      <button
        key={opt.value}
        type="button"
        onClick={() => onChange(opt.value)}
        className={`flex-1 flex items-center justify-center gap-1.5 text-[11px] font-medium py-1.5 px-2 rounded-md transition-all duration-200 ${
          value === opt.value
            ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm ring-1 ring-[var(--border-subtle)]'
            : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

type TextFieldStyle = {
  fontSize: number;
  bold: boolean;
  color: string;
  offsetX: number;
  offsetY: number;
  visible: boolean;
};

type CustomStyles = {
  texts: {
    cod_componente: Partial<TextFieldStyle>;
    direccion: Partial<TextFieldStyle>;
    localidad: Partial<TextFieldStyle>;
    distrito: Partial<TextFieldStyle>;
  };
  pin: {
    color?: string;
    scale?: number;
    offsetX?: number;
    offsetY?: number;
    visible?: boolean;
  };
  map: {
    overlayAlpha?: number;
    overlayColor?: string;
  };
  layout: {
    lineSpacing?: number;
    lineGap?: number;
    yStart?: number;
  };
};

const DEFAULT_STYLES: CustomStyles = {
  texts: {
    cod_componente: { fontSize: 120, bold: true, color: '#000000', offsetX: 0, offsetY: 0, visible: true },
    direccion: { fontSize: 60, bold: true, color: '#000000', offsetX: 0, offsetY: 0, visible: true },
    localidad: { fontSize: 60, bold: true, color: '#000000', offsetX: 0, offsetY: 0, visible: true },
    distrito: { fontSize: 60, bold: true, color: '#000000', offsetX: 0, offsetY: 0, visible: true },
  },
  pin: { color: '', scale: 0.15, offsetX: 0, offsetY: 0, visible: true },
  map: { overlayAlpha: 120, overlayColor: '#F6F6F6' },
  layout: { lineSpacing: 180, lineGap: 0.7, yStart: 120 },
};

const STORAGE_KEY = 'antares:ubicaciones:customStyles';
const LS_OUTPUT_DIR = 'antares:ubicaciones:outputDir';
const LS_FORMATO = 'antares:ubicaciones:formato';
const LS_OUTPUT_MODE = 'antares:ubicaciones:outputMode';
const LS_INPUT_MODE = 'antares:ubicaciones:inputMode';
const LS_MANUAL_DATA = 'antares:ubicaciones:manualData';
const LS_API_KEYS = 'antares:ubicaciones:apiKeys';
const LS_GOOGLE_MAPS_KEY = 'antares:ubicaciones:googleMapsKey';

function clearPlaintextApiKeys(): void {
  localStorage.removeItem(LS_API_KEYS);
  localStorage.removeItem(LS_GOOGLE_MAPS_KEY);
}

function readPlaintextApiKeys(): Record<string, string> {
  try {
    const saved = localStorage.getItem(LS_API_KEYS);
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string' && v.trim()) out[k] = v;
        }
        return out;
      }
    }
    const oldGoogleKey = localStorage.getItem(LS_GOOGLE_MAPS_KEY);
    if (oldGoogleKey) return { google: oldGoogleKey };
  } catch {
    // Corrupt plaintext — treat as empty and let the user re-enter.
  }
  return {};
}

const DEFAULT_MANUAL_DATA = {
  cod_componente: '',
  direccion: '',
  localidad: '',
  distrito: '',
  lat: '',
  lon: '',
};

type ManualData = typeof DEFAULT_MANUAL_DATA;

function deepMergeStyles<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out = { ...base };
  for (const key of Object.keys(patch)) {
    const val = patch[key];
    const baseVal = base[key];
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      out[key as keyof T] = deepMergeStyles(
        (typeof baseVal === 'object' && baseVal !== null ? baseVal : {}) as Record<string, unknown>,
        val as Record<string, unknown>,
      ) as T[keyof T];
    } else if (val !== undefined) {
      out[key as keyof T] = val as T[keyof T];
    }
  }
  return out;
}

export function loadCustomStylesFromStorage(): CustomStyles {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? deepMergeStyles(DEFAULT_STYLES, JSON.parse(saved)) : DEFAULT_STYLES;
  } catch {
    return DEFAULT_STYLES;
  }
}

const PIN_PRESETS = ['', '#00BCD4', '#E53935', '#43A047', '#FB8C00', '#8E24AA', '#1E88E5', '#000000'];

const MAP_PROVIDERS = [
  { id: 'osm', label: 'OpenStreetMap', needsKey: false, helpUrl: '' },
  { id: 'google', label: 'Google Maps', needsKey: true, helpUrl: 'https://developers.google.com/maps/documentation/maps-static/get-api-key' },
  { id: 'mapbox', label: 'Mapbox', needsKey: true, helpUrl: 'https://docs.mapbox.com/help/glossary/access-token/' },
  { id: 'maptiler', label: 'MapTiler', needsKey: true, helpUrl: 'https://docs.maptiler.com/cloud/api/authentication-key/' },
  { id: 'stadia', label: 'Stadia Maps', needsKey: true, helpUrl: 'https://docs.stadiamaps.com/authentication/' },
  { id: 'geoapify', label: 'Geoapify', needsKey: true, helpUrl: 'https://www.geoapify.com/get-started-with-maps-api' },
  { id: 'thunderforest', label: 'Thunderforest', needsKey: true, helpUrl: 'https://www.thunderforest.com/docs/apikeys/' },
] as const;

const MAP_PROVIDER_BY_ID = Object.fromEntries(MAP_PROVIDERS.map((p) => [p.id, p])) as Record<
  string,
  (typeof MAP_PROVIDERS)[number]
>;

const TEXT_FIELDS = [
  { key: 'cod_componente' as const, label: 'Código' },
  { key: 'direccion' as const, label: 'Dirección' },
  { key: 'localidad' as const, label: 'Localidad' },
  { key: 'distrito' as const, label: 'Distrito' },
] as const;

export const UbicacionesView: React.FC = () => {
  const { addToast } = useToast();
  const [inputMode, setInputMode] = useState<'excel' | 'manual'>(() => {
    try {
      return localStorage.getItem(LS_INPUT_MODE) === 'manual' ? 'manual' : 'excel';
    } catch {
      return 'excel';
    }
  });
  const [manualData, setManualData] = useState<ManualData>(() => {
    try {
      const saved = localStorage.getItem(LS_MANUAL_DATA);
      return saved ? { ...DEFAULT_MANUAL_DATA, ...JSON.parse(saved) } : { ...DEFAULT_MANUAL_DATA };
    } catch {
      return { ...DEFAULT_MANUAL_DATA };
    }
  });

  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [outputDir, setOutputDir] = useState<string>(() => {
    try {
      return localStorage.getItem(LS_OUTPUT_DIR) || '';
    } catch {
      return '';
    }
  });
  const [formato, setFormato] = useState<'vertical' | 'horizontal'>(() => {
    try {
      return localStorage.getItem(LS_FORMATO) === 'horizontal' ? 'horizontal' : 'vertical';
    } catch {
      return 'vertical';
    }
  });
  const [outputMode, setOutputMode] = useState<OutputMode>(() => {
    try {
      return localStorage.getItem(LS_OUTPUT_MODE) === 'consolidado' ? 'consolidado' : 'individual';
    } catch {
      return 'individual';
    }
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Preview state
  const [preview, setPreview] = useState<PreviewData>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRowIndex, setPreviewRowIndex] = useState(0);
  const [excelPath, setExcelPath] = useState<string>('');
  const [totalFilas, setTotalFilas] = useState(0);

  // Zoom & Provider states
  const [zoom, setZoom] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('antares:ubicaciones:zoom');
      return saved ? parseInt(saved, 10) : 18;
    } catch {
      return 18;
    }
  });

  const [provider, setProvider] = useState<string>(() => {
    try {
      return localStorage.getItem('antares:ubicaciones:provider') || 'osm';
    } catch {
      return 'osm';
    }
  });

  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [keysConfigured, setKeysConfigured] = useState<Record<string, boolean>>({});
  const apiKeysHydratedRef = useRef(false);

  // Design custom styles state
  const [customStyles, setCustomStyles] = useState<CustomStyles>(loadCustomStylesFromStorage);
  const [designOpen, setDesignOpen] = useState(false);
  const [designTab, setDesignTab] = useState<'texts' | 'pin' | 'map'>('texts');

  // Track the latest fetch request to avoid race conditions
  const fetchIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stylePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // softLoad only makes sense when we already have an image on screen
  const hasPreviewRef = useRef(false);

  // Keep params ref up to date to avoid recreating fetchPreview
  const lastParamsRef = useRef({
    excelPath,
    inputMode,
    manualData,
    formato,
    outputDir,
    outputMode,
    customStyles,
    provider,
    zoom,
    apiKeys,
    previewRowIndex,
  });

  useEffect(() => {
    lastParamsRef.current = {
      excelPath,
      inputMode,
      manualData,
      formato,
      outputDir,
      outputMode,
      customStyles,
      provider,
      zoom,
      apiKeys,
      previewRowIndex,
    };
  }, [excelPath, inputMode, manualData, formato, outputDir, outputMode, customStyles, provider, zoom, apiKeys, previewRowIndex]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // One-shot migrate plaintext localStorage → secure store, then wipe LS.
        const migrated = readPlaintextApiKeys();
        if (Object.keys(migrated).length > 0) {
          try {
            await api.ubicacionesKeysSet(migrated);
          } catch (err) {
            console.error('Failed to migrate ubicaciones API keys', err);
          }
          clearPlaintextApiKeys();
        }

        const { keys: secureKeys, configured } = await api.ubicacionesKeysGet();
        if (cancelled) return;

        // Keep draft state empty for configured providers (mask only in UI);
        // Electron injects real keys for preview/generate.
        const next: Record<string, string> = {};
        for (const [k, v] of Object.entries(secureKeys || {})) {
          if (configured?.[k]) next[k] = '';
          else if (typeof v === 'string' && v && !v.startsWith('••••')) next[k] = v;
        }
        setApiKeys(next);
        setKeysConfigured(configured || {});
      } catch (err) {
        console.error('Failed to load ubicaciones API keys', err);
        clearPlaintextApiKeys();
      } finally {
        if (!cancelled) apiKeysHydratedRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (stylePreviewTimerRef.current) clearTimeout(stylePreviewTimerRef.current);
      if (mapPreviewTimerRef.current) clearTimeout(mapPreviewTimerRef.current);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customStyles));
  }, [customStyles]);

  useEffect(() => {
    localStorage.setItem('antares:ubicaciones:zoom', zoom.toString());
  }, [zoom]);

  useEffect(() => {
    localStorage.setItem('antares:ubicaciones:provider', provider);
  }, [provider]);

  useEffect(() => {
    if (!apiKeysHydratedRef.current) return;
    // Only persist entries that look like freshly typed secrets (not empty/mask).
    const dirty: Record<string, string> = {};
    for (const [k, v] of Object.entries(apiKeys)) {
      const s = String(v || '').trim();
      if (s && !s.startsWith('••••')) dirty[k] = s;
    }
    if (Object.keys(dirty).length === 0) return;
    const timer = setTimeout(() => {
      api.ubicacionesKeysSet(dirty).then((resp) => {
        if (resp?.configured) setKeysConfigured(resp.configured);
        // Clear draft after successful save so secrets don't linger in React state.
        setApiKeys((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(dirty)) next[k] = '';
          return next;
        });
      }).catch((err) => {
        console.error('Failed to persist ubicaciones API keys', err);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [apiKeys]);

  useEffect(() => {
    if (outputDir) {
      localStorage.setItem(LS_OUTPUT_DIR, outputDir);
    } else {
      localStorage.removeItem(LS_OUTPUT_DIR);
    }
  }, [outputDir]);

  useEffect(() => {
    localStorage.setItem(LS_FORMATO, formato);
  }, [formato]);

  useEffect(() => {
    localStorage.setItem(LS_OUTPUT_MODE, outputMode);
  }, [outputMode]);

  useEffect(() => {
    localStorage.setItem(LS_INPUT_MODE, inputMode);
  }, [inputMode]);

  useEffect(() => {
    localStorage.setItem(LS_MANUAL_DATA, JSON.stringify(manualData));
  }, [manualData]);

  useEffect(() => {
    hasPreviewRef.current = !!preview;
  }, [preview]);

  const fetchPreview = useCallback(
    async (
      rowIndex: number,
      options?: { recomposeOnly?: boolean; excelPathOverride?: string; softLoad?: boolean },
    ) => {
      const {
        excelPath: pathFromState,
        inputMode: currentInputMode,
        manualData: currentManualData,
        formato: currentFormato,
        customStyles: currentStyles,
        provider: currentProvider,
        zoom: currentZoom,
        apiKeys: currentApiKeys,
      } = lastParamsRef.current;

      const path = options?.excelPathOverride ?? pathFromState;
      if (currentInputMode === 'excel' && !path) return;
      if (
        currentInputMode === 'manual'
        && (!isValidCoord(currentManualData.lat) || !isValidCoord(currentManualData.lon))
      ) {
        return;
      }

      const previewManualData = currentManualData;
      const myId = ++fetchIdRef.current;
      // softLoad avoids spinner flicker when an image is already visible; on first
      // load (or after clear) we must show the loading state or the panel stays blank.
      const softLoad =
        (options?.softLoad === true || options?.recomposeOnly === true) && hasPreviewRef.current;
      if (!softLoad) {
        setPreviewLoading(true);
      }
      setPreviewError(null);
      try {
        const resp = await api.previewUbicacion({
          excelPath: path || null,
          formato: currentFormato,
          rowIndex,
          recomposeOnly: options?.recomposeOnly === true,
          customStyles: currentStyles as Record<string, unknown>,
          provider: currentProvider,
          zoom: currentZoom,
          api_key: currentApiKeys[currentProvider] || '',
          manualData: currentInputMode === 'manual' ? previewManualData : undefined,
        });
        // Ignore stale responses
        if (myId !== fetchIdRef.current) return;
        const r = resp as { success: boolean; data?: any; error?: string; total_filas?: number };
        if (r?.total_filas) {
          setTotalFilas(r.total_filas);
        }
        if (r?.success) {
          // Defensive: if the response carries a formato field and it does
          // not match the current selection, skip it (stale format toggle).
          const respFormato = r.data?.formato;
          if (respFormato && respFormato !== currentFormato) return;
          if (!r.data) {
            setPreview(null);
            hasPreviewRef.current = false;
            return;
          }
          const safeSrc = await resolvePreviewImageSrc(r.data);
          if (myId !== fetchIdRef.current) return;
          if (!safeSrc) {
            setPreview(null);
            hasPreviewRef.current = false;
            setPreviewError('No se pudo cargar la imagen de vista previa');
            return;
          }
          setPreview({ ...r.data, image: safeSrc });
          hasPreviewRef.current = true;
          if (r.data?.total_filas) {
            setTotalFilas(r.data.total_filas);
          }
        } else {
          setPreviewError(r?.error || 'Error al generar vista previa');
        }
      } catch (err: any) {
        if (myId !== fetchIdRef.current) return;
        setPreviewError(err.message || 'Error de conexion');
      } finally {
        if (myId === fetchIdRef.current) {
          setPreviewLoading(false);
        }
      }
    },
    [],
  );

  // Single-active-request coordinator for style and map updates
  const isFetchInFlightRef = useRef(false);
  const hasPendingFetchRef = useRef(false);
  const pendingRowIndexRef = useRef<number | null>(null);
  const pendingOptionsRef = useRef<{ recomposeOnly?: boolean; softLoad?: boolean; excelPathOverride?: string } | null>(null);

  const triggerPreviewFetch = useCallback(
    (
      targetRowIndex?: number,
      options?: { recomposeOnly?: boolean; softLoad?: boolean; excelPathOverride?: string },
    ) => {
      const index = targetRowIndex ?? lastParamsRef.current.previewRowIndex;
      if (isFetchInFlightRef.current) {
        hasPendingFetchRef.current = true;
        pendingRowIndexRef.current = index;
        const prev = pendingOptionsRef.current;
        const needsMapRefetch = options?.recomposeOnly === false || prev?.recomposeOnly === false;
        pendingOptionsRef.current = {
          softLoad: true,
          recomposeOnly: needsMapRefetch
            ? false
            : (options?.recomposeOnly ?? prev?.recomposeOnly ?? true),
          excelPathOverride: options?.excelPathOverride ?? prev?.excelPathOverride,
        };
        return;
      }

      isFetchInFlightRef.current = true;
      fetchPreview(index, options).finally(() => {
        isFetchInFlightRef.current = false;
        if (hasPendingFetchRef.current) {
          hasPendingFetchRef.current = false;
          const nextIndex = pendingRowIndexRef.current ?? lastParamsRef.current.previewRowIndex;
          const nextOpts = pendingOptionsRef.current || { softLoad: true };
          pendingRowIndexRef.current = null;
          pendingOptionsRef.current = null;
          triggerPreviewFetch(nextIndex, nextOpts);
        }
      });
    },
    [fetchPreview],
  );

  const scheduleStylePreview = useCallback(() => {
    if (stylePreviewTimerRef.current) clearTimeout(stylePreviewTimerRef.current);
    stylePreviewTimerRef.current = setTimeout(() => {
      if (excelPath || inputMode === 'manual') {
        triggerPreviewFetch(undefined, { recomposeOnly: true, softLoad: true });
      }
    }, 32);
  }, [excelPath, inputMode, triggerPreviewFetch]);

  const updateStyle = useCallback(
    (updater: (prev: CustomStyles) => CustomStyles) => {
      setCustomStyles((prev) => {
        const next = updater(prev);
        lastParamsRef.current = { ...lastParamsRef.current, customStyles: next };
        scheduleStylePreview();
        return next;
      });
    },
    [scheduleStylePreview],
  );

  const updateZoom = useCallback((newZoom: number) => {
    setZoom(newZoom);
    lastParamsRef.current = { ...lastParamsRef.current, zoom: newZoom };
    if (mapPreviewTimerRef.current) clearTimeout(mapPreviewTimerRef.current);
    mapPreviewTimerRef.current = setTimeout(() => {
      if (excelPath || inputMode === 'manual') {
        triggerPreviewFetch(undefined, { recomposeOnly: false, softLoad: true });
      }
    }, 100);
  }, [excelPath, inputMode, triggerPreviewFetch]);

  const updateProvider = useCallback((newProvider: string) => {
    setProvider(newProvider);
    lastParamsRef.current = { ...lastParamsRef.current, provider: newProvider };
    if (excelPath || inputMode === 'manual') {
      if (mapPreviewTimerRef.current) clearTimeout(mapPreviewTimerRef.current);
      mapPreviewTimerRef.current = setTimeout(() => {
        triggerPreviewFetch(undefined, { recomposeOnly: false, softLoad: true });
      }, 50);
    }
  }, [excelPath, inputMode, triggerPreviewFetch]);

  const scheduleApiKeyPreview = useCallback(() => {
    if (mapPreviewTimerRef.current) clearTimeout(mapPreviewTimerRef.current);
    mapPreviewTimerRef.current = setTimeout(() => {
      if (excelPath || inputMode === 'manual') {
        triggerPreviewFetch(undefined, { recomposeOnly: false, softLoad: true });
      }
    }, 300);
  }, [excelPath, inputMode, triggerPreviewFetch]);

  const resetStyles = useCallback(() => {
    setCustomStyles(DEFAULT_STYLES);
    localStorage.removeItem(STORAGE_KEY);
    lastParamsRef.current = { ...lastParamsRef.current, customStyles: DEFAULT_STYLES };
    scheduleStylePreview();
  }, [scheduleStylePreview]);

  const prevFormatoRef = useRef(formato);
  const lonInputRef = useRef<HTMLInputElement>(null);

  // Solo re-fetch al cambiar orientación (la carga inicial la disparan los handlers)
  useEffect(() => {
    if (!excelPath && inputMode !== 'manual') {
      setPreview(null);
      hasPreviewRef.current = false;
      setPreviewError(null);
      return;
    }
    if (prevFormatoRef.current === formato) return;
    prevFormatoRef.current = formato;
    triggerPreviewFetch(previewRowIndex, { recomposeOnly: true, softLoad: true });
  }, [formato, excelPath, inputMode, previewRowIndex, triggerPreviewFetch]);

  // Restaurar vista previa al montar en modo manual con coords ya guardadas
  // (localStorage). Sin esto el panel queda en blanco aunque lat/lon existan.
  useEffect(() => {
    if (
      inputMode === 'manual'
      && isValidCoord(manualData.lat)
      && isValidCoord(manualData.lon)
    ) {
      triggerPreviewFetch(0);
    }
    // Solo al montar: cambios posteriores los manejan handleManualChange / mode switch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadExcelFile = useCallback(
    async (file: File) => {
      const path = window.electronAPI?.getPathForFile?.(file) || '';
      if (!path) {
        setExcelFile(null);
        setExcelPath('');
        setPreview(null);
        hasPreviewRef.current = false;
        setPreviewError(null);
        setPreviewLoading(false);
        addToast({
          message: 'No se pudo resolver la ruta del archivo Excel.',
          type: 'error',
        });
        return;
      }
      await registerLocalPath(path);
      setExcelFile(file);
      setResult(null);
      setPreview(null);
      hasPreviewRef.current = false;
      setPreviewRowIndex(0);
      prevFormatoRef.current = formato;
      setExcelPath(path);
      setPreviewLoading(true);
      triggerPreviewFetch(0, { excelPathOverride: path });
    },
    [triggerPreviewFetch, formato, addToast],
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      loadExcelFile(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && /\.(xlsx|xls)$/i.test(file.name)) {
      loadExcelFile(file);
    }
  };

  const handleRemoveExcel = () => {
    // Cancel any in-flight preview request so stale responses don't update state
    fetchIdRef.current++;
    setExcelFile(null);
    setExcelPath('');
    setPreview(null);
    hasPreviewRef.current = false;
    setPreviewError(null);
    setPreviewLoading(false);
    setResult(null);
    setPreviewRowIndex(0);
    setTotalFilas(0);
  };

  const handleSelectOutputDir = async () => {
    try {
      const result = await api.dialogFolder({
        title: 'Seleccionar carpeta de salida',
        pickOnly: true,
      });
      if (result.folder) {
        setOutputDir(result.folder);
      } else if (result.paths && result.paths.length > 0) {
        setOutputDir(result.paths[0]);
      }
    } catch (err) {
      console.error('Error selecting directory:', err);
    }
  };

  const handleGenerate = async () => {
    if (inputMode === 'excel' && !excelFile) return;
    if (inputMode === 'manual' && (!manualData.lat || !manualData.lon)) {
      setResult({ success: false, error: 'Ingresa latitud y longitud válidas' });
      return;
    }
    if (!outputDir) return;

    setIsProcessing(true);
    setResult(null);

    try {
      if (!window.electronAPI) {
        setResult({ success: false, error: 'API de Antares no disponible.' });
        return;
      }
      
      let path = '';
      if (inputMode === 'excel' && excelFile) {
        path = window.electronAPI.getPathForFile?.(excelFile) || '';
        if (!path) {
          setResult({ success: false, error: 'No se pudo resolver la ruta del archivo Excel.' });
          return;
        }
        await registerLocalPath(path);
      }

      const {
        inputMode: genInputMode,
        manualData: genManualData,
        formato: genFormato,
        outputDir: genOutputDir,
        outputMode: genOutputMode,
        customStyles: genStyles,
        provider: genProvider,
        zoom: genZoom,
        apiKeys: genApiKeys,
      } = lastParamsRef.current;

      const response = await api.generarUbicaciones({
        excelPath: genInputMode === 'excel' ? path : null,
        outputDir: genOutputDir,
        formato: genFormato,
        consolidado: genOutputMode === 'consolidado',
        customStyles: genStyles as Record<string, unknown>,
        provider: genProvider,
        zoom: genZoom,
        api_key: genApiKeys[genProvider] || '',
        manualData: genInputMode === 'manual' ? genManualData : undefined,
      });
      setResult(response);
    } catch (err: any) {
      setResult({ success: false, error: err.message || 'Error desconocido' });
    } finally {
      setIsProcessing(false);
    }
  };

  const schedulePreview = useCallback(
    (
      rowIndex: number,
      options?: {
        excelPathOverride?: string;
        softLoad?: boolean;
        recomposeOnly?: boolean;
        debounceMs?: number;
      },
    ) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const delay = options?.debounceMs ?? 150;
      debounceRef.current = setTimeout(() => {
        triggerPreviewFetch(rowIndex, options);
      }, delay);
    },
    [triggerPreviewFetch],
  );

  const scheduleTextPreview = useCallback(() => {
    schedulePreview(0, { recomposeOnly: true, softLoad: true, debounceMs: 50 });
  }, [schedulePreview]);

  const scheduleMapPreview = useCallback(
    (immediate = false) => {
      schedulePreview(0, { recomposeOnly: false, softLoad: true, debounceMs: immediate ? 0 : 400 });
    },
    [schedulePreview],
  );

  const handleManualChange = (field: keyof typeof manualData, value: string) => {
    // Volver al panel de preview si aún se muestra el resultado de una generación previa
    setResult(null);
    if (field === 'lat') {
      const parsed = parseCombinedCoords(value);
      if (parsed) {
        setManualData((prev) => {
          const next = { ...prev, lat: parsed.lat, lon: parsed.lon };
          lastParamsRef.current = { ...lastParamsRef.current, manualData: next };
          return next;
        });
        if (isValidCoord(parsed.lat) && isValidCoord(parsed.lon)) {
          scheduleMapPreview(true);
        } else {
          setPreview(null);
          hasPreviewRef.current = false;
          setPreviewError(null);
        }
        lonInputRef.current?.focus();
        return;
      }
    }
    setManualData((prev) => {
      const next = { ...prev, [field]: value };
      lastParamsRef.current = { ...lastParamsRef.current, manualData: next };
      return next;
    });
    const isCoordChange = field === 'lat' || field === 'lon';
    if (isCoordChange) {
      const nextLat = field === 'lat' ? value : manualData.lat;
      const nextLon = field === 'lon' ? value : manualData.lon;
      if (isValidCoord(nextLat) && isValidCoord(nextLon)) {
        scheduleMapPreview(false);
      } else {
        setPreview(null);
        hasPreviewRef.current = false;
        setPreviewError(null);
      }
      return;
    }
    scheduleTextPreview();
  };

  const handlePrevRow = () => {
    if (previewRowIndex > 0) {
      const newIndex = previewRowIndex - 1;
      setPreviewRowIndex(newIndex);
      schedulePreview(newIndex);
    }
  };

  const handleNextRow = () => {
    if (totalFilas > 0 && previewRowIndex < totalFilas - 1) {
      const newIndex = previewRowIndex + 1;
      setPreviewRowIndex(newIndex);
      schedulePreview(newIndex);
    }
  };

  const hasValidManualCoords = isValidCoord(manualData.lat) && isValidCoord(manualData.lon);
  const canGenerate = (inputMode === 'excel' ? !!excelFile : hasValidManualCoords) && !!outputDir && !isProcessing;
  const folderName = outputDir ? outputDir.split('\\').pop() || outputDir.split('/').pop() : '';

  const hasData = inputMode === 'excel' ? !!excelFile : true;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Sidebar: Config ── */}
      <div className="w-[340px] flex flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-base)] overflow-hidden">
        {/* Title (fixed top) */}
        <div className="shrink-0 flex items-center gap-2.5 px-4 h-11 border-b border-[var(--border-subtle)]">
          <MapPin size={16} className="text-[var(--accent-primary)] shrink-0" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Generador de Ubicaciones</h2>
        </div>

        {/* Scrollable config sections */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="flex flex-col gap-3">

            {/* ── Origen de Datos ── */}
            <section className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Origen de Datos
              </label>
              <SegmentedControl
                value={inputMode}
                onChange={(v) => {
                  const nextMode = v as 'excel' | 'manual';
                  setInputMode(nextMode);
                  lastParamsRef.current = { ...lastParamsRef.current, inputMode: nextMode };
                  setResult(null);
                  if (nextMode === 'excel' && excelPath) {
                    schedulePreview(previewRowIndex);
                  } else if (nextMode === 'manual') {
                    if (isValidCoord(manualData.lat) && isValidCoord(manualData.lon)) {
                      schedulePreview(0);
                    } else {
                      setPreview(null);
                      hasPreviewRef.current = false;
                      setPreviewError(null);
                    }
                  }
                }}
                options={[
                  { value: 'excel', label: <><FileSpreadsheet size={12} /> Excel</> },
                  { value: 'manual', label: <><PenTool size={12} /> Manual</> },
                ]}
              />

              {inputMode === 'excel' ? (
                excelFile ? (
                  <div className="flex items-center gap-2 rounded-lg border border-[var(--accent-green)]/25 bg-[var(--accent-green)]/[0.06] px-3 py-2 transition-all mt-1">
                    <CheckCircle2 size={14} className="text-[var(--accent-green)] shrink-0" />
                    <span className="text-[11px] font-medium text-[var(--text-primary)] truncate flex-1">
                      {excelFile.name}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                      {(excelFile.size / 1024).toFixed(0)} KB
                    </span>
                    <button
                      onClick={handleRemoveExcel}
                      aria-label="Quitar archivo Excel"
                      className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors shrink-0"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <label
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    className={`group flex items-center gap-2.5 py-2 px-3 rounded-lg border-2 border-dashed transition-all duration-200 cursor-pointer mt-1 ${
                      isDragging
                        ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/[0.06] scale-[1.01]'
                        : 'border-[var(--border-medium)] hover:border-[var(--accent-primary)]/50 hover:bg-[var(--bg-elevated)]'
                    }`}
                  >
                    <FileSpreadsheet
                      size={16}
                      className={`shrink-0 transition-colors ${
                        isDragging
                          ? 'text-[var(--accent-primary)]'
                          : 'text-[var(--text-muted)] group-hover:text-[var(--accent-primary)]/80'
                      }`}
                    />
                    <div className="min-w-0">
                      <span className="text-[11px] font-medium text-[var(--text-secondary)] block leading-tight">
                        Arrastra o haz clic para subir
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] leading-tight">.xlsx, .xls</span>
                    </div>
                    <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
                  </label>
                )
              ) : (
                <div className="flex flex-col gap-2 mt-1 p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
                  {/* Fila 1: Coordenadas */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-semibold text-[var(--text-muted)] uppercase">Latitud*</label>
                      <input
                        type="text"
                        value={manualData.lat}
                        onChange={(e) => handleManualChange('lat', e.target.value)}
                        className="bg-[var(--bg-input)] border border-[var(--border-medium)] rounded text-[11px] px-2 py-1 text-[var(--text-primary)] w-full outline-none focus:border-[var(--accent-primary)] transition-colors"
                        placeholder="-12.3456"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-semibold text-[var(--text-muted)] uppercase">Longitud*</label>
                      <input
                        ref={lonInputRef}
                        type="text"
                        value={manualData.lon}
                        onChange={(e) => handleManualChange('lon', e.target.value)}
                        className="bg-[var(--bg-input)] border border-[var(--border-medium)] rounded text-[11px] px-2 py-1 text-[var(--text-primary)] w-full outline-none focus:border-[var(--accent-primary)] transition-colors"
                        placeholder="-77.1234"
                      />
                    </div>
                  </div>
                  {/* Fila 2: Código */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-semibold text-[var(--text-muted)] uppercase">Código</label>
                    <input
                      type="text"
                      value={manualData.cod_componente}
                      onChange={(e) => handleManualChange('cod_componente', e.target.value)}
                      className="bg-[var(--bg-input)] border border-[var(--border-medium)] rounded text-[11px] px-2 py-1 text-[var(--text-primary)] w-full outline-none focus:border-[var(--accent-primary)] transition-colors"
                      placeholder="Ej. UBI-001"
                    />
                  </div>
                  {/* Fila 3: Dirección */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-semibold text-[var(--text-muted)] uppercase">Dirección</label>
                    <input
                      type="text"
                      value={manualData.direccion}
                      onChange={(e) => handleManualChange('direccion', e.target.value)}
                      className="bg-[var(--bg-input)] border border-[var(--border-medium)] rounded text-[11px] px-2 py-1 text-[var(--text-primary)] w-full outline-none focus:border-[var(--accent-primary)] transition-colors"
                      placeholder="Ej. Av. Principal 123"
                    />
                  </div>
                  {/* Fila 4: Localidad y Distrito */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-semibold text-[var(--text-muted)] uppercase">Localidad</label>
                      <input
                        type="text"
                        value={manualData.localidad}
                        onChange={(e) => handleManualChange('localidad', e.target.value)}
                        className="bg-[var(--bg-input)] border border-[var(--border-medium)] rounded text-[11px] px-2 py-1 text-[var(--text-primary)] w-full outline-none focus:border-[var(--accent-primary)] transition-colors"
                        placeholder="Urb. Los Pinos"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-semibold text-[var(--text-muted)] uppercase">Distrito</label>
                      <input
                        type="text"
                        value={manualData.distrito}
                        onChange={(e) => handleManualChange('distrito', e.target.value)}
                        className="bg-[var(--bg-input)] border border-[var(--border-medium)] rounded text-[11px] px-2 py-1 text-[var(--text-primary)] w-full outline-none focus:border-[var(--accent-primary)] transition-colors"
                        placeholder="San Isidro"
                      />
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* ── Carpeta de Destino ── */}
            <section className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Carpeta de Destino
              </label>
              <button
                onClick={handleSelectOutputDir}
                className={`flex items-center gap-2 w-full rounded-lg border px-3 py-2 text-left transition-all duration-200 ${
                  outputDir
                    ? 'border-[var(--accent-green)]/25 bg-[var(--accent-green)]/[0.06]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-elevated)]'
                }`}
              >
                <Folder
                  size={14}
                  className={`shrink-0 ${outputDir ? 'text-[var(--accent-green)]' : 'text-[var(--text-muted)]'}`}
                />
                <div className="flex flex-col min-w-0 flex-1">
                  <span
                    className={`text-[11px] font-medium truncate ${
                      outputDir ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {folderName || 'Seleccionar carpeta...'}
                  </span>
                  {outputDir && (
                    <span className="text-[9px] text-[var(--text-muted)] truncate">{outputDir}</span>
                  )}
                </div>
              </button>
            </section>

            {/* ── Orientación + Modo de Salida ── */}
            <section className="flex flex-col gap-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Orientación
                </label>
                <SegmentedControl
                  value={formato}
                  onChange={(v) => setFormato(v as 'vertical' | 'horizontal')}
                  options={[
                    { value: 'vertical', label: <>↕ Vertical</> },
                    { value: 'horizontal', label: <>↔ Horizontal</> },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Modo de Salida
                </label>
                <SegmentedControl
                  value={outputMode}
                  onChange={(v) => setOutputMode(v as OutputMode)}
                  options={[
                    { value: 'individual', label: <><Files size={12} /> Individual</> },
                    { value: 'consolidado', label: <><FileOutput size={12} /> Consolidado</> },
                  ]}
                />
              </div>
            </section>

            {/* ── Personalización de Diseño ── */}
            <div className="border-t border-[var(--border-subtle)] pt-3">
              <button
                type="button"
                onClick={() => setDesignOpen(o => !o)}
                className="flex items-center justify-between w-full text-left group"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] transition-colors">
                  Personalización de Diseño
                </span>
                <ChevronRight size={13} className={`text-[var(--text-muted)] transition-transform duration-200 ${designOpen ? 'rotate-90' : ''}`} />
              </button>

              {designOpen && (
                <div className="mt-2 space-y-2">
                  {/* Tab buttons */}
                  <div className="flex gap-0.5 rounded-lg bg-[var(--bg-input)] p-0.5">
                    {(['texts', 'pin', 'map'] as const).map(tab => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setDesignTab(tab)}
                        className={`flex-1 text-[10px] font-medium py-1 rounded-md transition-all ${
                          designTab === tab
                            ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                        }`}
                      >
                        {tab === 'texts' ? 'Textos' : tab === 'pin' ? 'Pin' : 'Mapa'}
                      </button>
                    ))}
                  </div>

                  {designTab === 'texts' && (
                    <div className="space-y-1.5">
                      {TEXT_FIELDS.map(f => {
                        const style = customStyles.texts[f.key];
                        return (
                          <div key={f.key} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-medium text-[var(--text-primary)]">{f.label}</span>
                              <div className="flex items-center gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => updateStyle(s => ({
                                    ...s,
                                    texts: {
                                      ...s.texts,
                                      [f.key]: { ...s.texts[f.key], bold: !s.texts[f.key].bold }
                                    }
                                  }))}
                                  className={`w-5 h-5 rounded text-[9px] font-bold transition-all ${style.bold ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]' : 'bg-[var(--bg-input)] text-[var(--text-muted)]'}`}
                                >B</button>
                                <button
                                  type="button"
                                  onClick={() => updateStyle(s => ({
                                    ...s,
                                    texts: {
                                      ...s.texts,
                                      [f.key]: { ...s.texts[f.key], visible: !s.texts[f.key].visible }
                                    }
                                  }))}
                                  className={`w-5 h-5 rounded flex items-center justify-center transition-all ${style.visible ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]' : 'bg-[var(--bg-input)] text-[var(--text-muted)]'}`}
                                ><Eye size={9} /></button>
                              </div>
                            </div>
                            
                            {/* Size + Color row */}
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] text-[var(--text-muted)] w-6 shrink-0">Tam.</span>
                              <input
                                type="range"
                                min={20}
                                max={200}
                                step={5}
                                value={style.fontSize ?? (f.key === 'cod_componente' ? 120 : 60)}
                                onChange={e => updateStyle(s => ({
                                  ...s,
                                  texts: {
                                    ...s.texts,
                                    [f.key]: { ...s.texts[f.key], fontSize: +e.target.value }
                                  }
                                }))}
                                className="flex-1 h-1 accent-[var(--accent-primary)]"
                              />
                              <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-6 text-right">{style.fontSize ?? (f.key === 'cod_componente' ? 120 : 60)}</span>
                                <input
                                  type="color"
                                  value={style.color ?? '#000000'}
                                  onChange={e => updateStyle(s => ({
                                    ...s,
                                    texts: {
                                      ...s.texts,
                                      [f.key]: { ...s.texts[f.key], color: e.target.value }
                                    }
                                  }))}
                                  className="w-5 h-5 p-0 border-none bg-transparent rounded cursor-pointer shrink-0"
                                />
                              </div>

                            {/* Offsets row */}
                            <div className="flex gap-4">
                              <div className="flex-1 min-w-0 flex items-center gap-2">
                                <span className="text-[9px] text-[var(--text-muted)] shrink-0">X</span>
                                <input
                                  type="range"
                                  min={-300}
                                  max={300}
                                  value={style.offsetX ?? 0}
                                  onChange={e => updateStyle(s => ({
                                    ...s,
                                    texts: {
                                      ...s.texts,
                                      [f.key]: { ...s.texts[f.key], offsetX: +e.target.value }
                                    }
                                  }))}
                                  className="flex-1 h-1 accent-[var(--accent-primary)] min-w-0"
                                />
                                <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-6 text-right shrink-0">{style.offsetX ?? 0}</span>
                              </div>
                              <div className="flex-1 min-w-0 flex items-center gap-2">
                                <span className="text-[9px] text-[var(--text-muted)] shrink-0">Y</span>
                                <input
                                  type="range"
                                  min={-300}
                                  max={300}
                                  value={style.offsetY ?? 0}
                                  onChange={e => updateStyle(s => ({
                                    ...s,
                                    texts: {
                                      ...s.texts,
                                      [f.key]: { ...s.texts[f.key], offsetY: +e.target.value }
                                    }
                                  }))}
                                  className="flex-1 h-1 accent-[var(--accent-primary)] min-w-0"
                                />
                                <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-6 text-right shrink-0">{style.offsetY ?? 0}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {designTab === 'pin' && (
                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium text-[var(--text-primary)]">Visibilidad</span>
                        <button
                          type="button"
                          onClick={() => updateStyle(s => ({ ...s, pin: { ...s.pin, visible: !s.pin.visible } }))}
                          className={`w-5 h-5 rounded flex items-center justify-center transition-all ${customStyles.pin.visible !== false ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]' : 'bg-[var(--bg-input)] text-[var(--text-muted)]'}`}
                        >
                          <Eye size={9} />
                        </button>
                      </div>

                      {/* Color presets */}
                      <div className="space-y-1">
                        <span className="text-[9px] text-[var(--text-muted)] block">Color del Pin</span>
                        <div className="flex flex-wrap gap-1">
                          {PIN_PRESETS.map((presetColor, idx) => (
                            <WithHoverTooltip
                              key={idx}
                              label={presetColor ? `Color: ${presetColor}` : 'Color original (rojo)'}
                              placement="bottom"
                            >
                              <button
                                type="button"
                                onClick={() => updateStyle(s => ({ ...s, pin: { ...s.pin, color: presetColor } }))}
                                aria-label={presetColor ? `Color: ${presetColor}` : 'Color original (rojo)'}
                                className={`w-4.5 h-4.5 rounded-full border transition-all cursor-pointer ${
                                  (customStyles.pin.color ?? '') === presetColor
                                    ? 'border-[var(--accent-primary)] scale-110 shadow-sm'
                                    : 'border-[var(--border-subtle)] hover:scale-105'
                                }`}
                                style={{ backgroundColor: presetColor || '#4B5563', width: 18, height: 18 }}
                              />
                            </WithHoverTooltip>
                          ))}
                        </div>
                      </div>

                      {/* Scale */}
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-[var(--text-muted)] w-7 shrink-0">Escala</span>
                        <input
                          type="range"
                          min={0.05}
                          max={0.30}
                          step={0.01}
                          value={customStyles.pin.scale ?? 0.15}
                          onChange={e => updateStyle(s => ({ ...s, pin: { ...s.pin, scale: +e.target.value } }))}
                          className="flex-1 h-1 accent-[var(--accent-primary)]"
                        />
                        <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-7 text-right">
                          {(customStyles.pin.scale ?? 0.15).toFixed(2)}
                        </span>
                      </div>

                      {/* Pin Offsets */}
                      <div className="flex gap-4">
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <span className="text-[9px] text-[var(--text-muted)] shrink-0">X</span>
                          <input
                            type="range"
                            min={-300}
                            max={300}
                            value={customStyles.pin.offsetX ?? 0}
                            onChange={e => updateStyle(s => ({ ...s, pin: { ...s.pin, offsetX: +e.target.value } }))}
                            className="flex-1 h-1 accent-[var(--accent-primary)] min-w-0"
                          />
                          <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-6 text-right shrink-0">
                            {customStyles.pin.offsetX ?? 0}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <span className="text-[9px] text-[var(--text-muted)] shrink-0">Y</span>
                          <input
                            type="range"
                            min={-300}
                            max={300}
                            value={customStyles.pin.offsetY ?? 0}
                            onChange={e => updateStyle(s => ({ ...s, pin: { ...s.pin, offsetY: +e.target.value } }))}
                            className="flex-1 h-1 accent-[var(--accent-primary)] min-w-0"
                          />
                          <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-6 text-right shrink-0">
                            {customStyles.pin.offsetY ?? 0}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {designTab === 'map' && (
                    <div className="space-y-1.5">
                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 space-y-2">
                        <span className="text-[10px] font-medium text-[var(--text-primary)] block">Capa y Zoom</span>
                        
                        {/* Map Provider */}
                        <div className="space-y-0.5">
                          <label className="text-[9px] text-[var(--text-muted)]">Proveedor</label>
                          <ThemedSelect
                            value={provider}
                            onChange={updateProvider}
                            aria-label="Proveedor de mapa"
                            options={MAP_PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
                          />
                        </div>

                        {MAP_PROVIDER_BY_ID[provider]?.needsKey && (
                          <div className="space-y-0.5">
                            <label className="text-[9px] text-[var(--text-muted)] flex justify-between">
                              <span>API Key ({MAP_PROVIDER_BY_ID[provider]?.label ?? provider})</span>
                              {MAP_PROVIDER_BY_ID[provider]?.helpUrl && (
                              <span
                                className="text-[8px] text-[var(--accent-primary)] hover:underline cursor-pointer"
                                onClick={() => {
                                  window.open(MAP_PROVIDER_BY_ID[provider].helpUrl, '_blank');
                                }}
                              >
                                ¿Cómo obtenerla?
                              </span>
                              )}
                            </label>
                            <input
                              type="password"
                              value={apiKeys[provider] || ''}
                              onChange={e => {
                                const value = e.target.value;
                                setApiKeys((prev) => {
                                  const next = { ...prev, [provider]: value };
                                  lastParamsRef.current = { ...lastParamsRef.current, apiKeys: next };
                                  return next;
                                });
                                scheduleApiKeyPreview();
                              }}
                              placeholder={
                                keysConfigured[provider]
                                  ? 'Clave guardada — escribe una nueva para reemplazarla'
                                  : `Pega tu llave de ${MAP_PROVIDER_BY_ID[provider]?.label ?? provider} aquí...`
                              }
                              className="w-full bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[10px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]"
                            />
                          </div>
                        )}

                        {/* Zoom */}
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-[var(--text-muted)] w-8 shrink-0">Zoom</span>
                          <input
                            type="range"
                            min={12}
                            max={20}
                            step={1}
                            value={zoom}
                            onChange={e => updateZoom(+e.target.value)}
                            className="flex-1 h-1 accent-[var(--accent-primary)]"
                          />
                          <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-5 text-right">
                            {zoom}
                          </span>
                        </div>
                      </div>

                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 space-y-1.5">
                        <span className="text-[10px] font-medium text-[var(--text-primary)] block">Filtro de Contraste</span>
                        
                        {/* Overlay Color */}
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-[var(--text-muted)] w-7 shrink-0">Color</span>
                          <input
                            type="color"
                            value={customStyles.map.overlayColor ?? '#F6F6F6'}
                            onChange={e => updateStyle(s => ({ ...s, map: { ...s.map, overlayColor: e.target.value } }))}
                            className="w-5 h-5 rounded border border-[var(--border-subtle)] cursor-pointer"
                          />
                          <span className="text-[9px] text-[var(--text-muted)] font-mono">{customStyles.map.overlayColor ?? '#F6F6F6'}</span>
                        </div>

                        {/* Overlay Alpha */}
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-[var(--text-muted)] w-7 shrink-0">Opacidad</span>
                          <input
                            type="range"
                            min={0}
                            max={255}
                            value={customStyles.map.overlayAlpha ?? 120}
                            onChange={e => updateStyle(s => ({ ...s, map: { ...s.map, overlayAlpha: +e.target.value } }))}
                            className="flex-1 h-1 accent-[var(--accent-primary)]"
                          />
                          <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-5 text-right">
                            {customStyles.map.overlayAlpha ?? 120}
                          </span>
                        </div>
                      </div>

                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 space-y-1.5">
                        <span className="text-[10px] font-medium text-[var(--text-primary)] block">Distribución</span>
                        
                        {/* yStart */}
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-[var(--text-muted)] w-10 shrink-0">Inicio Y</span>
                          <input
                            type="range"
                            min={50}
                            max={400}
                            value={customStyles.layout.yStart ?? 120}
                            onChange={e => updateStyle(s => ({ ...s, layout: { ...s.layout, yStart: +e.target.value } }))}
                            className="flex-1 h-1 accent-[var(--accent-primary)]"
                          />
                          <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-5 text-right">
                            {customStyles.layout.yStart ?? 120}
                          </span>
                        </div>

                        {/* lineSpacing */}
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-[var(--text-muted)] w-10 shrink-0">Espaciado</span>
                          <input
                            type="range"
                            min={80}
                            max={400}
                            value={customStyles.layout.lineSpacing ?? 180}
                            onChange={e => updateStyle(s => ({ ...s, layout: { ...s.layout, lineSpacing: +e.target.value } }))}
                            className="flex-1 h-1 accent-[var(--accent-primary)]"
                          />
                          <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-5 text-right">
                            {customStyles.layout.lineSpacing ?? 180}
                          </span>
                        </div>

                        {/* lineGap */}
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-[var(--text-muted)] w-10 shrink-0">Separación</span>
                          <input
                            type="range"
                            min={0.3}
                            max={1.5}
                            step={0.1}
                            value={customStyles.layout.lineGap ?? 0.7}
                            onChange={e => updateStyle(s => ({ ...s, layout: { ...s.layout, lineGap: +e.target.value } }))}
                            className="flex-1 h-1 accent-[var(--accent-primary)]"
                          />
                          <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-5 text-right">
                            {(customStyles.layout.lineGap ?? 0.7).toFixed(1)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={resetStyles}
                    className="w-full text-[9px] text-[var(--text-muted)] hover:text-[var(--accent-red)] py-1 transition-colors"
                  >
                    Restaurar valores por defecto
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Sticky Generate Button (fixed bottom) */}
        <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-2">
          <Button className="w-full" disabled={!canGenerate} onClick={handleGenerate}>
            {isProcessing ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Procesando...
              </>
            ) : (
              <>
                <Upload size={14} />
                {outputMode === 'consolidado' ? 'Generar PDF Consolidado' : 'Generar PDFs'}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ── Main: Preview & Results ── */}
      <div className="flex-1 flex flex-col bg-[var(--bg-elevated)] overflow-hidden">
        {result ? (
          <ResultPanel result={result} outputDir={outputDir} />
        ) : hasData ? (
          <RealPreviewPanel
            preview={preview}
            loading={previewLoading}
            error={previewError}
            rowIndex={previewRowIndex}
            totalFilas={inputMode === 'excel' ? totalFilas : 1}
            isProcessing={isProcessing}
            onPrev={handlePrevRow}
            onNext={handleNextRow}
            onRefresh={() => triggerPreviewFetch(previewRowIndex)}
            inputMode={inputMode}
            manualData={manualData}
          />
        ) : (
          <EmptyPreviewPanel formato={formato} />
        )}
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────
// Empty Preview (no Excel loaded yet)
// ──────────────────────────────────────────────
const EmptyPreviewPanel: React.FC<{ formato: string }> = ({ formato }) => (
  <div className="flex-1 flex flex-col overflow-hidden">
    <div className="shrink-0 flex items-center gap-2.5 px-5 h-11 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]">
      <Eye size={18} className="text-[var(--accent-primary)] shrink-0" />
      <span className="text-sm font-semibold text-[var(--text-primary)]">Vista Previa de Plantilla</span>
    </div>
    <div className="flex-1 flex flex-col items-center justify-center p-8">
    <div
      className={`relative bg-[var(--bg-input)] shadow-inner overflow-hidden flex flex-col transition-all duration-500 rounded-lg border border-[var(--border-subtle)] ${
        formato === 'vertical' ? 'w-48 h-64' : 'w-64 h-48'
      }`}
    >
      {/* Dotted background pattern using CSS variable */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg width=\'20\' height=\'20\' viewBox=\'0 0 20 20\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23666666\' fill-opacity=\'0.5\' fill-rule=\'evenodd\'%3E%3Ccircle cx=\'3\' cy=\'3\' r=\'3\'/%3E%3Ccircle cx=\'13\' cy=\'13\' r=\'3\'/%3E%3C/g%3E%3C/svg%3E")',
        }}
      />
      <div className="absolute inset-0 bg-[var(--bg-base)]/30" />
      <div className="relative z-10 flex flex-col items-center w-full h-full p-2">
        <div className="w-3/4 h-2.5 bg-[var(--text-primary)] rounded-sm mt-2 mb-3" />
        <div className="w-5/6 h-1.5 bg-[var(--text-secondary)] rounded-sm mb-1" />
        <div className="w-1/2 h-1.5 bg-[var(--text-secondary)] rounded-sm mb-1" />
        <div className="w-2/3 h-1.5 bg-[var(--text-secondary)] rounded-sm mb-3" />
        <div className="flex-1 flex items-center justify-center">
          <MapPin className="w-7 h-7 text-[var(--accent-primary)] drop-shadow-md" fill="currentColor" />
        </div>
        <div className="w-full h-5 bg-[var(--bg-base)] mt-auto rounded-sm flex items-center justify-center">
          <div className="w-1/2 h-1 bg-[var(--text-muted)] rounded-full" />
        </div>
      </div>
    </div>
      <p className="text-[11px] text-[var(--text-muted)] mt-6 max-w-xs text-center leading-relaxed">
        Sube un Excel para ver la vista previa real del resultado.
      </p>
    </div>
  </div>
);

// ──────────────────────────────────────────────
// Real Preview Panel (with actual generated image)
// ──────────────────────────────────────────────
const RealPreviewPanel: React.FC<{
  preview: PreviewData;
  loading: boolean;
  error: string | null;
  rowIndex: number;
  totalFilas: number;
  isProcessing: boolean;
  onPrev: () => void;
  onNext: () => void;
  onRefresh: () => void;
  inputMode?: 'excel' | 'manual';
  manualData?: {
    cod_componente: string;
    direccion: string;
    localidad: string;
    distrito: string;
  };
}> = ({
  preview,
  loading,
  error,
  rowIndex,
  totalFilas,
  isProcessing,
  onPrev,
  onNext,
  onRefresh,
  inputMode = 'excel',
  manualData,
}) => {
  const meta = inputMode === 'manual' && manualData
    ? manualData
    : preview
      ? {
          cod_componente: preview.cod_componente,
          direccion: preview.direccion,
          localidad: preview.localidad,
          distrito: preview.distrito,
        }
      : null;
  const showMeta = meta && (
    meta.cod_componente || meta.direccion || meta.localidad || meta.distrito
  );

  return (
  <div className="flex-1 flex flex-col overflow-hidden">
    {/* Toolbar — h-11 matches sidebar title bar for horizontal alignment */}
    <div className="shrink-0 flex items-center justify-between px-5 h-11 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]">
      <div className="flex items-center gap-2.5">
        <Eye size={18} className="text-[var(--accent-primary)] shrink-0" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">Vista Previa Real</span>
      </div>

      {(inputMode === 'excel' ? totalFilas > 0 : true) && (
        <div className="flex items-center gap-1">
          {inputMode === 'excel' && totalFilas > 0 && (
            <>
              <button
                onClick={onPrev}
                disabled={rowIndex === 0 || loading}
                aria-label="Fila anterior"
                className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-[11px] text-[var(--text-muted)] tabular-nums min-w-[3rem] text-center">
                {rowIndex + 1} / {totalFilas}
              </span>
              <button
                onClick={onNext}
                disabled={rowIndex >= totalFilas - 1 || loading}
                aria-label="Fila siguiente"
                className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]"
              >
                <ChevronRight size={16} />
              </button>
            </>
          )}
          <WithHoverTooltip label="Actualizar vista previa" placement="bottom">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              aria-label="Actualizar vista previa"
              className="ml-1.5 p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]"
            >
              <Loader2 size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </WithHoverTooltip>
        </div>
      )}

    </div>

    {/* Preview Content */}
    <div className="flex-1 overflow-hidden flex items-center justify-center bg-[var(--bg-elevated)] p-6 relative">
      {error ? (
        <div className="flex flex-col items-center gap-3 max-w-sm">
          <div className="w-12 h-12 rounded-full bg-[var(--accent-red)]/15 flex items-center justify-center">
            <AlertCircle size={24} className="text-[var(--accent-red)]" />
          </div>
          <p className="text-sm font-medium text-[var(--accent-red)]">Error en vista previa</p>
          <p className="text-xs text-[var(--text-muted)] text-center break-words leading-relaxed">{error}</p>
          <button
            type="button"
            onClick={onRefresh}
            className="mt-1 text-[11px] font-medium text-[var(--accent-primary)] hover:underline"
          >
            Reintentar
          </button>
        </div>
      ) : preview ? (
        <div className="flex flex-col items-center gap-4 w-full h-full relative">
          <div className="flex-1 w-full flex items-center justify-center overflow-hidden relative">
            {loading && (
              <div className="absolute top-3 right-3 z-10 flex items-center gap-2 rounded-lg bg-[var(--bg-base)]/90 border border-[var(--border-subtle)] px-2.5 py-1.5 shadow-sm">
                <Loader2 size={14} className="animate-spin text-[var(--accent-primary)]" />
                <span className="text-[10px] text-[var(--text-muted)]">Actualizando...</span>
              </div>
            )}
            <img
              src={preview.image}
              alt={`Ubicacion ${preview.cod_componente}`}
              className="w-full h-full object-contain rounded-xl shadow-2xl border border-[var(--border-subtle)] transition-opacity duration-150"
              style={{ opacity: loading ? 0.85 : 1 }}
            />
          </div>
          {/* Metadata bar - below image */}
          {showMeta && (
          <div className="flex items-center gap-3 shrink-0 px-4 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] max-w-full overflow-hidden">
            <span className="text-sm font-bold text-[var(--text-primary)] shrink-0">{meta!.cod_componente || '—'}</span>
            <span className="text-xs text-[var(--text-muted)] shrink-0">|</span>
            <span className="text-xs text-[var(--text-secondary)] truncate">{meta!.direccion || '—'}</span>
            <span className="text-xs text-[var(--text-muted)] shrink-0">|</span>
            <span className="text-[11px] text-[var(--text-muted)] shrink-0">
              {meta!.localidad || '—'} - {meta!.distrito || '—'}
            </span>
          </div>
          )}
          {isProcessing && (
            <div className="flex items-center gap-2 text-[var(--text-secondary)] shrink-0">
              <Loader2 size={14} className="animate-spin text-[var(--accent-primary)]" />
              <span className="text-xs">Generando PDFs...</span>
            </div>
          )}
        </div>
      ) : loading ? (
        <div className="flex flex-col items-center gap-4 w-full h-full">
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <Loader2 size={32} className="animate-spin text-[var(--accent-primary)]" />
            <p className="text-xs text-[var(--text-muted)]">Cargando mapa...</p>
          </div>
          {showMeta && (
            <div className="flex items-center gap-3 shrink-0 px-4 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] max-w-full overflow-hidden">
              <span className="text-sm font-bold text-[var(--text-primary)] shrink-0">{meta!.cod_componente || '—'}</span>
              <span className="text-xs text-[var(--text-muted)] shrink-0">|</span>
              <span className="text-xs text-[var(--text-secondary)] truncate">{meta!.direccion || '—'}</span>
              <span className="text-xs text-[var(--text-muted)] shrink-0">|</span>
              <span className="text-[11px] text-[var(--text-muted)] shrink-0">
                {meta!.localidad || '—'} - {meta!.distrito || '—'}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 max-w-xs text-center">
          <MapPin size={28} className="text-[var(--text-muted)]" />
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            {inputMode === 'manual'
              ? 'Ingresa latitud y longitud válidas para ver la vista previa del mapa.'
              : 'Carga un Excel para ver la vista previa real del resultado.'}
          </p>
        </div>
      )}
    </div>
  </div>
  );
};

// ──────────────────────────────────────────────
// Result Panel
// ──────────────────────────────────────────────
export const ResultPanel: React.FC<{ result: Result; outputDir: string }> = ({ result, outputDir }) => {
  if (!result) return null;

  if (result.success) {
    const isConsolidado = result.data?.consolidado;
    const generados = result.data?.generados ?? 0;
    const fallidos = result.data?.fallidos ?? 0;
    const allFailed = generados === 0 && fallidos > 0;
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-5 ${allFailed ? 'bg-[var(--accent-yellow)]/15' : 'bg-[var(--accent-green)]/15'}`}>
          {allFailed ? (
            <AlertCircle size={32} className="text-amber-400" />
          ) : (
            <CheckCircle2 size={32} className="text-[var(--accent-green)]" />
          )}
        </div>
        <p className="text-lg font-semibold text-[var(--text-primary)] mb-1">
          {allFailed ? 'Proceso completado con errores' : 'Proceso completado'}
        </p>
        <p className="text-sm text-[var(--text-muted)] mb-5">
          {isConsolidado ? (
            <>
              Se generó <span className="font-bold text-[var(--accent-green)]">1 PDF consolidado</span> con{' '}
              <span className="font-bold text-[var(--accent-green)]">{generados} páginas</span>
            </>
          ) : (
            <>
              Se generaron{' '}
              <span className="font-bold text-[var(--accent-green)]">{generados} PDFs</span>
            </>
          )}
        </p>
        {fallidos > 0 && (
          <p className="text-sm text-amber-400 mb-5">
            {fallidos} fila{fallidos !== 1 ? 's' : ''} omitida{fallidos !== 1 ? 's' : ''} por error
          </p>
        )}
        <div className="max-w-md w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Folder size={14} className="text-[var(--text-muted)] shrink-0" />
            <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              Carpeta de salida
            </span>
          </div>
          <p className="text-xs font-mono text-[var(--text-secondary)] break-all leading-relaxed">
            {result.data?.outputDir || outputDir}
          </p>
          {isConsolidado && result.data?.consolidatedPath && (
            <p className="text-xs font-mono text-[var(--text-secondary)] break-all leading-relaxed mt-2">
              {String(result.data.consolidatedPath).split(/[/\\]/).pop()}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="w-16 h-16 rounded-full bg-[var(--accent-red)]/15 flex items-center justify-center mb-5">
        <AlertCircle size={32} className="text-[var(--accent-red)]" />
      </div>
      <p className="text-lg font-semibold text-[var(--accent-red)] mb-3">Error</p>
      <div className="max-w-md w-full rounded-xl border border-[var(--accent-red)]/20 bg-[var(--accent-red)]/5 p-4">
        <p className="text-sm text-[var(--accent-red)]/90 break-words leading-relaxed">{result.error}</p>
      </div>
    </div>
  );
};
