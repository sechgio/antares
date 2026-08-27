import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHUNK_SIZE, chunkArray, getDefaultHeader } from '../constants';
import type { CampoPanel, CampoPanelListItem, PhotoFile, ReportTypeConfig } from '../types';
import { derivePanelLabel } from '../utils/panelLabel';
import {
    deleteStoredPanel,
    loadPanelsByType,
    panelToStored,
    savePanel,
    storedToPanel,
} from '../utils/storage';
import { isTituloStyleKey } from '../utils/tituloStyle';

function createPanelId(): string {
    return `panel-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function revokePhotos(photos: PhotoFile[]) {
    photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
}

export function createEmptyPanel(config: ReportTypeConfig): CampoPanel {
    const header = getDefaultHeader(config);
    return {
        id: createPanelId(),
        label: derivePanelLabel(header),
        header,
        photos: [],
        createdAt: Date.now(),
    };
}

const SAVE_DEBOUNCE_MS = 400;
/** Style tweaks (size/color) shouldn't thrash IndexedDB with full photo blobs. */
const STYLE_SAVE_DEBOUNCE_MS = 900;

export interface CampoPanelsSelectionState {
    selectedPanel: CampoPanel | null;
    selectedPanelId: string | null;
    currentPanelIndex: number;
}

export interface CampoPanelsActions {
    createPanel: () => CampoPanel;
    selectPanel: (id: string) => void;
    updateHeader: (key: string, value: string) => void;
    addPhotos: (files: FileList | null) => { added: number; rejected: number };
    clearPhotos: () => void;
    deletePanel: (id: string) => void;
    duplicatePanel: (id: string) => void;
    goRelativePanel: (direction: -1 | 1) => void;
    resetSession: () => void;
}

export interface CampoPanelsHookResult {
    panels: CampoPanel[];
    selectedPanel: CampoPanel | null;
    selectedPanelId: string | null;
    panelListItems: CampoPanelListItem[];
    currentPanelIndex: number;
    selection: CampoPanelsSelectionState;
    actions: CampoPanelsActions;
    createPanel: () => CampoPanel;
    selectPanel: (id: string) => void;
    updateHeader: (key: string, value: string) => void;
    addPhotos: (files: FileList | null) => { added: number; rejected: number };
    clearPhotos: () => void;
    deletePanel: (id: string) => void;
    duplicatePanel: (id: string) => void;
    goRelativePanel: (direction: -1 | 1) => void;
    resetSession: () => void;
}

export function useCampoPanels(config: ReportTypeConfig): CampoPanelsHookResult {
    const [panels, setPanels] = useState<CampoPanel[]>(() => [createEmptyPanel(config)]);
    const [selectedPanelId, setSelectedPanelId] = useState<string | null>(() => panels[0]?.id ?? null);

    const selectedPanel = useMemo(
        () => panels.find((panel) => panel.id === selectedPanelId) ?? null,
        [panels, selectedPanelId],
    );

    const panelListItems = useMemo<CampoPanelListItem[]>(() => {
        const itemsPerPage = config.photosPerPage || CHUNK_SIZE;
        return panels.map((panel) => {
            const chunks = chunkArray(panel.photos, itemsPerPage);
            return {
                id: panel.id,
                label: panel.label,
                photoCount: panel.photos.length,
                pageCount: panel.photos.length > 0 ? chunks.length : 0,
            };
        });
    }, [panels, config]);

    const currentPanelIndex = useMemo(
        () => panels.findIndex((panel) => panel.id === selectedPanelId),
        [panels, selectedPanelId],
    );

    // Refs para evitar closures obsoletas entre renders y cargas async.
    const panelsRef = useRef(panels);
    useEffect(() => {
        panelsRef.current = panels;
    }, [panels]);

    const reportType = config.id;
    const reportTypeRef = useRef(reportType);
    reportTypeRef.current = reportType;

    const loadedTypeRef = useRef<string | null>(null);
    const saveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    /** Panel ids with a pending debounced write (may outlive the timer map briefly). */
    const dirtyIdsRef = useRef<Set<string>>(new Set());

    const cancelPendingSave = useCallback((id: string) => {
        const timer = saveTimersRef.current.get(id);
        if (timer) {
            clearTimeout(timer);
            saveTimersRef.current.delete(id);
        }
    }, []);

    const persistPanelNow = useCallback((panel: CampoPanel, type: ReportTypeConfig['id']) => {
        dirtyIdsRef.current.delete(panel.id);
        void savePanel(panelToStored(panel, type));
    }, []);

    /** Flush debounced writes immediately (tab switch / unmount / type change). */
    const flushPendingSaves = useCallback((type: ReportTypeConfig['id'] = reportTypeRef.current) => {
        const ids = new Set<string>([
            ...saveTimersRef.current.keys(),
            ...dirtyIdsRef.current,
        ]);
        saveTimersRef.current.forEach((timer) => clearTimeout(timer));
        saveTimersRef.current.clear();
        for (const id of ids) {
            const panel = panelsRef.current.find((p) => p.id === id);
            if (panel) persistPanelNow(panel, type);
            else dirtyIdsRef.current.delete(id);
        }
    }, [persistPanelNow]);

    const scheduleSave = useCallback((panel: CampoPanel, debounceMs = SAVE_DEBOUNCE_MS) => {
        if (!panel) return;
        dirtyIdsRef.current.add(panel.id);
        cancelPendingSave(panel.id);
        const timer = setTimeout(() => {
            saveTimersRef.current.delete(panel.id);
            // Read latest panel from ref so rapid style edits only write once.
            const latest = panelsRef.current.find((p) => p.id === panel.id) ?? panel;
            persistPanelNow(latest, reportTypeRef.current);
        }, debounceMs);
        saveTimersRef.current.set(panel.id, timer);
    }, [cancelPendingSave, persistPanelNow]);

    // Carga por plantilla: al montar y al cambiar de tipo (config.id).
    // Reemplaza al resetSession() que antes borraba todo al cambiar de plantilla.
    useEffect(() => {
        const type = reportType;
        const firstRun = loadedTypeRef.current === null;

        // En el primer run, si el usuario ya editó el seed, no lo pisamos.
        if (firstRun) {
            loadedTypeRef.current = type;
        } else if (loadedTypeRef.current === type) {
            return;
        } else {
            // Flush under the previous template id before swapping panels.
            flushPendingSaves(loadedTypeRef.current as ReportTypeConfig['id']);
            loadedTypeRef.current = type;
        }

        let cancelled = false;
        void (async () => {
            const stored = await loadPanelsByType(type);
            if (cancelled) return;

            if (stored.length === 0) {
                // Sin hojas guardadas para este tipo:
                //  - primer montaje: conservar el seed inicial (o trabajo del
                //    usuario previo a la carga) sin pisarlo.
                //  - cambio de plantilla: descartar los paneles del tipo anterior
                //    y crear un seed nuevo.
                if (firstRun) return;
                panelsRef.current.forEach((panel) => revokePhotos(panel.photos));
                const fresh = createEmptyPanel(config);
                setPanels([fresh]);
                setSelectedPanelId(fresh.id);
                return;
            }

            const restored = stored.map(storedToPanel);
            panelsRef.current.forEach((panel) => revokePhotos(panel.photos));
            setPanels(restored);
            setSelectedPanelId(restored[0]?.id ?? null);
        })();

        return () => {
            cancelled = true;
        };
    }, [reportType, config, flushPendingSaves]);

    // Flush pending debounced writes on unmount (tab switch drops the view).
    useEffect(() => {
        return () => {
            flushPendingSaves();
        };
    }, [flushPendingSaves]);

    const resetSession = useCallback(() => {
        setPanels((prev) => {
            prev.forEach((panel) => revokePhotos(panel.photos));
            const fresh = createEmptyPanel(config);
            setSelectedPanelId(fresh.id);
            return [fresh];
        });
    }, [config]);

    const createPanel = useCallback(() => {
        const panel = createEmptyPanel(config);
        setPanels((prev) => [...prev, panel]);
        setSelectedPanelId(panel.id);
        scheduleSave(panel);
        return panel;
    }, [config, scheduleSave]);

    const selectPanel = useCallback((id: string) => {
        setSelectedPanelId(id);
    }, []);

    const updateHeader = useCallback((key: string, value: string) => {
        if (!selectedPanelId) return;
        const styleOnly = isTituloStyleKey(key);
        let updated: CampoPanel | null = null;

        setPanels((prev) =>
            prev.map((panel) => {
                if (panel.id !== selectedPanelId) return panel;
                if (panel.header[key] === value) return panel;
                const header = { ...panel.header, [key]: value };
                updated = {
                    ...panel,
                    header,
                    // Style keys don't affect the panel list label.
                    label: styleOnly ? panel.label : derivePanelLabel(header),
                };
                return updated;
            }),
        );

        if (updated) {
            scheduleSave(updated, styleOnly ? STYLE_SAVE_DEBOUNCE_MS : SAVE_DEBOUNCE_MS);
        }
    }, [selectedPanelId, scheduleSave]);

    const addPhotos = useCallback((files: FileList | null) => {
        if (!files || !selectedPanelId) return { added: 0, rejected: 0 };

        const maxPhotos = config.photosPerPage ?? CHUNK_SIZE;
        let added = 0;
        let rejected = 0;

        setPanels((prev) =>
            prev.map((panel) => {
                if (panel.id !== selectedPanelId) return panel;

                const remaining = maxPhotos - panel.photos.length;
                if (remaining <= 0) {
                    rejected = files.length;
                    return panel;
                }

                const accepted = Array.from(files).slice(0, remaining);
                rejected = files.length - accepted.length;
                added = accepted.length;

                const newPhotos: PhotoFile[] = accepted.map((file) => ({
                    id: `${Date.now()}-${Math.random()}`,
                    file,
                    previewUrl: URL.createObjectURL(file),
                }));

                const updated = { ...panel, photos: [...panel.photos, ...newPhotos] };
                scheduleSave(updated);
                return updated;
            }),
        );

        return { added, rejected };
    }, [selectedPanelId, config, scheduleSave]);

    const clearPhotos = useCallback(() => {
        if (!selectedPanelId) return;
        setPanels((prev) =>
            prev.map((panel) => {
                if (panel.id !== selectedPanelId) return panel;
                revokePhotos(panel.photos);
                const updated = { ...panel, photos: [] };
                scheduleSave(updated);
                return updated;
            }),
        );
    }, [selectedPanelId, scheduleSave]);

    const deletePanel = useCallback((id: string) => {
        cancelPendingSave(id);
        dirtyIdsRef.current.delete(id);
        void deleteStoredPanel(id);
        setPanels((prev) => {
            const target = prev.find((panel) => panel.id === id);
            if (target) revokePhotos(target.photos);

            const next = prev.filter((panel) => panel.id !== id);
            if (next.length === 0) {
                const fresh = createEmptyPanel(config);
                setSelectedPanelId(fresh.id);
                return [fresh];
            }

            if (selectedPanelId === id) {
                const removedIndex = prev.findIndex((panel) => panel.id === id);
                const replacement = next[Math.min(removedIndex, next.length - 1)];
                setSelectedPanelId(replacement.id);
            }

            return next;
        });
    }, [cancelPendingSave, selectedPanelId, config]);

    const duplicatePanel = useCallback((id: string) => {
        const source = panels.find((panel) => panel.id === id);
        if (!source) return;

        const maxPhotos = config.photosPerPage ?? CHUNK_SIZE;
        const clonedPhotos: PhotoFile[] = source.photos.slice(0, maxPhotos).map((photo) => ({
            id: `${Date.now()}-${Math.random()}`,
            file: photo.file,
            previewUrl: URL.createObjectURL(photo.file),
        }));

        const panel: CampoPanel = {
            id: createPanelId(),
            label: derivePanelLabel(source.header),
            header: { ...source.header },
            photos: clonedPhotos,
            createdAt: Date.now(),
        };

        setPanels((prev) => [...prev, panel]);
        setSelectedPanelId(panel.id);
        scheduleSave(panel);
    }, [panels, config, scheduleSave]);

    const goRelativePanel = useCallback((direction: -1 | 1) => {
        const index = panels.findIndex((panel) => panel.id === selectedPanelId);
        const next = panels[index + direction];
        if (next) setSelectedPanelId(next.id);
    }, [panels, selectedPanelId]);

    const selection: CampoPanelsSelectionState = {
        selectedPanel,
        selectedPanelId,
        currentPanelIndex,
    };

    const actions: CampoPanelsActions = {
        createPanel,
        selectPanel,
        updateHeader,
        addPhotos,
        clearPhotos,
        deletePanel,
        duplicatePanel,
        goRelativePanel,
        resetSession,
    };

    return {
        panels,
        selectedPanel,
        selectedPanelId,
        panelListItems,
        currentPanelIndex,
        selection,
        actions,
        createPanel,
        selectPanel,
        updateHeader,
        addPhotos,
        clearPhotos,
        deletePanel,
        duplicatePanel,
        goRelativePanel,
        resetSession,
    };
}
