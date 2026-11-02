from __future__ import annotations

import html
import re
from typing import TYPE_CHECKING

from backend.core.agent import pages
from backend.core.integrations.types import JsonObject

if TYPE_CHECKING:
    from backend.core.agent.agent import AgentStore

MAX_BOARDS = 40
MAX_PROPS = 24
MAX_NOTES = 100
_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
_PROP_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,39}$")
_HOLE = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")
_GOTO = re.compile(r"""data-goto\s*=\s*["']([^"']*)["']""", re.IGNORECASE)
_GAP_X, _GAP_Y, _ROW_WIDTH = 80, 120, 4000
_NOTE_COLORS = ["yellow", "blue", "green", "pink", "purple", "gray"]

_BOARD_SCHEMA: JsonObject = {"type": "object", "additionalProperties": False, "properties": {
    "id": {"type": "string", "pattern": _ID.pattern},
    "title": {"type": "string", "maxLength": 120},
    "w": {"type": "integer", "minimum": 40, "maximum": 8000},
    "h": {"type": "integer", "minimum": 40, "maximum": 8000},
    "x": {"type": "integer"}, "y": {"type": "integer"},
    "html": {"type": "string", "minLength": 1, "maxLength": 200000},
    "css": {"type": "string", "maxLength": 100000},
    "props": {"type": "object", "additionalProperties": {"type": "object", "additionalProperties": False, "properties": {
        "type": {"type": "string", "enum": ["color", "text", "number"]},
        "label": {"type": "string", "maxLength": 80},
        "default": {"type": ["string", "number"]},
    }, "required": ["type", "default"]}},
}, "required": ["id"]}
_NOTE_SCHEMA: JsonObject = {"type": "object", "additionalProperties": False, "properties": {
    "id": {"type": "string", "pattern": _ID.pattern},
    "kind": {"type": "string", "enum": ["title", "note"]},
    "text": {"type": "string", "minLength": 1, "maxLength": 2000},
    "x": {"type": "integer"}, "y": {"type": "integer"},
    "w": {"type": "integer", "minimum": 80, "maximum": 4000},
    "color": {"type": "string", "enum": _NOTE_COLORS},
}, "required": ["id", "kind", "text", "x", "y"]}
TOOL_SPECS: list[JsonObject] = [{
    "name": "design_canvas_write", "module": "design", "gated": False,
    "description": (
        "Crea o revisa un lienzo de diseño (pósteres, pantallas de app, páginas web, piezas para redes, invitaciones) "
        "como borrador de esta conversación: artboards de tamaño fijo dispuestos en un lienzo con zoom. "
        "Cada artboard es HTML+CSS autocontenido y aislado (sin scripts, red ni fuentes externas; usa fuentes del "
        "sistema, SVG en línea e imágenes data:). Raíz a tamaño wxh: móvil 390x844, página 1280-1440 de ancho. "
        "props declara ajustes que el usuario prueba en vivo (color, text, number) y se insertan con {{nombre}} en html "
        "o css. Un elemento con data-goto=\"<id de artboard>\" enlaza el prototipo y lleva a ese artboard al pulsarlo. "
        "notes reemplaza las notas del lienzo: kind title rotula un grupo de artboards (encima de su fila); kind note "
        "es un post-it. Sin relleno ni cifras inventadas: usa marcadores como [TU PRECIO]; contraste 4.5:1; botones, "
        "enlaces y campos reales; sin emoji ni degradados genéricos; 1-3 tipografías y 0-2 acentos acordes al tema. "
        "x/y son opcionales: sin ellos se colocan en filas. Para revisar usa artifact_id y expected_revision de "
        "artifacts_list o design_canvas_read y envía solo lo que cambia: un artboard existente conserva los campos "
        "que omitas (mover o renombrar no requiere html); remove quita artboards."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {
        "title": {"type": "string", "minLength": 1, "maxLength": 160},
        "boards": {"type": "array", "maxItems": MAX_BOARDS, "items": _BOARD_SCHEMA},
        "notes": {"type": "array", "maxItems": MAX_NOTES, "items": _NOTE_SCHEMA},
        "remove": {"type": "array", "items": {"type": "string"}},
        "artifact_id": {"type": "string"},
        "expected_revision": {"type": "string"},
    }, "required": ["boards"]},
}, {
    "name": "design_canvas_read", "module": "design", "gated": False,
    "description": (
        "Lee un lienzo de diseño de esta conversación antes de revisarlo: revisión, notas y artboards. "
        "board_ids limita los artboards devueltos con html; el resto llega solo con id, título y posición."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {
        "artifact_id": {"type": "string"},
        "board_ids": {"type": "array", "items": {"type": "string"}},
    }, "required": ["artifact_id"]},
}]

# Renderizador fijo del lienzo; corre en la página aislada de page_create y pinta cada artboard en su propio shadow root.
_SCRIPT = r"""
const canvas = AntaresPage.data.design_canvas;
const root = document.querySelector('#design-canvas');
root.replaceChildren();
root.className = '';
const style = document.createElement('style');
style.textContent = `
body { padding: 0; max-width: none; }
.dc { display: grid; grid-template-rows: auto 1fr; height: max(560px, calc(100vh - 2px)); border: 1px solid var(--page-line); border-radius: 12px; overflow: hidden; }
.dc-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 10px; border-bottom: 1px solid var(--page-line); }
.dc-bar strong { margin-right: auto; overflow: hidden; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.dc-bar button { min-height: 32px; padding: 4px 10px; }
.dc-bar button[aria-pressed="true"] { border-color: var(--page-accent); color: var(--page-accent); }
.dc-bar select { width: auto; max-width: 180px; min-height: 32px; padding: 4px 8px; }
.dc-zoom { min-width: 44px; color: var(--page-muted); font-size: 12px; text-align: center; font-variant-numeric: tabular-nums; }
.dc-body { position: relative; display: flex; min-height: 0; }
.dc-viewport { position: relative; flex: 1; overflow: hidden; cursor: grab; touch-action: none; background: var(--page-field);
  background-image: radial-gradient(color-mix(in srgb, CanvasText 14%, transparent) 1px, transparent 1px); background-size: 24px 24px; }
.dc-viewport.is-panning { cursor: grabbing; }
.dc-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.dc-frame { position: absolute; }
.dc-label { position: absolute; left: 0; bottom: 100%; min-height: 0; margin-bottom: calc(6px / var(--dc-scale, 1)); padding: 0; border: 0;
  background: none; color: var(--page-muted); font-size: calc(13px / var(--dc-scale, 1)); white-space: nowrap; }
.dc-label span { margin-left: .5em; opacity: .7; font-variant-numeric: tabular-nums; }
.dc-frame.is-selected .dc-label { color: var(--page-accent); }
.dc-host { display: block; box-shadow: 0 1px 3px rgb(0 0 0 / .18); }
.dc-frame.is-selected .dc-host { outline: calc(2px / var(--dc-scale, 1)) solid var(--page-accent); outline-offset: calc(2px / var(--dc-scale, 1)); }
.dc-note { position: absolute; white-space: pre-wrap; overflow-wrap: anywhere; }
.dc-note--title { color: var(--page-text); font-size: 48px; font-weight: 650; letter-spacing: -.02em; line-height: 1.1; }
.dc-note--note { width: 240px; padding: 14px 16px; border-radius: 6px; color: #2b2b2b; font-size: 15px; line-height: 1.45;
  box-shadow: 0 1px 2px rgb(0 0 0 / .12), 0 4px 12px rgb(0 0 0 / .08); }
.dc-note[data-color="yellow"] { background: #fdf0b2; } .dc-note[data-color="blue"] { background: #d4e6fb; }
.dc-note[data-color="green"] { background: #d6f0d8; } .dc-note[data-color="pink"] { background: #f9d9e6; }
.dc-note[data-color="purple"] { background: #e5dcf7; } .dc-note[data-color="gray"] { background: #e8e6e1; }
.dc-props { display: grid; align-content: start; gap: 12px; width: 248px; padding: 12px; overflow: auto; border-left: 1px solid var(--page-line); }
.dc-props[hidden] { display: none; }
.dc-props h2 { margin: 0; font-size: 14px; }
.dc-props input[type="color"] { width: 100%; height: 36px; padding: 2px; }
.dc-props-actions { display: flex; gap: 8px; }
@media (max-width: 640px) {
  .dc-props { position: absolute; inset: 0 0 0 auto; width: min(280px, 85%); background: Canvas; box-shadow: -8px 0 24px rgb(0 0 0 / .18); }
  .dc-bar select { max-width: 120px; }
}
`;
document.head.append(style);

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (text, label) => {
  const node = make('button', '', text);
  node.type = 'button';
  if (label) node.setAttribute('aria-label', label);
  return node;
};
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const escapeCss = (value) => String(value).replace(/[<>{};\\]/g, '');
const defaults = (board) => Object.fromEntries(Object.entries(board.props || {}).map(([name, prop]) => [name, prop.default]));
const values = new Map(canvas.boards.map((board) => [board.id, defaults(board)]));
const byId = new Map(canvas.boards.map((board) => [board.id, board]));
const fill = (source, board, escape) => source.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
  (hole, name) => (name in values.get(board.id) ? escape(values.get(board.id)[name]) : hole));
const paint = (board) => {
  frames.get(board.id).host.shadowRoot.innerHTML = `<style>:host { all: initial; display: block; width: ${board.w}px; height: ${board.h}px; overflow: hidden;
    background: #fff; color: #141413; font: 16px/1.5 system-ui, sans-serif; } [data-goto] { cursor: pointer; } ${fill(board.css || '', board, escapeCss)}</style>`
    + fill(board.html, board, escapeHtml);
};

const shell = make('section', 'dc');
shell.setAttribute('aria-label', `Lienzo ${canvas.title}`);
const bar = make('div', 'dc-bar');
const jump = make('select');
jump.setAttribute('aria-label', 'Ir a un artboard');
jump.append(new Option('Todo el lienzo', ''), ...canvas.boards.map((board) => new Option(board.title || board.id, board.id)));
const zoomOut = button('\u2212', 'Alejar');
const zoomLabel = make('span', 'dc-zoom', '100%');
const zoomIn = button('+', 'Acercar');
const fitButton = button('Ajustar', 'Ajustar el lienzo a la vista');
const tweaks = button('Ajustes', 'Mostrar ajustes del artboard seleccionado');
tweaks.setAttribute('aria-pressed', 'false');
bar.append(make('strong', '', canvas.title), jump, zoomOut, zoomLabel, zoomIn, fitButton, tweaks);
const body = make('div', 'dc-body');
const viewport = make('div', 'dc-viewport');
viewport.tabIndex = 0;
viewport.setAttribute('aria-label', 'Lienzo: arrastra para moverte, Ctrl+rueda, + o - para hacer zoom, 0 para ajustar');
const world = make('div', 'dc-world');
const panel = make('aside', 'dc-props');
panel.hidden = true;
panel.setAttribute('aria-label', 'Ajustes del artboard');
viewport.append(world);
body.append(viewport, panel);
shell.append(bar, body);
root.append(shell);

const frames = new Map();
let selected = null;
const renderPanel = () => {
  const board = selected && byId.get(selected);
  tweaks.setAttribute('aria-pressed', String(!panel.hidden));
  if (panel.hidden) return;
  if (!board) {
    panel.replaceChildren(make('h2', '', 'Ajustes'), make('p', '', 'Selecciona un artboard para ver sus ajustes.'));
    return;
  }
  panel.replaceChildren(make('h2', '', board.title || board.id));
  const props = Object.entries(board.props || {});
  if (!props.length) panel.append(make('p', '', 'Este artboard no declara ajustes.'));
  for (const [name, prop] of props) {
    const label = make('label', '', prop.label || name);
    const input = make('input');
    input.type = prop.type === 'color' ? 'color' : prop.type === 'number' ? 'number' : 'text';
    input.value = String(values.get(board.id)[name]);
    input.addEventListener('input', () => {
      values.get(board.id)[name] = prop.type === 'number' ? Number(input.value) : input.value;
      paint(board);
    });
    label.append(input);
    panel.append(label);
  }
  panel.append(make('small', '', 'Los ajustes son una vista previa; pide al agente que los fije.'));
  const actions = make('div', 'dc-props-actions');
  const reset = button('Restablecer');
  reset.disabled = !props.length;
  reset.addEventListener('click', () => { values.set(board.id, defaults(board)); paint(board); renderPanel(); });
  const close = button('Cerrar');
  close.addEventListener('click', () => togglePanel(false));
  actions.append(reset, close);
  panel.append(actions);
};
const togglePanel = (open) => {
  panel.hidden = !open;
  renderPanel();
  if (open) panel.querySelector('input, button')?.focus();
  else tweaks.focus();
};
const select = (id) => {
  selected = id;
  for (const [key, frame] of frames) frame.node.classList.toggle('is-selected', key === id);
  jump.value = id || '';
  renderPanel();
};
panel.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); togglePanel(false); } });
tweaks.addEventListener('click', () => togglePanel(panel.hidden));

for (const note of canvas.notes || []) {
  const node = make('div', `dc-note dc-note--${note.kind}`, note.text);
  Object.assign(node.style, { left: `${note.x}px`, top: `${note.y}px` });
  if (note.w) node.style.width = `${note.w}px`;
  if (note.kind === 'note') node.dataset.color = note.color || 'yellow';
  world.append(node);
}
for (const board of canvas.boards) {
  const node = make('div', 'dc-frame');
  Object.assign(node.style, { left: `${board.x}px`, top: `${board.y}px`, width: `${board.w}px`, height: `${board.h}px` });
  const label = make('button', 'dc-label', board.title || board.id);
  label.type = 'button';
  label.append(make('span', '', `${board.w}\u00d7${board.h}`));
  label.addEventListener('click', () => { select(board.id); togglePanel(true); });
  label.addEventListener('dblclick', () => focusBoard(board.id));
  const host = make('div', 'dc-host');
  host.attachShadow({ mode: 'open' });
  host.shadowRoot.addEventListener('click', (event) => {
    const link = event.target.closest('[data-goto]');
    if (!link) return;
    event.preventDefault();
    if (byId.has(link.dataset.goto)) focusBoard(link.dataset.goto);
  });
  node.append(label, host);
  world.append(node);
  frames.set(board.id, { node, host });
  paint(board);
}

let scale = 1;
let tx = 0;
let ty = 0;
const apply = () => {
  world.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  world.style.setProperty('--dc-scale', String(scale));
  zoomLabel.textContent = `${Math.round(scale * 100)}%`;
};
const zoomAt = (factor, cx, cy) => {
  const next = Math.min(4, Math.max(0.05, scale * factor));
  tx = cx - ((cx - tx) * next) / scale;
  ty = cy - ((cy - ty) * next) / scale;
  scale = next;
  apply();
};
const center = (factor) => {
  const rect = viewport.getBoundingClientRect();
  zoomAt(factor, rect.width / 2, rect.height / 2);
};
const show = (boxes) => {
  const rect = viewport.getBoundingClientRect();
  if (rect.width < 96 || rect.height < 96 || !boxes.length) return false;
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const width = Math.max(...boxes.map((b) => b.x + b.w)) - minX;
  const height = Math.max(...boxes.map((b) => b.y + b.h)) - minY;
  scale = Math.min(2, Math.max(0.05, Math.min((rect.width - 64) / width, (rect.height - 64) / height)));
  tx = (rect.width - width * scale) / 2 - minX * scale;
  ty = (rect.height - height * scale) / 2 - minY * scale;
  apply();
  return true;
};
const boxOf = (board) => ({ x: board.x, y: board.y - 32, w: board.w, h: board.h + 32 });
const fit = () => show([...canvas.boards.map(boxOf), ...[...world.querySelectorAll('.dc-note')].map((node) =>
  ({ x: node.offsetLeft, y: node.offsetTop, w: node.offsetWidth, h: node.offsetHeight }))]);
const focusBoard = (id) => { select(id); show([boxOf(byId.get(id))]); };
jump.addEventListener('change', () => { if (jump.value) focusBoard(jump.value); else { select(null); fit(); } });
zoomOut.addEventListener('click', () => center(1 / 1.25));
zoomIn.addEventListener('click', () => center(1.25));
fitButton.addEventListener('click', fit);
viewport.addEventListener('wheel', (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const rect = viewport.getBoundingClientRect();
  zoomAt(Math.exp(-event.deltaY * 0.002), event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });
viewport.addEventListener('keydown', (event) => {
  const moves = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
  if (event.key === '+' || event.key === '=') center(1.25);
  else if (event.key === '-') center(1 / 1.25);
  else if (event.key === '0') fit();
  else if (moves[event.key]) { tx += moves[event.key][0]; ty += moves[event.key][1]; apply(); }
  else return;
  event.preventDefault();
});
let drag = null;
const boardAt = (target) => [...frames].find(([, frame]) => frame.host === target.closest('.dc-host'))?.[0];
viewport.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target.closest('.dc-label')) return;
  drag = { x: event.clientX, y: event.clientY, tx, ty, moved: false, board: boardAt(event.target) };
  viewport.setPointerCapture(event.pointerId);
});
viewport.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true;
  viewport.classList.add('is-panning');
  tx = drag.tx + dx;
  ty = drag.ty + dy;
  apply();
});
const release = () => {
  if (drag && !drag.moved) select(drag.board || null);
  drag = null;
  viewport.classList.remove('is-panning');
};
viewport.addEventListener('pointerup', release);
viewport.addEventListener('pointercancel', release);
viewport.addEventListener('dblclick', (event) => { const id = boardAt(event.target); if (id) focusBoard(id); });
// Reajusta mientras el iframe cambia de alto, hasta que el usuario mueva la vista.
let touched = false;
for (const type of ['pointerdown', 'keydown']) viewport.addEventListener(type, () => { touched = true; });
bar.addEventListener('click', () => { touched = true; });
jump.addEventListener('focus', () => { touched = true; });
new ResizeObserver(() => { if (!touched) fit(); }).observe(viewport);
requestAnimationFrame(() => { if (!touched) fit(); });
apply();
"""


def _int(value: object, minimum: int, maximum: int, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not minimum <= value <= maximum:
        raise ValueError(f"{label} debe ser un entero entre {minimum} y {maximum}")
    return value


def _board(item: object, previous: JsonObject | None) -> JsonObject:
    if not isinstance(item, dict):
        raise ValueError("Cada artboard debe ser un objeto")
    board_id = item.get("id")
    if not isinstance(board_id, str) or not _ID.match(board_id):
        raise ValueError("Cada artboard necesita id de 1 a 40 letras, dígitos, - o _")
    item = {**(previous or {}), **item}
    source = item.get("html")
    css = item.get("css", "")
    if not isinstance(source, str) or not source.strip() or len(source) > 200000:
        raise ValueError(f"El artboard {board_id} necesita html (máximo 200000 caracteres)")
    if not isinstance(css, str) or len(css) > 100000:
        raise ValueError(f"El css del artboard {board_id} admite hasta 100000 caracteres")
    if re.search(r"<\s*script\b", source, re.IGNORECASE):
        raise ValueError(f"El artboard {board_id} no ejecuta scripts; usa props para los ajustes")
    title = item.get("title", "")
    if not isinstance(title, str) or len(title) > 120:
        raise ValueError(f"El título del artboard {board_id} admite hasta 120 caracteres")
    props = item.get("props", {})
    if not isinstance(props, dict) or len(props) > MAX_PROPS:
        raise ValueError(f"El artboard {board_id} admite hasta {MAX_PROPS} props")
    for name, prop in props.items():
        if not _PROP_NAME.match(name) or not isinstance(prop, dict) or prop.get("type") not in {"color", "text", "number"}:
            raise ValueError(f"La prop {name} de {board_id} necesita un nombre válido y type color, text o number")
        default = prop.get("default")
        if prop["type"] == "number":
            if not isinstance(default, (int, float)) or isinstance(default, bool):
                raise ValueError(f"La prop {name} de {board_id} necesita un default numérico")
        elif not isinstance(default, str) or len(default) > 2000:
            raise ValueError(f"La prop {name} de {board_id} necesita un default de texto")
        if prop["type"] == "color" and not re.fullmatch(r"#[0-9A-Fa-f]{6}", str(default)):
            raise ValueError(f"La prop {name} de {board_id} usa colores #RRGGBB")
        if not isinstance(prop.get("label", ""), str) or len(prop.get("label", "")) > 80:
            raise ValueError(f"La etiqueta de la prop {name} de {board_id} admite hasta 80 caracteres")
    unknown = sorted({hole for hole in _HOLE.findall(source + css) if hole not in props})
    if unknown:
        raise ValueError(f"El artboard {board_id} usa {{{{{unknown[0]}}}}} sin declararla en props")
    board: JsonObject = {"id": board_id, "title": title.strip(),
                         "w": _int(item.get("w"), 40, 8000, f"w de {board_id}"),
                         "h": _int(item.get("h"), 40, 8000, f"h de {board_id}"),
                         "html": source, "css": css, "props": props}
    for axis in ("x", "y"):
        if item.get(axis) is not None:
            board[axis] = _int(item[axis], -100000, 100000, f"{axis} de {board_id}")
    return board


def _note(item: object) -> JsonObject:
    if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not _ID.match(item["id"]):
        raise ValueError("Cada nota necesita id de 1 a 40 letras, dígitos, - o _")
    note_id = item["id"]
    if item.get("kind") not in {"title", "note"}:
        raise ValueError(f"La nota {note_id} necesita kind title o note")
    text = item.get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > 2000:
        raise ValueError(f"La nota {note_id} necesita text (máximo 2000 caracteres)")
    note: JsonObject = {"id": note_id, "kind": item["kind"], "text": text.strip(),
                        "x": _int(item.get("x"), -100000, 100000, f"x de la nota {note_id}"),
                        "y": _int(item.get("y"), -100000, 100000, f"y de la nota {note_id}")}
    if item.get("w") is not None:
        note["w"] = _int(item["w"], 80, 4000, f"w de la nota {note_id}")
    if item.get("color") is not None:
        if item["color"] not in _NOTE_COLORS:
            raise ValueError(f"La nota {note_id} usa color {', '.join(_NOTE_COLORS)}")
        note["color"] = item["color"]
    return note


def _layout(boards: list[JsonObject]) -> None:
    placed = [board for board in boards if "x" in board and "y" in board]
    x = 0
    y = max((board["y"] + board["h"] for board in placed), default=-_GAP_Y) + _GAP_Y
    row_height = 0
    for board in boards:
        if "x" in board and "y" in board:
            continue
        if x and x + board["w"] > _ROW_WIDTH:
            x, y, row_height = 0, y + row_height + _GAP_Y, 0
        board["x"], board["y"] = board.get("x", x), board.get("y", y)
        x += board["w"] + _GAP_X
        row_height = max(row_height, board["h"])


def _existing(store: AgentStore, session_id: str, artifact_id: object) -> tuple[JsonObject, JsonObject]:
    from backend.core.agent import artifacts

    artifact = next((item for item in store.artifacts_for(session_id)
                     if item["id"] == artifact_id and item.get("kind") == "page"), None)
    if artifact is None:
        raise ValueError("El lienzo no pertenece a esta conversación")
    page = artifacts.action(store, session_id, {"artifact_id": artifact["id"], "action": "file"})["page"]
    canvas = page.get("data", {}).get("design_canvas")
    if not isinstance(canvas, dict) or canvas.get("version") != 1:
        raise ValueError("El artefacto no es un lienzo de diseño; usa page_create para páginas")
    return artifact, {"notes": [], **canvas, "title": page["title"]}


def write(params: JsonObject, store: AgentStore, session_id: str) -> JsonObject:
    boards_in = params.get("boards")
    remove = params.get("remove", [])
    if not isinstance(boards_in, list) or len(boards_in) > MAX_BOARDS:
        raise ValueError(f"Indica hasta {MAX_BOARDS} artboards")
    if not isinstance(remove, list) or not all(isinstance(item, str) for item in remove):
        raise ValueError("remove debe ser una lista de ids de artboard")
    current: JsonObject = {"title": "", "boards": [], "notes": []}
    if params.get("artifact_id") is not None:
        _, current = _existing(store, session_id, params["artifact_id"])
    elif params.get("expected_revision") is not None:
        raise ValueError("Indica artifact_id para revisar un lienzo")
    boards: dict[str, JsonObject] = {board["id"]: board for board in current["boards"] if board["id"] not in remove}
    seen: set[str] = set()
    for item in boards_in:
        board_id = item.get("id") if isinstance(item, dict) else None
        if board_id in seen:
            raise ValueError(f"El artboard {board_id} aparece dos veces")
        board = _board(item, boards.get(board_id) if isinstance(board_id, str) else None)
        seen.add(board["id"])
        boards[board["id"]] = board
    ordered = list(boards.values())
    if not ordered or len(ordered) > MAX_BOARDS:
        raise ValueError(f"El lienzo necesita entre 1 y {MAX_BOARDS} artboards")
    for board in ordered:
        missing = sorted({target for target in _GOTO.findall(board["html"]) if target not in boards})
        if missing:
            raise ValueError(f"El artboard {board['id']} enlaza con data-goto a {missing[0]}, que no existe")
    notes_in = params.get("notes")
    if notes_in is None:
        notes = current["notes"]
    elif not isinstance(notes_in, list) or len(notes_in) > MAX_NOTES:
        raise ValueError(f"notes admite hasta {MAX_NOTES} notas")
    else:
        notes = [_note(item) for item in notes_in]
        if len({note["id"] for note in notes}) != len(notes):
            raise ValueError("Cada nota necesita un id distinto")
    _layout(ordered)
    title = params.get("title", current["title"])
    if not isinstance(title, str) or not title.strip() or len(title) > 160:
        raise ValueError("El lienzo necesita title (máximo 160 caracteres)")
    names = ", ".join(html.escape(board["title"] or board["id"]) for board in ordered)
    static = (f'<div id="design-canvas" class="page-header"><h1>{html.escape(title.strip())}</h1>'
              f"<p>{len(ordered)} artboard{'s' if len(ordered) != 1 else ''}: {names}</p></div>")
    canvas = {"version": 1, "title": title.strip(), "boards": ordered, "notes": notes}
    page_params: JsonObject = {"title": title, "html": static, "script": _SCRIPT, "data": {"design_canvas": canvas}}
    for key in ("artifact_id", "expected_revision"):
        if params.get(key) is not None:
            page_params[key] = params[key]
    result = pages.create(page_params, store, session_id)
    return {"artifact": result["artifact"], "boards": [{key: board[key] for key in ("id", "x", "y", "w", "h")}
                                                       for board in ordered], "panel": result["panel"]}


def read(params: JsonObject, store: AgentStore, session_id: str) -> JsonObject:
    artifact, canvas = _existing(store, session_id, params.get("artifact_id"))
    wanted = params.get("board_ids")
    if wanted is not None and (not isinstance(wanted, list) or not all(isinstance(item, str) for item in wanted)):
        raise ValueError("board_ids debe ser una lista de ids de artboard")
    boards = [board if wanted is None or board["id"] in wanted
              else {key: board[key] for key in ("id", "title", "x", "y", "w", "h")} for board in canvas["boards"]]
    return {"artifact_id": artifact["id"], "expected_revision": artifact["template_revision"],
            "title": canvas["title"], "boards": boards, "notes": canvas["notes"]}
