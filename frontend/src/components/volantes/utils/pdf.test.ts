import { describe, expect, it } from "vitest";
import { chunkExportItems } from "./pdf";

describe("bulk PDF export batching", () => {
  it("preserves order while keeping every batch within the limit", () => {
    const records = Array.from({ length: 25 }, (_, index) => ({ id: index }));

    const batches = chunkExportItems(records, 10);

    expect(batches.map((batch) => batch.length)).toEqual([10, 10, 5]);
    expect(batches.flat()).toEqual(records);
    expect(records).toHaveLength(25);
  });

  it("rejects a non-positive batch size", () => {
    expect(() => chunkExportItems([1, 2, 3], 0)).toThrow("batch size");
  });
});
