import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySavedDocumentKeepingImages,
  assertCanvasAssetExpansionWithinBytes,
  assertDocumentImagesResolvable,
  clearBlobStore,
  collectImageRefsFromHistory,
  collectImageRefsFromLayers,
  countCanvasAssetRefs,
  embedCanvasAssetsAsDataUrls,
  embedManagedBlobsAsDataUrls,
  getBlobUrl,
  getThumbnailUrl,
  hydrateDocumentImages,
  pinImageRefs,
  persistDataUrlsAsCanvasAssets,
  registerAndPersistCanvasImage,
  registerImageBlob,
  releaseImageBlob,
  serializeDocumentImages,
  serializeHistorySteps,
  sweepOrphanBlobs,
  trackImageRef,
} from "./imageBlobStore";
import type { CanvasDocument, CanvasLayer } from "../types";
import type { HistoryStep } from "./canvasDiff";
import { resetCanvasHistoryTransportForTests, saveCanvasHistoryIncrementally } from "../../../api/canvasHistoryTransport";

let urlCounter = 0;
const revoked: string[] = [];
URL.createObjectURL = vi.fn(() => `blob:mock-${++urlCounter}`);
URL.revokeObjectURL = vi.fn((u: string) => {
  revoked.push(u);
});

const layer = (id: string, type: string, value = ""): CanvasLayer =>
  ({ id, type, name: id, value, cssVars: {} }) as CanvasLayer;

const doc = (layers: CanvasLayer[]): CanvasDocument =>
  ({
    version: 2,
    id: "d1",
    name: "d",
    page: { widthMm: 210, heightMm: 297 },
    layers,
    fields: [],
  }) as CanvasDocument;

const imageFile = (name = "p.png") =>
  new File([new Uint8Array(4)], name, { type: "image/png" });

beforeEach(() => {
  clearBlobStore();
  resetCanvasHistoryTransportForTests();
  revoked.length = 0;
  (window as unknown as { electronAPI?: unknown }).electronAPI = undefined;
});

describe("trackImageRef / collectImageRefs", () => {
  it("ignora valores vacíos o no gestionados", () => {
    const live = new Set<string>();
    trackImageRef(live, undefined);
    trackImageRef(live, "data:image/png;base64,x");
    trackImageRef(live, "https://cdn/x.png");
    expect(live.size).toBe(0);
  });

  it("trackea blob: y resuelve blobId registrado", async () => {
    const reg = await registerImageBlob(new Blob(["x"]));
    const live = new Set<string>();
    trackImageRef(live, reg.url);
    expect(live.has(reg.url)).toBe(true);
    expect(live.has(reg.blobId)).toBe(true);
  });

  it("collectImageRefsFromLayers solo mira image/logo", async () => {
    const reg = await registerImageBlob(new Blob(["x"]));
    const live = collectImageRefsFromLayers([
      layer("a", "image", reg.url),
      layer("b", "text", "blob:whatever"),
      layer("c", "logo", "blob:logo1"),
    ]);
    expect(live.has(reg.url)).toBe(true);
    expect(live.has("blob:logo1")).toBe(true);
    expect(live.size).toBe(3); // reg.url + reg.blobId + blob:logo1
  });

  it("collectImageRefsFromHistory lee diff steps y snapshots", () => {
    const steps: HistoryStep[] = [
      {
        type: "diff",
        undoDiff: { addedLayers: [layer("u", "image", "blob:u1")] },
        redoDiff: {
          modifiedLayers: [{ id: "m", changes: { value: "blob:m1" } }],
        },
      } as HistoryStep,
      doc([layer("s", "logo", "blob:s1")]),
    ];
    const live = collectImageRefsFromHistory(steps);
    expect(live.has("blob:u1")).toBe(true);
    expect(live.has("blob:m1")).toBe(true);
    expect(live.has("blob:s1")).toBe(true);
  });
});

describe("registerImageBlob / getBlobUrl / getThumbnailUrl", () => {
  it("File imagen cae al blob original si el worker falla", async () => {
    const reg = await registerImageBlob(imageFile());
    expect(reg.blobId).toMatch(/^img_blob_/);
    expect(reg.url).toMatch(/^blob:/);
    expect(getBlobUrl(reg.blobId)).toBe(reg.url);
    expect(getThumbnailUrl(reg.blobId)).toBe(reg.url);
  });

  it("getBlobUrl pasa blob:/http tal cual y devuelve value si no conoce", () => {
    expect(getBlobUrl("blob:raw")).toBe("blob:raw");
    expect(getBlobUrl("https://x/y.png")).toBe("https://x/y.png");
    expect(getBlobUrl("img_blob_unknown")).toBe("img_blob_unknown");
    expect(getBlobUrl(undefined)).toBe("");
    expect(getThumbnailUrl(undefined)).toBe("");
  });
});

describe("serializeDocumentImages", () => {
  it("reuses a validated asset across document and history saves without sending bytes again", async () => {
    const ref = "canvas-asset:stored";
    const blob = new Blob(["image"]);
    const canvasAssetPut = vi.fn(async (_chunk: ArrayBuffer | Uint8Array) => ({ ref }));
    const canvasAssetInfo = vi.fn(async () => ({ ref, bytes: blob.size }));
    (window as { electronAPI?: unknown }).electronAPI = { canvasAssetPut, canvasAssetInfo };
    const reg = await registerImageBlob(blob);
    const d = doc([layer("i", "image", reg.url), layer("l", "logo", reg.blobId)]);

    const first = await serializeDocumentImages(d);
    const second = await serializeDocumentImages(d);
    const history = await serializeHistorySteps([
      { type: "diff", undoDiff: {}, redoDiff: { addedLayers: [d.layers[0]] } },
    ]);

    expect(second).toEqual(first);
    expect(history[0]).toMatchObject({ redoDiff: { addedLayers: [{ value: ref }] } });
    expect(d.layers.map((item) => item.value)).toEqual([reg.url, reg.blobId]);
    expect(canvasAssetPut).toHaveBeenCalledTimes(1);
    expect(canvasAssetInfo).toHaveBeenCalledTimes(2);
    expect(canvasAssetPut.mock.calls[0][0].byteLength).toBe(blob.size);
  });

  it("repersists a cached asset after failed validation", async () => {
    const ref = "canvas-asset:restored";
    const blob = new Blob(["image"]);
    const canvasAssetPut = vi.fn(async () => ({ ref }));
    const canvasAssetInfo = vi.fn(async () => ({ ref, bytes: blob.size }));
    (window as { electronAPI?: unknown }).electronAPI = { canvasAssetPut, canvasAssetInfo };
    const reg = await registerImageBlob(blob);
    const d = doc([layer("i", "image", reg.url)]);
    await serializeDocumentImages(d);
    canvasAssetInfo.mockRejectedValueOnce(new Error("asset unavailable"));

    expect((await serializeDocumentImages(d)).layers[0].value).toBe(ref);
    expect((await serializeDocumentImages(d)).layers[0].value).toBe(ref);
    expect(canvasAssetPut).toHaveBeenCalledTimes(2);
  });

  it("does not reuse a cached asset with mismatched metadata", async () => {
    const ref = "canvas-asset:stored";
    const blob = new Blob(["image"]);
    const canvasAssetPut = vi.fn(async () => ({ ref }));
    const canvasAssetInfo = vi.fn(async () => ({ ref, bytes: 0 }));
    (window as { electronAPI?: unknown }).electronAPI = { canvasAssetPut, canvasAssetInfo };
    const reg = await registerImageBlob(blob);
    const d = doc([layer("i", "image", reg.url)]);
    await serializeDocumentImages(d);
    expect((await serializeDocumentImages(d)).layers[0].value).toBe(ref);
    expect(canvasAssetPut).toHaveBeenCalledTimes(2);
  });

  it("retries persistence after a failure and still honors data URL export mode", async () => {
    const ref = "canvas-asset:stored";
    const blob = new Blob(["image"]);
    const canvasAssetPut = vi.fn<(chunk: ArrayBuffer | Uint8Array) => Promise<{ ref: string }>>()
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValue({ ref });
    const canvasAssetInfo = vi.fn(async () => ({ ref, bytes: blob.size }));
    (window as { electronAPI?: unknown }).electronAPI = { canvasAssetPut, canvasAssetInfo };
    const reg = await registerImageBlob(blob);
    const d = doc([layer("i", "image", reg.url)]);

    expect((await serializeDocumentImages(d)).layers[0].value).toMatch(/^data:/);
    expect((await serializeDocumentImages(d)).layers[0].value).toBe(ref);
    expect((await serializeDocumentImages(d, { preferAssetRefs: false })).layers[0].value).toMatch(/^data:/);
    expect((await serializeDocumentImages(d)).layers[0].value).toBe(ref);
    canvasAssetInfo.mockRejectedValueOnce(new Error("asset missing"));
    canvasAssetPut.mockRejectedValueOnce(new Error("storage unavailable"));
    expect((await serializeDocumentImages(d)).layers[0].value).toMatch(/^data:/);
    expect((await serializeDocumentImages(d)).layers[0].value).toBe(ref);
    expect((await serializeDocumentImages(d)).layers[0].value).toBe(ref);
    expect(canvasAssetPut).toHaveBeenCalledTimes(4);
    expect(canvasAssetInfo).toHaveBeenCalledTimes(3);
  });

  it("reuses hydrated document and history assets, and images persisted at registration", async () => {
    const ref = "canvas-asset:stored";
    const chunk = new Uint8Array([1, 2, 3]).buffer;
    const canvasAssetGet = vi.fn(async () => ({ chunk }));
    const canvasAssetInfo = vi.fn(async () => ({ ref, bytes: chunk.byteLength }));
    const canvasAssetPut = vi.fn(async () => ({ ref }));
    (window as { electronAPI?: unknown }).electronAPI = { canvasAssetGet, canvasAssetInfo, canvasAssetPut };
    const hydrated = await hydrateDocumentImages(doc([layer("i", "image", ref)]));

    expect((await serializeDocumentImages(hydrated)).layers[0].value).toBe(ref);
    const { hydrateHistorySteps } = await import("./imageBlobStore");
    const history = await hydrateHistorySteps([
      { type: "diff", undoDiff: {}, redoDiff: { modifiedLayers: [{ id: "i", changes: { value: ref } }] } },
    ]);
    expect((await serializeHistorySteps(history))[0]).toMatchObject({ redoDiff: { modifiedLayers: [{ changes: { value: ref } }] } });
    expect(canvasAssetPut).not.toHaveBeenCalled();

    const url = await registerAndPersistCanvasImage(new Blob([chunk]));
    expect((await serializeDocumentImages(doc([layer("new", "image", url)]))).layers[0].value).toBe(ref);
    expect(canvasAssetPut).toHaveBeenCalledTimes(1);
  });

  it("sin electronAPI devuelve dataUrl para blobs registrados", async () => {
    const reg = await registerImageBlob(new Blob(["img"]));
    const out = await serializeDocumentImages(
      doc([layer("i", "image", reg.url)]),
    );
    expect(out.layers[0].value).toMatch(/^data:/);
  });

  it("no toca capas no-imagen ni valores data:/canvas-asset:", async () => {
    const d = doc([
      layer("t", "text", "hola"),
      layer("i", "image", "data:image/png;base64,x"),
      layer("a", "image", "canvas-asset:ref1"),
    ]);
    const out = await serializeDocumentImages(d);
    expect(out.layers).toEqual(d.layers);
  });
});

describe("serialized history identity", () => {
  it("preserves image steps across incremental saves, undo and redo", async () => {
    const reg = await registerImageBlob(new Blob(["img"]));
    const ref = "canvas-asset:history";
    const canvasAssetPut = vi.fn(async () => ({ ref }));
    const canvasAssetInfo = vi.fn(async () => ({ ref, bytes: 3 }));
    (window as { electronAPI?: unknown }).electronAPI = { canvasAssetPut, canvasAssetInfo };
    const image: HistoryStep = {
      type: "diff", undoDiff: {}, redoDiff: { addedLayers: [layer("i", "image", reg.url)] },
    };
    const text: HistoryStep = {
      type: "diff", undoDiff: {}, redoDiff: { modifiedLayers: [{ id: "t", changes: { value: "texto" } }] },
    };
    const invoke = vi.fn(async (_params: Record<string, unknown>) => ({ success: true, digest: "digest" }));
    const first = await serializeHistorySteps([image]);
    await saveCanvasHistoryIncrementally(invoke, "history", first, []);
    const next = await serializeHistorySteps([image, text]);
    await saveCanvasHistoryIncrementally(invoke, "history", next, []);
    expect(next[0]).toBe(first[0]);
    expect(invoke.mock.calls[1][0]).toMatchObject({ past_prefix: 1, past: [text] });
    await saveCanvasHistoryIncrementally(invoke, "history", await serializeHistorySteps([image]), await serializeHistorySteps([text]));
    expect(invoke.mock.calls[2][0]).toMatchObject({ past_prefix: 1, past: [], future: [text] });
    await saveCanvasHistoryIncrementally(invoke, "history", await serializeHistorySteps([image, text]), []);
    expect(invoke.mock.calls[3][0]).toMatchObject({ past_prefix: 1, past: [text], future: [] });
    expect(image).toMatchObject({ redoDiff: { addedLayers: [{ value: reg.url }] } });
    expect(canvasAssetPut).toHaveBeenCalledTimes(1);
  });

  it("preserves snapshot identity and revalidates assets before reuse", async () => {
    const reg = await registerImageBlob(new Blob(["img"]));
    const ref = "canvas-asset:snapshot";
    const canvasAssetPut = vi.fn(async () => ({ ref }));
    const canvasAssetInfo = vi.fn(async () => ({ ref, bytes: 3 }));
    (window as { electronAPI?: unknown }).electronAPI = { canvasAssetPut, canvasAssetInfo };
    const snapshot = doc([layer("i", "logo", reg.url)]);
    const [first] = await serializeHistorySteps([snapshot]);
    expect((await serializeHistorySteps([snapshot]))[0]).toBe(first);
    canvasAssetInfo.mockRejectedValueOnce(new Error("corrupt asset"));
    expect((await serializeHistorySteps([snapshot]))[0]).toBe(first);
    expect(canvasAssetPut).toHaveBeenCalledTimes(2);
    canvasAssetInfo.mockRejectedValue(new Error("missing asset"));
    canvasAssetPut.mockRejectedValue(new Error("write failed"));
    const [fallback] = await serializeHistorySteps([snapshot]);
    expect(fallback).not.toBe(first);
    expect((fallback as CanvasDocument).layers[0].value).toMatch(/^data:/);
    canvasAssetPut.mockResolvedValue({ ref });
    const [recovered] = await serializeHistorySteps([snapshot]);
    expect((recovered as CanvasDocument).layers[0].value).toBe(ref);
    canvasAssetInfo.mockResolvedValue({ ref, bytes: 3 });
    releaseImageBlob(reg.url);
    const [released] = await serializeHistorySteps([snapshot]);
    expect(released).not.toBe(recovered);
    expect((released as CanvasDocument).layers[0].value).toBe(reg.url);
  });
});

describe("applySavedDocumentKeepingImages", () => {
  it("conserva el valor blob vivo del editor frente al guardado", async () => {
    const reg = await registerImageBlob(new Blob(["x"]));
    const editor = doc([layer("i", "image", reg.url)]);
    const saved = doc([layer("i", "image", "canvas-asset:stored")]);
    const out = applySavedDocumentKeepingImages(editor, saved);
    expect(out.layers[0].value).toBe(reg.url);
  });

  it("no cambia nada si el valor previo no era blob vivo", () => {
    const editor = doc([layer("i", "image", "data:x")]);
    const saved = doc([layer("i", "image", "canvas-asset:stored")]);
    expect(applySavedDocumentKeepingImages(editor, saved)).toBe(saved);
  });
});

describe("canvas-asset refs", () => {
  it("persists a repeated Data URL only once", async () => {
    const dataUrl = "data:image/png;base64,AQID";
    const canvasAssetPut = vi.fn(async () => ({ ref: "canvas-asset:shared" }));
    const fetchStub = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as Response);
    (window as unknown as { electronAPI?: unknown }).electronAPI = { canvasAssetPut };

    try {
      const persisted = await persistDataUrlsAsCanvasAssets(doc([
        layer("image-1", "image", dataUrl),
        layer("image-2", "image", dataUrl),
      ]));

      expect(fetchStub).toHaveBeenCalledTimes(1);
      expect(canvasAssetPut).toHaveBeenCalledTimes(1);
      expect(persisted.layers.map((item) => item.value)).toEqual([
        "canvas-asset:shared",
        "canvas-asset:shared",
      ]);
    } finally {
      fetchStub.mockRestore();
    }
  });

  it("countCanvasAssetRefs cuenta solo refs canvas-asset en image/logo", () => {
    const d = doc([
      layer("a", "image", "canvas-asset:r1"),
      layer("b", "logo", "canvas-asset:r2"),
      layer("c", "text", "canvas-asset:no"),
    ]);
    expect(countCanvasAssetRefs(d)).toBe(2);
  });

  it("hydrate strict sin electronAPI lanza si hay refs", async () => {
    const d = doc([layer("a", "image", "canvas-asset:r1")]);
    await expect(hydrateDocumentImages(d, { strict: true })).rejects.toThrow(
      "canvas-asset",
    );
    await expect(hydrateDocumentImages(d)).resolves.toBe(d);
  });

  it("embedCanvasAssetsAsDataUrls strict sin electronAPI lanza", async () => {
    const d = doc([layer("a", "image", "canvas-asset:r1")]);
    await expect(
      embedCanvasAssetsAsDataUrls(d, { strict: true }),
    ).rejects.toThrow("canvasAssetGet");
  });

  it("hydrate resuelve refs a blob urls con canvasAssetGet", async () => {
    (window as { electronAPI?: unknown }).electronAPI = {
      canvasAssetGet: vi.fn(async () => ({
        chunk: new Uint8Array([1, 2, 3]).buffer,
      })),
    };
    const out = await hydrateDocumentImages(
      doc([layer("a", "image", "canvas-asset:r1")]),
    );
    expect(out.layers[0].value).toMatch(/^blob:/);
  });

  it("hydrate lee y registra los assets de forma secuencial", async () => {
    let activeReads = 0;
    let maxActiveReads = 0;
    const getAsset = vi.fn(async () => {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await Promise.resolve();
      activeReads -= 1;
      return { chunk: new Uint8Array([1, 2, 3]).buffer };
    });
    (window as { electronAPI?: unknown }).electronAPI = { canvasAssetGet: getAsset };

    const out = await hydrateDocumentImages(doc([
      layer("a", "image", "canvas-asset:r1"),
      layer("b", "image", "canvas-asset:r2"),
      layer("c", "image", "canvas-asset:r3"),
    ]));

    expect(maxActiveReads).toBe(1);
    expect(out.layers.every((item) => item.value.startsWith("blob:"))).toBe(true);
  });

  it("assertDocumentImagesResolvable lee refs uno por uno", async () => {
    let activeReads = 0;
    let maxActiveReads = 0;
    const getAsset = vi.fn(async () => {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await Promise.resolve();
      activeReads -= 1;
      return { chunk: new Uint8Array([1, 2, 3]).buffer };
    });
    (window as { electronAPI?: unknown }).electronAPI = { canvasAssetGet: getAsset };

    await assertDocumentImagesResolvable(doc([
      layer("a", "image", "canvas-asset:r1"),
      layer("b", "image", "canvas-asset:r2"),
      layer("c", "image", "canvas-asset:r3"),
    ]));

    expect(maxActiveReads).toBe(1);
  });

  it("hydrate strict lanza con detalle cuando el asset falla", async () => {
    (window as { electronAPI?: unknown }).electronAPI = {
      canvasAssetGet: vi.fn(async () => {
        throw new Error("io roto");
      }),
    };
    const d = doc([layer("a", "image", "canvas-asset:r1")]);
    await expect(hydrateDocumentImages(d, { strict: true })).rejects.toThrow(
      "canvas-asset:r1",
    );
  });

  it("assertCanvasAssetExpansionWithinBytes valida bytes por ref y ocurrencias", async () => {
    const info = vi.fn(async () => ({ bytes: 1000 }));
    (window as { electronAPI?: unknown }).electronAPI = {
      canvasAssetInfo: info,
    };
    const d = doc([
      layer("a", "image", "canvas-asset:r1"),
      layer("b", "image", "canvas-asset:r1"),
    ]);
    await assertCanvasAssetExpansionWithinBytes(d, 10 * 1024 * 1024);
    expect(info).toHaveBeenCalledTimes(1);
    await expect(assertCanvasAssetExpansionWithinBytes(d, 10)).rejects.toThrow(
      "límite",
    );
    info.mockResolvedValue({ bytes: -1 });
    await expect(
      assertCanvasAssetExpansionWithinBytes(d, 10 ** 9),
    ).rejects.toThrow("estimar");
  });
});

describe("embedManagedBlobsAsDataUrls", () => {
  it("deja intactos data:, canvas-asset:, http y file:", async () => {
    const d = doc([
      layer("a", "image", "data:x"),
      layer("b", "image", "canvas-asset:r"),
      layer("c", "logo", "https://x"),
      layer("d", "image", "file:/x"),
      layer("t", "text", "blob:ignored"),
    ]);
    expect(await embedManagedBlobsAsDataUrls(d)).toBe(d);
  });

  it("convierte blobs registrados a dataUrl", async () => {
    const reg = await registerImageBlob(new Blob(["x"], { type: "image/png" }));
    const out = await embedManagedBlobsAsDataUrls(
      doc([layer("a", "image", reg.blobId)]),
    );
    expect(out.layers[0].value).toMatch(/^data:/);
  });
});

describe("pin/release/sweep", () => {
  it("releaseImageBlob revoca url y borra el registro", async () => {
    const reg = await registerImageBlob(new Blob(["x"]));
    releaseImageBlob(reg.url);
    expect(revoked).toContain(reg.url);
    expect(getBlobUrl(reg.blobId)).toBe(reg.blobId);
  });

  it("pin protege contra release hasta liberar", async () => {
    const reg = await registerImageBlob(new Blob(["x"]));
    const unpin = pinImageRefs([reg.url]);
    releaseImageBlob(reg.url);
    expect(getBlobUrl(reg.blobId)).toBe(reg.url);
    unpin();
    unpin(); // idempotente
    releaseImageBlob(reg.url);
    expect(revoked).toContain(reg.url);
  });

  it("sweepOrphanBlobs libera los no referenciados", async () => {
    const keep = await registerImageBlob(new Blob(["k"]));
    await registerImageBlob(new Blob(["o"]));
    const released = sweepOrphanBlobs([keep.url]);
    expect(released).toBe(1);
    expect(getBlobUrl(keep.blobId)).toBe(keep.url);
  });
});
