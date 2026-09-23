import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../api';
import { isValidCoord } from '../../utils/coords';
import { stageFileForIpc } from '../../utils/stageFile';
import {
  resolvePreviewImageSrc,
  type CustomStyles,
  type ManualData,
  type OutputMode,
  type PreviewData,
} from './ubicacionesTypes';

export interface UbicacionesPreviewDeps {
  excelPath: string;
  inputMode: 'excel' | 'manual';
  manualData: ManualData;
  formato: 'vertical' | 'horizontal';
  outputDir: string;
  outputMode: OutputMode;
  customStyles: CustomStyles;
  provider: string;
  zoom: number;
  apiKeys: Record<string, string>;
  geocode: boolean;
  geocodeCountry: string;
}

export function hasManualAddress(data: ManualData): boolean {
  return Boolean(data.direccion?.trim() || data.localidad?.trim() || data.distrito?.trim());
}

export type PreviewFetchOptions = {
  recomposeOnly?: boolean;
  softLoad?: boolean;
  excelPathOverride?: string;
};

type LastParams = UbicacionesPreviewDeps & { previewRowIndex: number };

export function useUbicacionesPreview(deps: UbicacionesPreviewDeps) {
  const {
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
    geocode,
    geocodeCountry,
  } = deps;

  const [preview, setPreview] = useState<PreviewData>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRowIndex, setPreviewRowIndex] = useState(0);
  const [totalFilas, setTotalFilas] = useState(0);

  const fetchIdRef = useRef(0);
  const mountedRef = useRef(true);
  const excelFileRef = useRef<File | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stylePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasPreviewRef = useRef(false);
  const prevFormatoRef = useRef(formato);

  const lastParamsRef = useRef<LastParams>({ ...deps, previewRowIndex });

  const syncParams = useCallback((patch: Partial<LastParams>) => {
    lastParamsRef.current = { ...lastParamsRef.current, ...patch };
  }, []);

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
      geocode,
      geocodeCountry,
      previewRowIndex,
    };
  }, [excelPath, inputMode, manualData, formato, outputDir, outputMode, customStyles, provider, zoom, apiKeys, geocode, geocodeCountry, previewRowIndex]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      fetchIdRef.current += 1;
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
    hasPreviewRef.current = !!preview;
  }, [preview]);

  const fetchPreview = useCallback(
    async (
      rowIndex: number,
      options?: PreviewFetchOptions,
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
        geocode: currentGeocode,
        geocodeCountry: currentGeocodeCountry,
      } = lastParamsRef.current;

      const path = options?.excelPathOverride ?? pathFromState;
      if (currentInputMode === 'excel' && !path) return;
      if (
        currentInputMode === 'manual'
        && (!isValidCoord(currentManualData.lat) || !isValidCoord(currentManualData.lon))
        && !(currentGeocode && hasManualAddress(currentManualData))
      ) {
        return;
      }

      let excelToken = path;
      if (currentInputMode === 'excel' && excelFileRef.current) {
        const fresh = await stageFileForIpc(excelFileRef.current);
        if (fresh) excelToken = fresh;
      }
      if (currentInputMode === 'excel' && !excelToken) return;

      const myId = ++fetchIdRef.current;
      const softLoad =
        (options?.softLoad === true || options?.recomposeOnly === true) && hasPreviewRef.current;
      if (!softLoad) {
        setPreviewLoading(true);
      }
      setPreviewError(null);
      try {
        const resp = await api.previewUbicacion({
          excelPath: excelToken || null,
          formato: currentFormato,
          rowIndex,
          recomposeOnly: options?.recomposeOnly === true,
          customStyles: currentStyles as Record<string, unknown>,
          provider: currentProvider,
          zoom: currentZoom,
          api_key: currentApiKeys[currentProvider] || '',
          manualData: currentInputMode === 'manual' ? currentManualData : undefined,
          geocode: currentGeocode,
          geocodeCountry: currentGeocodeCountry,
        });
        if (myId !== fetchIdRef.current) return;
        if (resp?.total_filas) {
          setTotalFilas(resp.total_filas);
        }
        if (resp?.formato && resp.formato !== currentFormato) return;
        const safeSrc = await resolvePreviewImageSrc(resp);
        if (myId !== fetchIdRef.current) return;
        if (!safeSrc) {
          setPreview(null);
          hasPreviewRef.current = false;
          setPreviewError('No se pudo cargar la imagen de vista previa');
          return;
        }
        setPreview({ ...resp, image: safeSrc });
        hasPreviewRef.current = true;
      } catch (err: unknown) {
        if (myId !== fetchIdRef.current) return;
        setPreviewError(err instanceof Error ? err.message : 'Error de conexion');
      } finally {
        if (myId === fetchIdRef.current) {
          setPreviewLoading(false);
        }
      }
    },
    [],
  );

  const isFetchInFlightRef = useRef(false);
  const hasPendingFetchRef = useRef(false);
  const pendingRowIndexRef = useRef<number | null>(null);
  const pendingOptionsRef = useRef<PreviewFetchOptions | null>(null);

  const triggerPreviewFetch = useCallback(
    (
      targetRowIndex?: number,
      options?: PreviewFetchOptions,
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
        if (!mountedRef.current) return;
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
      const { excelPath: path, inputMode: mode } = lastParamsRef.current;
      if (path || mode === 'manual') {
        triggerPreviewFetch(undefined, { recomposeOnly: true, softLoad: true });
      }
    }, 32);
  }, [triggerPreviewFetch]);

  const scheduleMapRefetch = useCallback(
    (delayMs: number) => {
      if (mapPreviewTimerRef.current) clearTimeout(mapPreviewTimerRef.current);
      mapPreviewTimerRef.current = setTimeout(() => {
        const { excelPath: path, inputMode: mode } = lastParamsRef.current;
        if (path || mode === 'manual') {
          triggerPreviewFetch(undefined, { recomposeOnly: false, softLoad: true });
        }
      }, delayMs);
    },
    [triggerPreviewFetch],
  );

  const schedulePreview = useCallback(
    (
      rowIndex: number,
      options?: PreviewFetchOptions & { debounceMs?: number },
    ) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const { debounceMs, ...fetchOptions } = options ?? {};
      debounceRef.current = setTimeout(() => {
        triggerPreviewFetch(rowIndex, fetchOptions);
      }, debounceMs ?? 150);
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

  useEffect(() => {
    if (
      inputMode === 'manual'
      && (
        (isValidCoord(manualData.lat) && isValidCoord(manualData.lon))
        || (geocode && hasManualAddress(manualData))
      )
    ) {
      triggerPreviewFetch(0);
    }
  }, []);

  const clearPreview = useCallback(() => {
    setPreview(null);
    hasPreviewRef.current = false;
    setPreviewError(null);
  }, []);

  const resetPreview = useCallback(() => {
    clearPreview();
    setPreviewLoading(false);
  }, [clearPreview]);

  const invalidateFetches = useCallback(() => {
    fetchIdRef.current += 1;
  }, []);

  return {
    state: { preview, previewLoading, previewError, previewRowIndex, totalFilas },
    actions: {
      setPreviewRowIndex,
      setTotalFilas,
      setPreviewLoading,
      syncParams,
      triggerPreviewFetch,
      schedulePreview,
      scheduleTextPreview,
      scheduleMapPreview,
      scheduleStylePreview,
      scheduleMapRefetch,
      clearPreview,
      resetPreview,
      invalidateFetches,
    },
    refs: { excelFileRef, lastParamsRef, prevFormatoRef },
  };
}
