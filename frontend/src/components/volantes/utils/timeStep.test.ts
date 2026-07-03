import { describe, expect, it } from "vitest";
import {
  formatTimeParts,
  MINUTE_STEP,
  snapTimeToStep,
  stepTime,
} from "./timeStep";

describe("stepTime", () => {
  it("avanza de 1 en 1 minuto", () => {
    expect(stepTime({ hours: 8, minutes: 0 }, 1)).toEqual({
      hours: 8,
      minutes: 1,
    });
    expect(stepTime({ hours: 8, minutes: 59 }, 1)).toEqual({
      hours: 9,
      minutes: 0,
    });
  });

  it("retrocede de 1 en 1 minuto", () => {
    expect(stepTime({ hours: 8, minutes: 10 }, -1)).toEqual({
      hours: 8,
      minutes: 9,
    });
    expect(stepTime({ hours: 8, minutes: 0 }, -1)).toEqual({
      hours: 7,
      minutes: 59,
    });
  });

  it("pasa la hora al cruzar medianoche", () => {
    expect(stepTime({ hours: 0, minutes: 0 }, -1)).toEqual({
      hours: 23,
      minutes: 59,
    });
    expect(stepTime({ hours: 23, minutes: 59 }, 1)).toEqual({
      hours: 0,
      minutes: 0,
    });
  });

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