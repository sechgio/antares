import { describe, expect, it } from 'vitest';
import normalizationCases from '../../../../../shared/canvas-normalization-cases.json';
import { normalizeDocument, type CanvasDocument } from '../types';

describe('Canvas normalization contract', () => {
  for (const testCase of normalizationCases.guideCases) {
    it(testCase.name, () => {
      const normalized = normalizeDocument(testCase.document as unknown as CanvasDocument);

      expect(normalized.guides).toEqual(testCase.expectedGuides);
    });
  }
});
