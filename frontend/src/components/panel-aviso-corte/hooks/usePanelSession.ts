import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../api';
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_LOGO_BYTES,
  MSG_IMAGE_TOO_LARGE,
  MSG_LOGO_INVALID,
  MSG_LOGO_TOO_LARGE,
} from '../constants';
import type {
  ExcelSource,
  HeaderFormState,
  LocalImage,
  LogoAsset,
  MatchResult,
  MatchRule,
  PanelMatchPanelResponse,
  PanelVM,
} from '../types';
import { registerLocalPath } from '../../../utils/registerLocalPath';
import {
  buildExcelPreviewPanels,
  normalizePanelDateStr,
  resolveDefaultAddressColumn,
  resolveDefaultKeyColumn,
} from '../utils/excelPreview';

export interface PanelSession {
  headerForm: HeaderFormState;
  logoLeft: LogoAsset | null;
  logoRight: LogoAsset | null;
  images: LocalImage[];
  excelSource: ExcelSource | null;
  matchRule: MatchRule;
  addressColumn: string;
  exportMode: 'skip_empty' | 'include_empty';
  matchResult: MatchResult | null;
  currentPageIndex: number;
  isExporting: boolean;
  errors: string[];
  setHeaderForm: (v: HeaderFormState) => void;
  setLogoLeft: (file: File | null) => string | null;
  setLogoRight: (file: File | null) => string | null;
  addImages: (files: File[]) => string[];
  removeImage: (index: number) => void;
  clearImages: () => void;
  setExcelSource: (src: ExcelSource | null) => void;
  setMatchRule: (rule: MatchRule) => void;
  setAddressColumn: (col: string) => void;
  setExportMode: (mode: 'skip_empty' | 'include_empty') => void;
  computeMatch: () => Promise<void>;
  setCurrentPageIndex: (idx: number) => void;
  setIsExporting: (v: boolean) => void;
  clearErrors: () => void;
  previewPanels: PanelVM[];
}

function panelResponseToVm(p: PanelMatchPanelResponse): PanelVM {
  return {
    cuadrante: p.cuadrante || '',
    fechaCorte: p.fecha_corte || '',
    motivo: p.motivo || '',
    imagenes: (p.imagenes || []).map((img) => ({
      filename: img.filename,
      caption: img.caption,
      position: img.position,
    })),
    sourceRowIndex: p.source_row_index ?? null,
  };
}

export function usePanelSession(): PanelSession {
  const [headerForm, setHeaderFormState] = useState<HeaderFormState>({
    cuadrante: '',
    fechaCorte: '',
    motivo: '',
  });
  const [logoLeft, setLogoLeftState] = useState<LogoAsset | null>(null);
  const [logoRight, setLogoRightState] = useState<LogoAsset | null>(null);
  const [images, setImages] = useState<LocalImage[]>([]);
  const [excelSource, setExcelSourceState] = useState<ExcelSource | null>(null);
  const [matchRule, setMatchRuleState] = useState<MatchRule>({
    keyColumn: '',
    strategy: 'prefix',
  });
  const [addressColumn, setAddressColumnState] = useState('');
  const [exportMode, setExportModeState] = useState<'skip_empty' | 'include_empty'>('skip_empty');
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [isExporting, setIsExportingState] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const imagesRef = useRef(images);
  imagesRef.current = images;
  const excelRef = useRef(excelSource);
  excelRef.current = excelSource;
  const matchRuleRef = useRef(matchRule);
  matchRuleRef.current = matchRule;
  const addressRef = useRef(addressColumn);
  addressRef.current = addressColumn;
  const exportModeRef = useRef(exportMode);
  exportModeRef.current = exportMode;

  const logoLeftRef = useRef(logoLeft);
  logoLeftRef.current = logoLeft;
  const logoRightRef = useRef(logoRight);
  logoRightRef.current = logoRight;

  const validateLogo = useCallback((file: File): string | null => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return MSG_LOGO_INVALID;
    if (file.size > MAX_LOGO_BYTES) return MSG_LOGO_TOO_LARGE;
    return null;
  }, []);

  const setLogoLeft = useCallback((file: File | null): string | null => {
    if (logoLeft) URL.revokeObjectURL(logoLeft.objectUrl);
    if (!file) {
      setLogoLeftState(null);
      return null;
    }
    const err = validateLogo(file);
    if (err) return err;
    setLogoLeftState({ file, objectUrl: URL.createObjectURL(file) });
    return null;
  }, [logoLeft, validateLogo]);

  const setLogoRight = useCallback((file: File | null): string | null => {
    if (logoRight) URL.revokeObjectURL(logoRight.objectUrl);
    if (!file) {
      setLogoRightState(null);
      return null;
    }
    const err = validateLogo(file);
    if (err) return err;
    setLogoRightState({ file, objectUrl: URL.createObjectURL(file) });
    return null;
  }, [logoRight, validateLogo]);

  const addImages = useCallback((files: File[]): string[] => {
    const newErrors: string[] = [];
    const accepted: LocalImage[] = [];
    for (const file of files) {
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) continue;
      if (file.size > MAX_IMAGE_BYTES) {
        newErrors.push(MSG_IMAGE_TOO_LARGE(file.name));
        continue;
      }
      const localPath = window.electronAPI?.getPathForFile(file) || undefined;
      if (localPath) registerLocalPath(localPath);
      accepted.push({ file, objectUrl: URL.createObjectURL(file), localPath });
    }
    setImages((prev) => [...prev, ...accepted]);
    return newErrors;
  }, []);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => {
      const img = prev[index];
      if (img) URL.revokeObjectURL(img.objectUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const clearImages = useCallback(() => {
    imagesRef.current.forEach((img) => URL.revokeObjectURL(img.objectUrl));
    setImages([]);
  }, []);

  const clearErrors = useCallback(() => setErrors([]), []);

  /**
   * Find the original column name from an ExcelSource by checking its
   * normalized column names. Returns '' if not found.
   */
  const _findColumnValue = useCallback(
    (src: ExcelSource, normalizedName: string, rowIndex = 0): string => {
      const idx = src.normalizedColumns.findIndex((n) => n === normalizedName);
      if (idx < 0 || !src.rows[rowIndex]) return '';
      return src.rows[rowIndex][src.columns[idx]] ?? '';
    },
    []
  );

  const setExcelSource = useCallback(
    (src: ExcelSource | null) => {
      setExcelSourceState(src);
      if (src && src.rows.length > 0) {
        const cuadrante = _findColumnValue(src, 'cuadrante afectado');
        const fechaRaw = _findColumnValue(src, 'fecha de corte');
        const motivo = _findColumnValue(src, 'motivo');
        setHeaderFormState({
          cuadrante,
          fechaCorte: normalizePanelDateStr(fechaRaw),
          motivo,
        });
        setMatchRuleState((prev) => ({
          ...prev,
          keyColumn: resolveDefaultKeyColumn(src),
        }));
        setAddressColumnState(resolveDefaultAddressColumn(src));
      } else {
        setHeaderFormState({ cuadrante: '', fechaCorte: '', motivo: '' });
        setMatchRuleState({ keyColumn: '', strategy: 'prefix' });
        setAddressColumnState('');
      }
    },
    [_findColumnValue]
  );

  const matchTokenRef = useRef(0);

  const computeMatch = useCallback(async () => {
    const src = excelRef.current;
    if (!src) {
      setMatchResult(null);
      return;
    }
    const imgs = imagesRef.current;
    if (!imgs.length) {
      setMatchResult(null);
      return;
    }
    const rule = matchRuleRef.current;
    if (!rule.keyColumn) {
      setMatchResult(null);
      return;
    }
    const token = ++matchTokenRef.current;
    try {
      const resp = await api.panelAvisoCorteComputeMatch({
        rows: src.rows,
        key_column: rule.keyColumn,
        strategy: rule.strategy,
        pattern: rule.regexPattern,
        address_column: addressRef.current || undefined,
        image_names: imgs.map((i) => i.file.name),
        export_mode: exportModeRef.current,
      });
      // Ignore stale responses when the user changed rules/images quickly.
      if (token !== matchTokenRef.current) return;
      const panels = resp.panels.map(panelResponseToVm);
      const summary = resp.summary;
      setMatchResult({
        panels,
        summary: {
          totalRows: summary.total_rows || 0,
          rowsWithImages: summary.rows_with_images || 0,
          rowsWithoutImages: summary.rows_without_images || 0,
          totalImages: summary.total_images || 0,
          matchedImages: summary.matched_images || 0,
          unmatchedImages: summary.unmatched_images || 0,
          unmatchedImageNames: summary.unmatched_image_names || [],
          rowsWithoutImagesKeys: summary.rows_without_images_keys || [],
        },
        warnings: resp.warnings || [],
      });
      setCurrentPageIndex(0);
    } catch (e: any) {
      if (token !== matchTokenRef.current) return;
      setErrors([e?.message || 'Error en emparejamiento']);
      setMatchResult(null);
    }
  }, []);

  // Auto-compute match when dependencies change
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      computeMatch();
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [excelSource, images, matchRule, addressColumn, exportMode, computeMatch]);

  // Saneamiento de URLs de objetos al desmontar el componente (evita fugas de memoria)
  useEffect(() => {
    return () => {
      if (logoLeftRef.current) {
        URL.revokeObjectURL(logoLeftRef.current.objectUrl);
      }
      if (logoRightRef.current) {
        URL.revokeObjectURL(logoRightRef.current.objectUrl);
      }
      imagesRef.current.forEach((img) => {
        URL.revokeObjectURL(img.objectUrl);
      });
    };
  }, []);

  const previewPanels = useMemo(() => {
    if (matchResult) return matchResult.panels;
    if (excelSource) return buildExcelPreviewPanels(excelSource);
    const panels: PanelVM[] = [];
    for (let i = 0; i < images.length; i += 4) {
      const chunk = images.slice(i, i + 4);
      const refs = chunk.map((img, idx) => ({
        filename: img.file.name,
        caption: `IMAGEN N°${i + idx + 1}: (Indicar dirección según lista de usuarios)`,
        position: idx + 1,
      }));
      panels.push({
        cuadrante: headerForm.cuadrante,
        fechaCorte: headerForm.fechaCorte,
        motivo: headerForm.motivo,
        imagenes: refs,
        sourceRowIndex: null,
      });
    }
    return panels;
  }, [matchResult, excelSource, images, headerForm]);

  return {
    headerForm,
    logoLeft,
    logoRight,
    images,
    excelSource,
    matchRule,
    addressColumn,
    exportMode,
    matchResult,
    currentPageIndex,
    isExporting,
    errors,
    setHeaderForm: setHeaderFormState,
    setLogoLeft,
    setLogoRight,
    addImages,
    removeImage,
    clearImages,
    setExcelSource,
    setMatchRule: setMatchRuleState,
    setAddressColumn: setAddressColumnState,
    setExportMode: setExportModeState,
    computeMatch,
    setCurrentPageIndex,
    setIsExporting: setIsExportingState,
    clearErrors,
    previewPanels,
  };
}
