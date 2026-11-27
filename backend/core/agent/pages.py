from __future__ import annotations

import csv
import hashlib
import json
import uuid
from typing import TYPE_CHECKING

from backend.core.agent import computer_files, drafts
from backend.core.integrations.types import JsonObject

if TYPE_CHECKING:
    from backend.core.agent.agent import AgentStore

MIME = "application/vnd.antares.page+json"
MAX_BYTES = 5 * 1024 * 1024
_LEGACY_DESIGN_SCRIPTS = frozenset({
    "2b6e9a3aa3fa8f3edb5f3ccafca87ba9c98ce7a23c8a29ce3f56e722559a723c",
    "28e1550b676022f84e02dcc20e2c8387543e5fdafde7d74711c62a733c1dda78",
})
TOOL_SPECS: list[JsonObject] = [{
    "name": "page_create", "module": "documents", "gated": False,
    "description": (
        "Crea una página interactiva como borrador de esta conversación, con tarjeta para abrirla. "
        "html contiene marcado y estilos; script contiene JavaScript que enlaza controles con addEventListener. "
        "No hay red, imports externos, Node ni bridge. AntaresPage.data contiene data; AntaresPage.rows y "
        "AntaresPage.columns contienen TODAS las filas y columnas de spreadsheet_path (Excel/CSV autorizado), "
        "sin el recorte de file_read. Calcula indicadores, gráficos y tabla desde las mismas filas filtradas. "
        "Los gráficos se renderizan con AntaresPage.chart(elemento, spec) con un spec {type:bar|line|pie,title,labels,series} "
        "y los diagramas Mermaid con AntaresPage.diagram(elemento, fuente); ambos devuelven un manejador con update(fuente) "
        "para redibujar, y un <pre class=\"pele-diagram\"> se renderiza solo. "
        "No fijes colores ni fondos: usa las clases page-* y las variables --page-* para que "
        "la página siga el tema claro u oscuro del chat. "
        "Para modificar una página usa artifact_id y expected_revision de artifacts_list; conserva su identidad."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {
        "title": {"type": "string", "minLength": 1, "maxLength": 160},
        "html": {"type": "string", "minLength": 1, "maxLength": 500000},
        "script": {"type": "string", "maxLength": 500000},
        "data": {"type": "object"},
        "spreadsheet_path": {"type": "string"},
        "artifact_id": {"type": "string"},
        "expected_revision": {"type": "string"},
    }, "required": ["title", "html", "script"]},
}]


def is_design(page: JsonObject) -> bool:
    from backend.core.agent.design_canvas import _SCRIPT

    data = page.get("data")
    canvas = data.get("design_canvas") if isinstance(data, dict) else None
    script = page.get("script")
    return isinstance(canvas, dict) and canvas.get("version") == 1 and isinstance(script, str) and (
        script == _SCRIPT or hashlib.sha256(script.encode()).hexdigest() in _LEGACY_DESIGN_SCRIPTS
    )


def artifact_response(page: JsonObject, name: str, digest: str, *, current: bool) -> JsonObject:
    from backend.core.agent.design_canvas import _SCRIPT

    response: JsonObject = {"page": page, "name": name, "sha256": digest}
    if is_design(page):
        response.update(page={**page, "script": _SCRIPT}, design_current=current)
    return response


def save_design_adjustments(store: AgentStore, session_id: str, params: JsonObject, page: JsonObject) -> JsonObject:
    from backend.core.agent.design_canvas import MAX_BOARDS, write

    if not is_design(page):
        raise ValueError("Solo puedes guardar ajustes en un lienzo de diseño")
    changes = params.get("adjustments")
    if not isinstance(changes, dict) or not 0 < len(changes) <= MAX_BOARDS:
        raise ValueError("Indica los ajustes de al menos un artboard")
    boards = {board["id"]: board for board in page["data"]["design_canvas"]["boards"]}
    updates = []
    for board_id, values in changes.items():
        props = boards.get(board_id, {}).get("props", {})
        if not isinstance(values, dict) or not values or values.keys() - props.keys():
            raise ValueError(f"El artboard {board_id} contiene ajustes desconocidos")
        updated = {name: {**prop, "default": values.get(name, prop["default"])} for name, prop in props.items()}
        if any(value != props[name]["default"] or type(value) is not type(props[name]["default"]) for name, value in values.items()):
            updates.append({"id": board_id, "props": updated})
    if not updates:
        return {"sha256": params["sha256"]}
    result = write({"artifact_id": params["artifact_id"], "expected_revision": params["sha256"], "boards": updates},
                   store, session_id)
    return {"sha256": result["artifact"]["template_revision"]}


def create(params: JsonObject, store: AgentStore, session_id: str) -> JsonObject:
    for key, limit in (("title", 160), ("html", 500000), ("script", 500000)):
        value = params.get(key)
        if not isinstance(value, str) or len(value) > limit or (key != "script" and not value.strip()):
            raise ValueError(f"La página necesita {key} válido (máximo {limit} caracteres)")
    if not isinstance(params.get("data", {}), dict):
        raise ValueError("Los datos de la página deben ser un objeto JSON")
    existing = None
    if params.get("artifact_id") is not None:
        existing = next((item for item in store.artifacts_for(session_id)
                         if item["id"] == params["artifact_id"] and item.get("kind") == "page"), None)
        if existing is None:
            raise ValueError("La página no pertenece a esta conversación")
        if params.get("expected_revision") != existing["template_revision"]:
            raise ValueError("La página cambió; lee artifacts_list antes de actualizarla")
    elif params.get("expected_revision") is not None:
        raise ValueError("Indica artifact_id para actualizar una página")
    previous: JsonObject = {}
    if existing:
        from backend.core.agent import artifacts

        previous = artifacts.action(store, session_id, {"artifact_id": existing["id"], "action": "file"})["page"]
    rows: list[JsonObject] = previous.get("rows", [])
    if params.get("spreadsheet_path") is not None:
        source = computer_files.resolve(params["spreadsheet_path"], store.grants_for(session_id),
                                        store.workspace_dir(session_id))
        if not source.is_file() or source.stat().st_size > 100 * 1024 * 1024:
            raise ValueError("La hoja no está disponible o supera 100 MiB")
        if source.suffix.lower() == ".csv":
            from backend.utils.text_decoding import sniff_csv

            encoding, delimiter = sniff_csv(source)
            with source.open(encoding=encoding, newline="") as stream:
                rows = [dict(row) for row in csv.DictReader(stream, delimiter=delimiter) if any(row.values())]
        elif source.suffix.lower() in {".xlsx", ".xlsm", ".xls"}:
            from backend.core.panel_aviso_corte import parse_excel_bytes

            rows = [dict(row) for row in parse_excel_bytes(source.read_bytes(), source.name).rows]
        else:
            raise ValueError("La página admite datos de Excel o CSV")
    columns = list(dict.fromkeys(key for row in rows for key in row))
    payload = {"version": 1, "title": params["title"].strip(), "html": params["html"],
               "script": params["script"], "data": params.get("data", previous.get("data", {})),
               "rows": rows, "columns": columns}
    content = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
    if len(content) > MAX_BYTES:
        raise ValueError("La página supera 5 MiB; reduce los datos o el código, sin omitir filas silenciosamente")
    digest = hashlib.sha256(content).hexdigest()
    root = store.drafts_dir(session_id)
    root.mkdir(parents=True, exist_ok=True)
    target = root / f"{uuid.uuid4().hex}.page.json"
    if drafts.inside(root, str(target)) is None:
        raise ValueError("El destino de la página no es seguro")
    artifact = {"id": existing["id"] if existing else uuid.uuid4().hex, "kind": "page", "family": "page",
                "title": payload["title"], "template_id": "page", "template_revision": digest,
                "files": [{"path": str(target), "name": f"{payload['title']}.html", "sha256": digest,
                           "mime": MIME, "size": len(content)}]}
    output_stream = target.open("xb")
    try:
        with output_stream:
            output_stream.write(content)
        saved = store.add_artifact(session_id, artifact,
                                   expected_revision=existing["template_revision"] if existing else None)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return {"artifact": saved, "row_count": len(rows), "columns": columns,
            "panel": {"type": "page", "props": {"artifact_id": saved["id"], "sha256": digest, "title": payload["title"]}}}
