import { useCallback, useRef, type MutableRefObject } from 'react';

import { moveGuide, removeGuide, upsertGuide } from '../ops/guides';
import type { CanvasDocument, CanvasGuide } from '../types';

interface CanvasStageActionsParams {
  documentRef: MutableRefObject<CanvasDocument>;
  setDocument: (next: CanvasDocument) => void;
  updateSilent: (next: CanvasDocument) => void;
  commitFromBaseline: (baseline: CanvasDocument) => void;
}

export function useCanvasStageActions({
  documentRef,
  setDocument,
  updateSilent,
  commitFromBaseline,
}: CanvasStageActionsParams) {
  const guideCreateBaselineRef = useRef<CanvasDocument | null>(null);

  const onStageUpsertGuide = useCallback(
    (guide: CanvasGuide) => {
      const doc = documentRef.current;
      const exists = doc.guides?.some((g) => g.id === guide.id);
      if (!exists) {
        guideCreateBaselineRef.current = doc;
      }
      updateSilent(upsertGuide(doc, guide));
    },
    [documentRef, updateSilent],
  );

  const onStageCommitGuideCreate = useCallback(
    (guide: CanvasGuide) => {
      const baseline = guideCreateBaselineRef.current;
      guideCreateBaselineRef.current = null;
      const next = upsertGuide(documentRef.current, guide);
      if (baseline) {
        updateSilent(next);
        commitFromBaseline(baseline);
      } else {
        setDocument(next);
      }
    },
    [commitFromBaseline, documentRef, setDocument, updateSilent],
  );

  const onStageMoveGuide = useCallback(
    (id: string, posMm: number) => {
      setDocument(moveGuide(documentRef.current, id, posMm));
    },
    [documentRef, setDocument],
  );

  const onStageRemoveGuide = useCallback(
    (id: string) => {
      setDocument(removeGuide(documentRef.current, id));
    },
    [documentRef, setDocument],
  );

  const onStageCancelGuideCreate = useCallback(
    (id: string) => {
      guideCreateBaselineRef.current = null;
      updateSilent(removeGuide(documentRef.current, id));
    },
    [documentRef, updateSilent],
  );

  const onToggleRulers = useCallback(() => {
    const doc = documentRef.current;
    setDocument({
      ...doc,
      settings: {
        ...doc.settings,
        showRulers: doc.settings?.showRulers === false,
      },
    });
  }, [documentRef, setDocument]);

  const onToggleSnapToGrid = useCallback(() => {
    const doc = documentRef.current;
    setDocument({
      ...doc,
      settings: {
        ...doc.settings,
        snapToGrid: !doc.settings?.snapToGrid,
      },
    });
  }, [documentRef, setDocument]);

  return {
    onStageUpsertGuide,
    onStageCommitGuideCreate,
    onStageMoveGuide,
    onStageRemoveGuide,
    onStageCancelGuideCreate,
    onToggleRulers,
    onToggleSnapToGrid,
  };
}
