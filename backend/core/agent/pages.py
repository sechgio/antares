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
TOOL_SPECS: list[JsonObject] = [{
    "name": "page_create", "module": "documents", "gated": False,
    "description": (
        "Crea una página interactiva como borrador de esta conversación, con tarjeta para abrirla. "
        "html contiene marcado y estilos; script contiene JavaScript que enlaza controles con addEventListener. "
        "No hay red, imports externos, Node ni bridge. AntaresPage.data contiene data; AntaresPage.rows y "
        "AntaresPage.columns contienen TODAS las filas y columnas de spreadsheet_path (Excel/CSV autorizado), "
        "sin el recorte de file_read. Calcula indicadores, gráficos y tabla desde las mismas filas filtradas. "
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
            from backend.handlers.spreadsheet import _sniff_csv

            encoding, delimiter = _sniff_csv(source)
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
    return {"artifact": saved, "row_count": len(rows), "columns": columns}
