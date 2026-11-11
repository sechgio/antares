import { describe, expect, it } from "vitest";
import { deepMergeStyles } from "./ubicacionesTypes";

describe("deepMergeStyles (frontend-app-009)", () => {
  it("funde parches legítimos", () => {
    const merged = deepMergeStyles(
      { texts: { a: { color: "#000" } }, pin: { color: "#111" } },
      { texts: { a: { color: "#222" } }, pin: { scale: 0.2 } },
    );
    expect(merged).toEqual({
      texts: { a: { color: "#222" } },
      pin: { color: "#111", scale: 0.2 },
    });
  });

  it("no__proto__ ni constructor cambian el prototipo del acumulador", () => {
    const merged = deepMergeStyles<
      Record<string, unknown>
    >({ pin: { color: "#111" } }, {
      __proto__: { polluted: "sí" },
      pin: { color: "#222" },
    } as unknown as Record<string, unknown>);
    expect((merged as Record<string, unknown>).polluted).toBeUndefined();
    expect((merged as Record<string, unknown>).pin).toEqual({ color: "#222" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("descarta constructor y prototype en cualquier nivel", () => {
    const merged = deepMergeStyles<Record<string, unknown>>(
      { textos: { color: "#111" } },
      {
        textos: { constructor: { evil: 1 }, prototype: { evil: 2 }, color: "#222" },
      },
    );
    const textos = merged.textos as Record<string, unknown>;
    expect(textos).toEqual({ color: "#222" });
  });
});
