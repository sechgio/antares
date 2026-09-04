import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SetStateAction } from "react";
import { DEFAULT_BRAND, DEFAULT_ENCABEZADOS, DEFAULT_FOOTER, DEFAULT_HEADING } from "../constants";
import type {
  BrandConfig,
  FooterConfig,
  FlyerEncabezados,
  FlyerHeading,
  FlyerRecord,
  LayoutMode,
  VolantesDraft,
} from "../types";
import { clearVolantesDraft, loadVolantesDraft, saveVolantesDraft } from "../utils/storage";

const SAVE_DEBOUNCE_MS = 350;

export type VolantesPersistenceStatus = "loading" | "saving" | "saved" | "error";

type PersistedSetter<T> = (value: SetStateAction<T>) => void;

export interface UseVolantesDraftResult {
  records: FlyerRecord[];
  setRecords: PersistedSetter<FlyerRecord[]>;
  brand: BrandConfig;
  setBrand: PersistedSetter<BrandConfig>;
  footer: FooterConfig;
  setFooter: PersistedSetter<FooterConfig>;
  heading: FlyerHeading;
  setHeading: PersistedSetter<FlyerHeading>;
  encabezados: FlyerEncabezados;
  setEncabezados: PersistedSetter<FlyerEncabezados>;
  layoutMode: LayoutMode;
  setLayoutMode: PersistedSetter<LayoutMode>;
  selectedRecordId: string | null;
  setSelectedRecordId: PersistedSetter<string | null>;
  persistenceStatus: VolantesPersistenceStatus;
  clearDraft: () => Promise<boolean>;
}

const defaultBrand: BrandConfig = {
  logoIzquierdo: DEFAULT_BRAND.logoIzquierdo,
  logoDerecho: DEFAULT_BRAND.logoDerecho,
};

const defaultFooter: FooterConfig = {
  logoOperativo: DEFAULT_FOOTER.logoOperativo,
  servicioAgua: DEFAULT_FOOTER.servicioAgua,
};

const defaultHeading: FlyerHeading = {
  titulo: DEFAULT_HEADING.titulo,
  subtitulo: DEFAULT_HEADING.subtitulo,
};

const defaultEncabezados: FlyerEncabezados = {
  limpiezaReservorios: DEFAULT_ENCABEZADOS.limpiezaReservorios,
  zonasAfectadas: DEFAULT_ENCABEZADOS.zonasAfectadas,
  detalleZonas: DEFAULT_ENCABEZADOS.detalleZonas,
};

function createDraft(
  records: FlyerRecord[],
  brand: BrandConfig,
  footer: FooterConfig,
  heading: FlyerHeading,
  encabezados: FlyerEncabezados,
  layoutMode: LayoutMode,
  selectedRecordId: string | null,
): VolantesDraft {
  return {
    records,
    brand,
    footer,
    heading,
    encabezados,
    layoutMode,
    selectedRecordId,
  };
}

export function useVolantesDraft(): UseVolantesDraftResult {
  const [recordsState, setRecordsState] = useState<FlyerRecord[]>([]);
  const [brandState, setBrandState] = useState<BrandConfig>(defaultBrand);
  const [footerState, setFooterState] = useState<FooterConfig>(defaultFooter);
  const [headingState, setHeadingState] = useState<FlyerHeading>(defaultHeading);
  const [encabezadosState, setEncabezadosState] =
    useState<FlyerEncabezados>(defaultEncabezados);
  const [layoutModeState, setLayoutModeState] = useState<LayoutMode>("2-up");
  const [selectedRecordIdState, setSelectedRecordIdState] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [persistenceStatus, setPersistenceStatus] =
    useState<VolantesPersistenceStatus>("loading");

  const dirtyRef = useRef(false);
  const clearRequestedRef = useRef(false);
  const skipNextPersistRef = useRef(false);
  const mountedRef = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveGenerationRef = useRef(0);

  const draft = useMemo(
    () =>
      createDraft(
        recordsState,
        brandState,
        footerState,
        headingState,
        encabezadosState,
        layoutModeState,
        selectedRecordIdState,
      ),
    [
      recordsState,
      brandState,
      footerState,
      headingState,
      encabezadosState,
      layoutModeState,
      selectedRecordIdState,
    ],
  );
  const draftRef = useRef<VolantesDraft>(draft);
  draftRef.current = draft;

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    skipNextPersistRef.current = false;
  }, []);

  const setRecords = useCallback<PersistedSetter<FlyerRecord[]>>(
    (value) => {
      markDirty();
      setRecordsState(value);
    },
    [markDirty],
  );

  const setBrand = useCallback<PersistedSetter<BrandConfig>>(
    (value) => {
      markDirty();
      setBrandState(value);
    },
    [markDirty],
  );

  const setFooter = useCallback<PersistedSetter<FooterConfig>>(
    (value) => {
      markDirty();
      setFooterState(value);
    },
    [markDirty],
  );

  const setHeading = useCallback<PersistedSetter<FlyerHeading>>(
    (value) => {
      markDirty();
      setHeadingState(value);
    },
    [markDirty],
  );

  const setEncabezados = useCallback<PersistedSetter<FlyerEncabezados>>(
    (value) => {
      markDirty();
      setEncabezadosState(value);
    },
    [markDirty],
  );

  const setLayoutMode = useCallback<PersistedSetter<LayoutMode>>(
    (value) => {
      markDirty();
      setLayoutModeState(value);
    },
    [markDirty],
  );

  const setSelectedRecordId = useCallback<PersistedSetter<string | null>>(
    (value) => {
      markDirty();
      setSelectedRecordIdState(value);
    },
    [markDirty],
  );

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
    }

    const generation = ++saveGenerationRef.current;
    if (mountedRef.current) setPersistenceStatus("saving");

    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      const snapshot = draftRef.current;
      void saveVolantesDraft(snapshot)
        .then(() => {
          if (!mountedRef.current || generation !== saveGenerationRef.current) return;
          dirtyRef.current = false;
          setPersistenceStatus("saved");
        })
        .catch(() => {
          if (!mountedRef.current || generation !== saveGenerationRef.current) return;
          setPersistenceStatus("error");
        });
    }, SAVE_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void loadVolantesDraft()
      .then((stored) => {
        if (cancelled) return;

        if (stored && !dirtyRef.current && !clearRequestedRef.current) {
          setRecordsState(stored.records);
          setBrandState({ ...defaultBrand, ...stored.brand });
          setFooterState({ ...defaultFooter, ...stored.footer });
          setHeadingState({ ...defaultHeading, ...stored.heading });
          setEncabezadosState({ ...defaultEncabezados, ...stored.encabezados });
          setLayoutModeState(stored.layoutMode);
          const selectedId =
            stored.selectedRecordId &&
            stored.records.some((record) => record.id === stored.selectedRecordId)
              ? stored.selectedRecordId
              : stored.records[0]?.id ?? null;
          setSelectedRecordIdState(selectedId);
        }

        setIsLoaded(true);
        setPersistenceStatus("saved");
      })
      .catch(() => {
        if (cancelled) return;
        setIsLoaded(true);
        setPersistenceStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    if (!dirtyRef.current) return;
    scheduleSave();
  }, [draft, isLoaded, scheduleSave]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (!dirtyRef.current || skipNextPersistRef.current) return;
      void saveVolantesDraft(draftRef.current).catch(() => undefined);
    };
  }, []);

  const clearDraft = useCallback(async (): Promise<boolean> => {
    clearRequestedRef.current = true;
    skipNextPersistRef.current = true;
    dirtyRef.current = false;
    saveGenerationRef.current += 1;
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    setRecordsState([]);
    setBrandState({ ...defaultBrand });
    setFooterState({ ...defaultFooter });
    setHeadingState({ ...defaultHeading });
    setEncabezadosState({ ...defaultEncabezados });
    setLayoutModeState("2-up");
    setSelectedRecordIdState(null);
    setPersistenceStatus("saving");

    try {
      await clearVolantesDraft();
      if (mountedRef.current) setPersistenceStatus("saved");
      return true;
    } catch {
      if (mountedRef.current) setPersistenceStatus("error");
      return false;
    }
  }, []);

  return {
    records: recordsState,
    setRecords,
    brand: brandState,
    setBrand,
    footer: footerState,
    setFooter,
    heading: headingState,
    setHeading,
    encabezados: encabezadosState,
    setEncabezados,
    layoutMode: layoutModeState,
    setLayoutMode,
    selectedRecordId: selectedRecordIdState,
    setSelectedRecordId,
    persistenceStatus,
    clearDraft,
  };
}
