import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ACCEPTED_IMAGE_TYPES,
  DEFAULT_TITLE,
  IMAGES_PER_PAGE,
  MAX_IMAGE_BYTES,
  MAX_LOGO_BYTES,
  MSG_IMAGE_TOO_LARGE,
  MSG_LOGO_INVALID,
  MSG_LOGO_TOO_LARGE,
  chunkArray,
} from '../constants';
import type { CuadranteRange, EvidenciaSession, LocalImage, LogoAsset } from '../types';
import {
  clampAllRanges,
  createDefaultRange,
  resolveCuadranteForPage,
} from '../utils/cuadranteRanges';
import { loadSession, saveSession, storedToSession } from '../utils/storage';

const SAVE_DEBOUNCE_MS = 400;

function revokeImages(images: LocalImage[]) {
  images.forEach((img) => URL.revokeObjectURL(img.objectUrl));
}

function revokeLogo(logo: LogoAsset | null) {
  if (logo) URL.revokeObjectURL(logo.objectUrl);
}

export function useEvidenciaSession() {
  const [title, setTitleState] = useState(DEFAULT_TITLE);
  const [cuadranteRanges, setCuadranteRangesState] = useState<CuadranteRange[]>(() => [createDefaultRange()]);
  const [logoLeft, setLogoLeftState] = useState<LogoAsset | null>(null);
  const [logoRight, setLogoRightState] = useState<LogoAsset | null>(null);
  const [images, setImages] = useState<LocalImage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imagesRef = useRef(images);
  const logoLeftRef = useRef(logoLeft);
  const logoRightRef = useRef(logoRight);
  imagesRef.current = images;
  logoLeftRef.current = logoLeft;
  logoRightRef.current = logoRight;

  const validateLogo = useCallback((file: File): string | null => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return MSG_LOGO_INVALID;
    if (file.size > MAX_LOGO_BYTES) return MSG_LOGO_TOO_LARGE;
    return null;
  }, []);

  const scheduleSave = useCallback((session: EvidenciaSession) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void saveSession(session);
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const buildSession = useCallback((): EvidenciaSession => ({
    title,
    cuadranteRanges,
    logoLeft,
    logoRight,
    images,
    updatedAt: Date.now(),
  }), [title, cuadranteRanges, logoLeft, logoRight, images]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadSession();
      if (cancelled) return;
      if (stored) {
        const restored = storedToSession(stored);
        setTitleState(restored.title);
        setCuadranteRangesState(restored.cuadranteRanges);
        setLogoLeftState(restored.logoLeft);
        setLogoRightState(restored.logoRight);
        setImages(restored.images);
      }
      setIsLoaded(true);
    })();
    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    scheduleSave(buildSession());
  }, [isLoaded, buildSession, scheduleSave]);

  useEffect(() => () => {
    revokeImages(imagesRef.current);
    revokeLogo(logoLeftRef.current);
    revokeLogo(logoRightRef.current);
  }, []);

  const pages = useMemo(() => {
    if (images.length === 0) return [[]];
    return chunkArray(images, IMAGES_PER_PAGE);
  }, [images]);

  const totalPages = pages.length;

  useEffect(() => {
    if (currentPageIndex > totalPages - 1) {
      setCurrentPageIndex(Math.max(0, totalPages - 1));
    }
  }, [currentPageIndex, totalPages]);

  useEffect(() => {
    setCuadranteRangesState((prev) => clampAllRanges(prev, totalPages));
  }, [totalPages]);

  const currentPageImages = pages[currentPageIndex] ?? [];
  const currentCuadrante = resolveCuadranteForPage(currentPageIndex + 1, cuadranteRanges);

  const setTitle = useCallback((value: string) => setTitleState(value), []);

  const setCuadranteRanges = useCallback((ranges: CuadranteRange[]) => {
    setCuadranteRangesState(ranges);
  }, []);

  const addCuadranteRange = useCallback(() => {
    setCuadranteRangesState((prev) => {
      const last = prev[prev.length - 1];
      const nextFrom = last ? Math.min(last.toPage + 1, totalPages) : 1;
      return [...prev, createDefaultRange(nextFrom, Math.max(nextFrom, totalPages))];
    });
  }, [totalPages]);

  const setLogo = useCallback((side: 'left' | 'right', file: File | null): string | null => {
    const current = side === 'left' ? logoLeft : logoRight;
    const setter = side === 'left' ? setLogoLeftState : setLogoRightState;
    revokeLogo(current);
    if (!file) {
      setter(null);
      return null;
    }
    const err = validateLogo(file);
    if (err) return err;
    setter({ file, objectUrl: URL.createObjectURL(file) });
    return null;
  }, [logoLeft, logoRight, validateLogo]);

  const addImages = useCallback((files: File[]): string[] => {
    const errors: string[] = [];
    const accepted: LocalImage[] = [];
    for (const file of files) {
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        errors.push(`Formato no admitido: ${file.name}`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        errors.push(MSG_IMAGE_TOO_LARGE(file.name));
        continue;
      }
      const localPath = window.electronAPI?.getPathForFile?.(file) || undefined;
      accepted.push({ file, objectUrl: URL.createObjectURL(file), localPath });
    }
    if (accepted.length > 0) {
      setImages((prev) => [...prev, ...accepted]);
    }
    return errors;
  }, []);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.objectUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const clearImages = useCallback(() => {
    setImages((prev) => {
      revokeImages(prev);
      return [];
    });
    setCurrentPageIndex(0);
  }, []);

  const resolveCuadrante = useCallback(
    (pageNum: number) => resolveCuadranteForPage(pageNum, cuadranteRanges),
    [cuadranteRanges],
  );

  return {
    title,
    cuadranteRanges,
    currentCuadrante,
    logoLeft,
    logoRight,
    images,
    pages,
    currentPageIndex,
    currentPageImages,
    totalPages,
    isExporting,
    setTitle,
    setCuadranteRanges,
    addCuadranteRange,
    setLogo,
    addImages,
    removeImage,
    clearImages,
    resolveCuadrante,
    setCurrentPageIndex,
    setIsExporting,
  };
}