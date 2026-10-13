import type { CanvasDocument } from '../canvas/types';

interface CanvasEditor {
  get: () => CanvasDocument;
  dirty: () => boolean;
  apply: (values: Record<string, unknown>, expected: string) => Promise<unknown>;
  open: (id: string) => void;
}
let editor: CanvasEditor | null = null;

export function registerAgentCanvasEditor(value: CanvasEditor): () => void {
  editor = value;
  return () => { if (editor === value) editor = null; };
}

export function getAgentCanvasEditor(): CanvasEditor | null { return editor; }
