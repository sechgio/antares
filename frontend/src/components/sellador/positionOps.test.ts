import { describe, expect, it } from "vitest";
import {
  activeIndexAfterRemove,
  nextPositionPreset,
  positionsAfterRemove,
  resolveAssignmentSlots,
} from "./positionOps";
import type { StampPosition } from "./utils";

const pos = (name: string): StampPosition =>
  ({
    name,
    rect: { x: 0, y: 0, width: 10, height: 10 },
  }) as StampPosition;

describe("nextPositionPreset", () => {
  it("rota por las cuatro esquinas en orden", () => {
    expect(nextPositionPreset(0)).toBe("bottom-right");
    expect(nextPositionPreset(1)).toBe("bottom-left");
    expect(nextPositionPreset(2)).toBe("top-right");
    expect(nextPositionPreset(3)).toBe("top-left");
    expect(nextPositionPreset(4)).toBe("bottom-right");
  });
});

describe("resolveAssignmentSlots", () => {
  it("en modo ciclo asigna posiciones en round-robin", () => {
    expect(resolveAssignmentSlots("cycle", 5, [], 2)).toEqual([0, 1, 0, 1, 0]);
  });

  it("en modo manual conserva y completa slots existentes", () => {
    const slots = resolveAssignmentSlots("manual", 4, [1, 1], 2);
    expect(slots.slice(0, 2)).toEqual([1, 1]);
    expect(slots).toHaveLength(4);
    expect(slots.every((s) => s >= 0 && s < 2)).toBe(true);
  });
});

describe("positionsAfterRemove", () => {
  it("elimina el índice y renumera las posiciones", () => {
    const result = positionsAfterRemove(
      [pos("Posición 1"), pos("Posición 2"), pos("Posición 3")],
      1,
    );
    expect(result.map((p) => p.name)).toEqual(["Posición 1", "Posición 2"]);
  });
});

describe("activeIndexAfterRemove", () => {
  it("el activo eliminado cae a la posición anterior", () => {
    expect(activeIndexAfterRemove(2, 2)).toBe(1);
    expect(activeIndexAfterRemove(0, 0)).toBe(0);
  });

  it("índices posteriores al eliminado retroceden uno", () => {
    expect(activeIndexAfterRemove(3, 1)).toBe(2);
  });

  it("índices anteriores se conservan", () => {
    expect(activeIndexAfterRemove(0, 2)).toBe(0);
  });
});
