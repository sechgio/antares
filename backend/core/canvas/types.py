"""Static contracts for Canvas documents.

The backend still normalizes untyped JSON at runtime; these TypedDicts only
describe the normalized shape for static checks.
"""

from __future__ import annotations

from typing import Literal, TypedDict

CanvasLayerType = Literal[
    "text",
    "image",
    "frame",
    "component",
    "field",
    "logo",
    "imageSlot",
    "rect",
    "grid",
    "group",
    "table",
    "checkbox",
    "signature",
    "line",
    "ellipse",
    "arrow",
    "polygon",
    "star",
    "diamond",
    "hexagon",
    "pentagon",
    "boolean",
]

StrokeCap = Literal["none", "round", "square", "arrow"]
AutoLayoutDirection = Literal["row", "col"]
AutoLayoutAlign = Literal["start", "center", "end", "stretch"]
AutoLayoutSizing = Literal["hug", "fixed"]
FrameConstraint = Literal["start", "end", "center", "scale"]
CanvasStyleKind = Literal["color", "text", "effect"]

CssVars = dict[str, str]


class PathPoint(TypedDict, total=False):
    x: float
    y: float
    hin: dict[str, float] | None
    hout: dict[str, float] | None


class LayerPath(TypedDict, total=False):
    points: list[PathPoint]
    closed: bool


class GridRule(TypedDict, total=False):
    whenImages: int
    cols: int
    rows: int


class LayerAutoLayout(TypedDict):
    direction: AutoLayoutDirection
    gapMm: float
    padMm: float
    alignMain: AutoLayoutAlign
    alignCross: AutoLayoutAlign
    sizing: AutoLayoutSizing


class LayerMeta(TypedDict, total=False):
    key: str
    fallback: str
    side: Literal["left", "right"]
    index: int
    cols: int
    rows: int
    gapMm: float
    colTracks: list[float]
    rowTracks: list[float]
    rules: list[GridRule]
    showDate: bool
    showCoords: bool
    showFilename: bool
    checked: bool
    rowsData: str
    imagesPerPage: int
    pageIndex: int
    path: LayerPath
    autoLayout: LayerAutoLayout
    constraintH: FrameConstraint
    constraintV: FrameConstraint
    instanceOf: str
    overrideVars: dict[str, str]
    variant: str
    componentId: str
    variants: dict[str, dict[str, str]]
    maskLayerId: str
    ops: list[dict[str, str]]


class CanvasLayer(TypedDict, total=False):
    id: str
    type: CanvasLayerType
    name: str
    value: str
    locked: bool
    parentId: str
    visible: bool
    pageIndex: int
    cssVars: CssVars
    meta: LayerMeta
    fillStyleId: str
    textStyleId: str
    effectStyleId: str


class CanvasFieldDef(TypedDict):
    id: str
    key: str
    label: str


class CanvasGuide(TypedDict, total=False):
    id: str
    axis: Literal["x", "y"]
    posMm: float
    pageIndex: int


class CanvasSharedStyle(TypedDict, total=False):
    id: str
    name: str
    kind: CanvasStyleKind
    cssVars: dict[str, str]


class CanvasPage(TypedDict):
    id: str
    name: str


class CanvasSettings(TypedDict, total=False):
    imagesPerPage: int
    gridRules: list[GridRule]
    showRulers: bool
    snapToGrid: bool
    gridSizeMm: float
    pageMarginMm: float


class CanvasDocument(TypedDict, total=False):
    version: int
    id: str
    name: str
    updatedAt: str
    page: dict[str, int]
    layers: list[CanvasLayer]
    fields: list[CanvasFieldDef]
    pages: list[CanvasPage]
    settings: CanvasSettings
    guides: list[CanvasGuide]
    styles: list[CanvasSharedStyle]


# JSON values used by generic IPC helpers.
JsonValue = str | int | float | bool | None | list["JsonValue"] | dict[str, "JsonValue"]
JsonObject = dict[str, JsonValue]
