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
  registerImageBlob,
  releaseImageBlob,
  serializeDocumentImages,
  sweepOrphanBlobs,
  trackImageRef,
} from "./imageBlobStore";
import type { CanvasDocument, CanvasLayer } from "../types";
import type { HistoryStep } from "./canvasDiff";

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
