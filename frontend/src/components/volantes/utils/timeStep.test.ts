import { describe, expect, it } from "vitest";
import {
  formatTimeParts,
  MINUTE_STEP,
  snapTimeToStep,
} from "./timeStep";

describe("MINUTE_STEP", () => {
  it("usa paso de 1 por defecto", () => {
    expect(MINUTE_STEP).toBe(1);
  });
});

describe("snapTimeToStep", () => {
  it("mantiene la hora exacta con paso de 1", () => {
    expect(snapTimeToStep({ hours: 14, minutes: 32 })).toEqual({
      hours: 14,
      minutes: 32,
    });
    expect(snapTimeToStep({ hours: 14, minutes: 33 })).toEqual({
      hours: 14,
      minutes: 33,
    });
  });

  it("formatea hora con dos dígitos", () => {
    expect(formatTimeParts({ hours: 9, minutes: 5 })).toBe("09:05");
  });
});