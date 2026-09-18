import {
  ensureSlotIndices,
  type PositionAssignmentMode,
  type StampCornerPreset,
  type StampPosition,
} from "./utils";

const CORNER_PRESETS: StampCornerPreset[] = [
  "bottom-right",
  "bottom-left",
  "top-right",
  "top-left",
];

/** Preset de esquina para la siguiente posición nueva (rota en orden). */
export function nextPositionPreset(positionsLength: number): StampCornerPreset {
  return CORNER_PRESETS[positionsLength % CORNER_PRESETS.length];
}

/** Slots resueltos según modo de asignación (ciclo automático o manual). */
export function resolveAssignmentSlots(
  mode: PositionAssignmentMode,
  effectiveCount: number,
  slotIndices: number[],
  positionsCount: number,
): number[] {
  if (mode === "cycle") {
    return Array.from({ length: effectiveCount }, (_, i) => i % positionsCount);
  }
  return ensureSlotIndices(effectiveCount, slotIndices, positionsCount);
}

/** Elimina una posición y renumera las restantes como "Posición N". */
export function positionsAfterRemove(
  positions: StampPosition[],
  index: number,
): StampPosition[] {
  return positions
    .filter((_, i) => i !== index)
    .map((pos, i) => ({ ...pos, name: `Posición ${i + 1}` }));
}

/** Índice activo tras eliminar `index`: cae a la posición anterior si era el activo. */
export function activeIndexAfterRemove(current: number, index: number): number {
  if (current === index) return Math.max(0, index - 1);
  if (current > index) return current - 1;
  return current;
}
