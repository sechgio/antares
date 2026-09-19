import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

import {
  clearBlobStore,
  registerImageBlob,
  releaseImageBlob,
} from '../utils/imageBlobStore';
import {
  createClipboardCopyCoordinator,
  parseClipboardLayers,
  pasteToReplaceLayers,
  writeClipboardLayersText,
  type ClipboardCopyCoordinator,
} from '../ops/clipboardLayers';
import { assignUniqueLogoSides } from '../ops/logoSide';
import { deleteLayers, duplicateLayers } from '../ops/layerOps';
import { expandWithDescendants } from '../ops/layerTree';
import { newId, type CanvasLayer } from '../types';

interface CanvasClipboardParams {
  documentLayers: CanvasLayer[];
  pageIndex: number;
  selectedIds: string[];
  clipboard: CanvasLayer[];
  setClipboard: Dispatch<SetStateAction<CanvasLayer[]>>;
  sealPanelAndAbortGesture: () => void;
  setAllLayers: (layers: CanvasLayer[]) => void;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
}

export function useCanvasClipboard({
  documentLayers,
  pageIndex,
  selectedIds,
  clipboard,
  setClipboard,
  sealPanelAndAbortGesture,
  setAllLayers,
  setSelectedIds,
}: CanvasClipboardParams) {
  const clipboardCoordinatorRef = useRef<ClipboardCopyCoordinator | null>(null);
  if (!clipboardCoordinatorRef.current) {
    clipboardCoordinatorRef.current = createClipboardCopyCoordinator(
      (layers) => setClipboard(layers),
      (layers) => {
        setClipboard(layers);
        writeClipboardLayersText(layers);
      },
      releaseImageBlob,
    );
  }

  useEffect(() => () => {
    clipboardCoordinatorRef.current?.invalidate();
    clearBlobStore();
  }, []);

  const applyPasteLayers = useCallback(
    (source: CanvasLayer[], offsetMm?: number) => {
      if (!source.length) return;
      const withIds = source.map((l) => ({ ...l, pageIndex }));
      // El portapapeles conserva los ids de las capas copiadas. duplicateLayers
      // emite un clon por cada aparición en el array, así que un id que también
      // está en el documento borraría el original y clonaría dos veces.
      const rekeyed = new Map(withIds.map((l) => [l.id, newId()]));
      const incoming = withIds.map((l) => ({
        ...l,
        id: rekeyed.get(l.id)!,
        parentId: l.parentId ? (rekeyed.get(l.parentId) ?? l.parentId) : l.parentId,
      }));
      const incomingIds = new Set(incoming.map((l) => l.id));
      const roots = incoming.filter((l) => !l.parentId || !incomingIds.has(l.parentId));
      const temp = [...documentLayers, ...incoming];
      const { layers, newIds } = duplicateLayers(
        temp,
        roots.map((l) => l.id),
        offsetMm === undefined ? undefined : { offsetMm },
      );
      setAllLayers(assignUniqueLogoSides(layers.filter((l) => !incomingIds.has(l.id)), newIds));
      setSelectedIds(newIds);
    },
    [documentLayers, pageIndex, setAllLayers, setSelectedIds],
  );

  const pasteClipboard = useCallback(
    async (offsetMm?: number) => {
      if (clipboard.length) {
        applyPasteLayers(clipboard, offsetMm);
        return;
      }
      try {
        const text = await navigator.clipboard?.readText?.();
        const parsed = text ? parseClipboardLayers(text) : null;
        if (!parsed?.length) return;
        setClipboard(parsed);
        applyPasteLayers(parsed, offsetMm);
      } catch {
      }
    },
    [applyPasteLayers, clipboard],
  );

  const pasteReplaceClipboard = useCallback(async (targetIds?: string[]) => {
    const targets = (targetIds ?? selectedIds).filter((id) => {
      const layer = documentLayers.find((l) => l.id === id);
      return layer && !layer.locked && layer.type !== 'frame';
    });
    if (!targets.length) return;
    let src = clipboard;
    if (!src.length) {
      try {
        const text = await navigator.clipboard?.readText?.();
        src = (text ? parseClipboardLayers(text) : null) ?? [];
      } catch {
        src = [];
      }
    }
    if (!src.length) return;
    sealPanelAndAbortGesture();
    const result = pasteToReplaceLayers(documentLayers, src, targets);
    if (!result) return;
    setAllLayers(assignUniqueLogoSides(result.layers, result.newIds));
    setSelectedIds(result.newIds);
  }, [clipboard, selectedIds, documentLayers, sealPanelAndAbortGesture, setAllLayers, setSelectedIds]);

  const copyLayersToClipboard = useCallback((layers: CanvasLayer[]) => {
    const copies = layers.map((l) => ({ ...l, cssVars: { ...l.cssVars } }));
    clipboardCoordinatorRef.current?.copy(copies, async () => {
      const createdUrls: string[] = [];
      const rewritten = await Promise.all(
        copies.map(async (l) => {
          if (
            (l.type === 'image' || l.type === 'logo') &&
            typeof l.value === 'string' &&
            l.value.startsWith('data:')
          ) {
            try {
              const res = await fetch(l.value);
              const blob = await res.blob();
              const reg = await registerImageBlob(blob);
              createdUrls.push(reg.url);
              return { ...l, value: reg.url };
            } catch {
              return l;
            }
          }
          return l;
        }),
      );
      return { layers: rewritten, createdUrls };
    });
  }, []);

  const cutLayersToClipboard = useCallback(
    (rootIds: string[]) => {
      const editable = rootIds.filter((id) => {
        const layer = documentLayers.find((l) => l.id === id);
        return layer && !layer.locked && layer.type !== 'frame';
      });
      if (!editable.length) return [];
      const deepIds = new Set(expandWithDescendants(documentLayers, editable));
      copyLayersToClipboard(documentLayers.filter((l) => deepIds.has(l.id)));
      sealPanelAndAbortGesture();
      setAllLayers(deleteLayers(documentLayers, editable));
      return editable;
    },
    [copyLayersToClipboard, documentLayers, sealPanelAndAbortGesture, setAllLayers],
  );

  return {
    clipboard,
    setClipboard,
    clipboardCoordinatorRef,
    applyPasteLayers,
    pasteClipboard,
    pasteReplaceClipboard,
    copyLayersToClipboard,
    cutLayersToClipboard,
  };
}
