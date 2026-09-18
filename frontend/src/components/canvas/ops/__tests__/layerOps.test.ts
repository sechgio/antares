import { describe, expect, it } from "vitest";
import {
  alignLayers,
  bringForward,
  bringToFront,
  containerUsesLayoutConstraints,
  deleteLayers,
  distributeLayers,
  duplicateLayers,
  groupLayers,
  moveLayerInTree,
  nudgeLayers,
  reorderAmongSiblings,
  sendBackward,
  sendToBack,
  setLayersLocked,
  setLayersOpacity,
  setLayersVisible,
  ungroupLayers,
} from "../layerOps";
import { mm, parseMm } from "../../types";
import type { CanvasLayer } from "../../types";

const rect = (
  id: string,
  x = 0,
  y = 0,
  w = 10,
  h = 10,
  extra: Partial<CanvasLayer> = {},
): CanvasLayer =>
  ({
    id,
    type: "rect",
    name: id,
    value: "",
    cssVars: {
      "--translate-x": mm(x),
      "--translate-y": mm(y),
      "--width": mm(w),
      "--height": mm(h),
    },
    ...extra,
  }) as CanvasLayer;

const tx = (l: CanvasLayer) => parseMm(l.cssVars["--translate-x"]);
const ty = (l: CanvasLayer) => parseMm(l.cssVars["--translate-y"]);
const ids = (ls: CanvasLayer[]) => ls.map((l) => l.id);

describe("orden de apilado", () => {
  const ls = [rect("a"), rect("b"), rect("c")];

  it("bringToFront mueve al final manteniendo orden relativo", () => {
    expect(ids(bringToFront(ls, ["a"]))).toEqual(["b", "c", "a"]);
    expect(ids(bringToFront(ls, ["a", "b"]))).toEqual(["c", "a", "b"]);
  });

  it("sendToBack mueve al principio", () => {
    expect(ids(sendToBack(ls, ["c"]))).toEqual(["c", "a", "b"]);
  });

  it("capas bloqueadas y frames no se mueven", () => {
    const withLocked = [
      rect("a"),
      rect("b", 0, 0, 10, 10, { locked: true }),
      rect("f", 0, 0, 10, 10, { type: "frame" as never }),
    ];
    // solo 'a' es elegible: pasa al final de sus hermanos no-frame
    expect(ids(bringToFront(withLocked, ["b", "f", "a"]))).toEqual([
      "b",
      "a",
      "f",
    ]);
    expect(bringToFront(ls, [])).toBe(ls);
  });

  it("solo reordena entre hermanos del mismo padre", () => {
    const nested = [
      rect("p", 0, 0, 10, 10, { type: "group" as never }),
      rect("a"),
      { ...rect("b"), parentId: "p" },
      rect("c"),
    ];
    // 'b' está dentro de 'p': traerla al frente no cruza con a/c
    const out = bringToFront(nested, ["b"]);
    expect(ids(out)).toEqual(ids(nested));
  });
});

describe("bringForward / sendBackward", () => {
  const ls = [rect("a"), rect("b"), rect("c")];

  it("intercambia un paso hacia adelante/atrás", () => {
    expect(ids(bringForward(ls, ["a"]))).toEqual(["b", "a", "c"]);
    expect(ids(sendBackward(ls, ["c"]))).toEqual(["a", "c", "b"]);
  });

  it("en los extremos no hace nada", () => {
    expect(ids(bringForward(ls, ["c"]))).toEqual(["a", "b", "c"]);
    expect(ids(sendBackward(ls, ["a"]))).toEqual(["a", "b", "c"]);
  });
});

describe("duplicateLayers", () => {
  it("duplica con offset, sufijo copia y nuevos ids", () => {
    const out = duplicateLayers([rect("a", 10, 20)], ["a"], { offsetMm: 5 });
    expect(out.layers).toHaveLength(2);
    const dup = out.layers[1];
    expect(dup.name).toBe("a copia");
    expect(tx(dup)).toBe(15);
    expect(ty(dup)).toBe(25);
    expect(out.newIds).toEqual([dup.id]);
  });

  it("duplica descendientes y remapea parentId", () => {
    const group = rect("g", 0, 0, 50, 50, { type: "group" as never });
    const child = { ...rect("c", 5, 5), parentId: "g" };
    const out = duplicateLayers([group, child], ["g"]);
    expect(out.layers).toHaveLength(4);
    const dupChild = out.layers[3];
    expect(dupChild.parentId).toBe(out.layers[1].id);
  });

  it("no duplica capas bloqueadas", () => {
    const out = duplicateLayers(
      [rect("a", 0, 0, 10, 10, { locked: true })],
      ["a"],
    );
    expect(out.layers).toHaveLength(1);
    expect(out.newIds).toEqual([]);
  });
});

describe("reorderAmongSiblings / moveLayerInTree", () => {
  it("inserta antes/después del target", () => {
    const ls = [rect("a"), rect("b"), rect("c")];
    // 'after' inserta en targetIdx, 'before' en targetIdx+1 (orden visual vs array)
    expect(ids(reorderAmongSiblings(ls, "c", "a", "after"))).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(ids(reorderAmongSiblings(ls, "a", "c", "before"))).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("rechaza mismo id, inexistentes, frames y distinto padre", () => {
    const ls = [rect("a"), rect("b")];
    expect(reorderAmongSiblings(ls, "a", "a", "before")).toBe(ls);
    expect(reorderAmongSiblings(ls, "a", "z", "before")).toBe(ls);
    const nested = [
      { ...rect("x"), parentId: "g" },
      rect("y"),
      rect("g", 0, 0, 50, 50, { type: "group" as never }),
    ];
    expect(reorderAmongSiblings(nested, "x", "y", "before")).toBe(nested);
  });

  it("inside reparentiza al contenedor", () => {
    const group = rect("g", 0, 0, 50, 50, { type: "group" as never });
    const ls = [group, rect("a")];
    const out = moveLayerInTree(ls, "a", "g", "inside");
    expect(out.find((l) => l.id === "a")?.parentId).toBe("g");
  });

  it("inside en no-contenedor no hace nada", () => {
    const ls = [rect("a"), rect("b")];
    expect(moveLayerInTree(ls, "a", "b", "inside")).toBe(ls);
  });

  it("no permite meter un padre dentro de su descendiente", () => {
    const group = rect("g", 0, 0, 50, 50, { type: "group" as never });
    const child = { ...rect("c"), parentId: "g" };
    const sub = rect("sg", 0, 0, 10, 10, { type: "group" as never });
    const ls = [group, { ...child }, { ...sub, parentId: "c" }];
    expect(moveLayerInTree(ls, "g", "sg", "inside")).toBe(ls);
  });
});

describe("visibilidad, lock y opacidad", () => {
  it("setLayersVisible/setLayersLocked aplican solo a los ids", () => {
    const ls = [rect("a"), rect("b")];
    const v = setLayersVisible(ls, ["a"], false);
    expect(v[0].visible).toBe(false);
    expect(v[1].visible).toBeUndefined();
    const l = setLayersLocked(ls, ["b"], true);
    expect(l[1].locked).toBe(true);
  });

  it("setLayersLocked ignora frames", () => {
    const ls = [rect("f", 0, 0, 10, 10, { type: "frame" as never })];
    expect(setLayersLocked(ls, ["f"], true)[0].locked).toBeUndefined();
  });

  it("setLayersOpacity clampea 0-100 y respeta locks", () => {
    const ls = [rect("a"), rect("b", 0, 0, 10, 10, { locked: true })];
    const out = setLayersOpacity(ls, ["a", "b"], 250);
    expect(out[0].cssVars["--opacity"]).toBe("100");
    expect(out[1].cssVars["--opacity"]).toBeUndefined();
  });
});

describe("nudgeLayers / deleteLayers", () => {
  it("nudge no mueve el frame pero sí sus descendientes incluidos en el set", () => {
    const frame = rect("f", 0, 0, 100, 100, { type: "frame" as never });
    const inner = { ...rect("c", 5, 5), parentId: "f" };
    const ls = [frame, inner, rect("s")];
    const out = nudgeLayers(ls, ["f", "s"], 3, -2);
    expect(tx(out.find((l) => l.id === "f")!)).toBe(0); // el frame no se mueve
    expect(tx(out.find((l) => l.id === "c")!)).toBe(8); // su hijo sí (expande descendientes)
    expect(tx(out.find((l) => l.id === "s")!)).toBe(3);
    expect(ty(out.find((l) => l.id === "s")!)).toBe(-2);
  });

  it("deleteLayers elimina con descendientes", () => {
    const group = rect("g", 0, 0, 50, 50, { type: "group" as never });
    const child = { ...rect("c"), parentId: "g" };
    const out = deleteLayers([group, child, rect("k")], ["g"]);
    expect(ids(out)).toEqual(["k"]);
  });
});

describe("alignLayers", () => {
  it("con frame + un solo target alinea al frame", () => {
    const frame = rect("f", 0, 0, 100, 50, {
      type: "frame" as never,
      pageIndex: 0,
    });
    const box = rect("a", 10, 10, 20, 10, { pageIndex: 0 });
    const out = alignLayers([frame, box], ["a"], "left", { pageIndex: 0 });
    expect(tx(out.find((l) => l.id === "a")!)).toBe(0);
    const outR = alignLayers([frame, box], ["a"], "right", { pageIndex: 0 });
    expect(tx(outR.find((l) => l.id === "a")!)).toBe(80);
    const outC = alignLayers([frame, box], ["a"], "middle", { pageIndex: 0 });
    expect(ty(outC.find((l) => l.id === "a")!)).toBe(20);
  });

  it("con múltiples targets alinea al extremo común", () => {
    const ls = [rect("a", 0, 0), rect("b", 30, 40), rect("c", 60, 10)];
    const out = alignLayers(ls, ["a", "b", "c"], "left");
    expect(out.filter((l) => tx(l) === 0)).toHaveLength(3);
    const outTop = alignLayers(ls, ["a", "b", "c"], "top");
    expect(outTop.every((l) => ty(l) === 0)).toBe(true);
  });

  it("sin targets válidos no cambia", () => {
    const ls = [rect("a")];
    expect(alignLayers(ls, ["z"], "left")).toBe(ls);
  });
});

describe("distributeLayers", () => {
  const three = [rect("a", 0, 0), rect("b", 15, 0), rect("c", 60, 0)];

  it("requiere al menos 3 targets", () => {
    const ls = [rect("a"), rect("b")];
    expect(ids(distributeLayers(ls, ["a", "b"], "horizontal"))).toEqual([
      "a",
      "b",
    ]);
  });

  it("modo gaps iguala separación horizontal", () => {
    const out = distributeLayers(three, ["a", "b", "c"], "horizontal");
    const xs = ["a", "b", "c"].map((id) => tx(out.find((l) => l.id === id)!));
    // gap uniforme: (60-(0+10)-10)/2 = 20 → b.x = 30
    expect(xs).toEqual([0, 30, 60]);
  });

  it("modo centers iguala centros", () => {
    const out = distributeLayers(three, ["a", "b", "c"], "horizontal", {
      mode: "centers",
    });
    const cx = (l: CanvasLayer) => tx(l) + parseMm(l.cssVars["--width"]) / 2;
    const centers = out.map(cx);
    expect(centers[1] - centers[0]).toBeCloseTo(centers[2] - centers[1]);
  });

  it("vertical distribuye por eje Y", () => {
    const ls = [rect("a", 0, 0), rect("b", 0, 10), rect("c", 0, 60)];
    const out = distributeLayers(ls, ["a", "b", "c"], "vertical");
    const ys = out.map(ty);
    expect(ys[1]).toBe(30);
  });
});

describe("groupLayers / ungroupLayers", () => {
  it("agrupa hijos con bbox envolvente y parentId al grupo", () => {
    const ls = [rect("a", 0, 0, 10, 10), rect("b", 40, 30, 10, 10)];
    const { layers: out, groupId } = groupLayers(ls, ["a", "b"]);
    expect(groupId).not.toBe("");
    const group = out.find((l) => l.id === groupId)!;
    expect(group.type).toBe("group");
    expect(tx(group)).toBe(0);
    expect(ty(group)).toBe(0);
    expect(parseMm(group.cssVars["--width"])).toBe(50);
    expect(out.find((l) => l.id === "a")?.parentId).toBe(groupId);
  });

  it("rechaza mezcla de páginas", () => {
    const ls = [
      rect("a", 0, 0, 10, 10, { pageIndex: 0 }),
      rect("b", 0, 0, 10, 10, { pageIndex: 1 }),
    ];
    expect(groupLayers(ls, ["a", "b"]).groupId).toBe("");
  });

  it("sin selección válida devuelve groupId vacío", () => {
    expect(groupLayers([rect("a")], []).groupId).toBe("");
  });

  it("ungroup elimina el grupo y despeja parentId", () => {
    const ls = [rect("a", 0, 0, 10, 10), rect("b", 40, 0, 10, 10)];
    const { layers: grouped, groupId } = groupLayers(ls, ["a", "b"]);
    const out = ungroupLayers(grouped, groupId);
    expect(out.find((l) => l.id === groupId)).toBeUndefined();
    expect(out.find((l) => l.id === "a")?.parentId).toBeUndefined();
  });
});

describe("containerUsesLayoutConstraints", () => {
  it("false para no contenedores o sin constraints", () => {
    const ls = [rect("a")];
    expect(containerUsesLayoutConstraints(ls, "a")).toBe(false);
    const group = rect("g", 0, 0, 50, 50, { type: "group" as never });
    expect(
      containerUsesLayoutConstraints(
        [group, { ...rect("c"), parentId: "g" }],
        "g",
      ),
    ).toBe(false);
  });

  it("true con hijo visible con constraint o autoLayout", () => {
    const group = rect("g", 0, 0, 50, 50, { type: "group" as never });
    const child = {
      ...rect("c"),
      parentId: "g",
      meta: { constraintH: "left" },
    } as CanvasLayer;
    expect(containerUsesLayoutConstraints([group, child], "g")).toBe(true);
    const auto = {
      ...rect("f", 0, 0, 50, 50, { type: "frame" as never }),
      meta: { autoLayout: {} },
    } as CanvasLayer;
    expect(containerUsesLayoutConstraints([auto], "f")).toBe(true);
  });
});
