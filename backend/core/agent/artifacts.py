from __future__ import annotations

import base64
import hashlib
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING

from backend.core.agent import drafts
from backend.core.integrations.types import JsonObject

if TYPE_CHECKING:
    from backend.core.agent.agent import AgentStore

PRINT_SCHEMA: JsonObject = {"type": "object", "properties": {
    "artifact_id": {"type": "string"}, "file_index": {"type": "integer", "minimum": 0},
    "sha256": {"type": "string"}, "printer_name": {"type": "string"},
    "copies": {"type": "integer", "minimum": 1, "maximum": 99}, "pages": {"type": "string"},
    "duplex": {"type": "string", "enum": ["none", "long_edge", "short_edge"]},
    "quality": {"type": "string", "enum": ["draft", "normal", "high"]},
}, "required": ["artifact_id", "file_index", "sha256", "printer_name"]}
TOOL_SPECS: list[JsonObject] = [{"name": "artifact_print", "module": "printing", "gated": True,
    "description": "Imprimir un PDF revisado con su hash y opciones exactas; requiere aprobación", "inputSchema": PRINT_SCHEMA}]


def verified_file(store: AgentStore, session_id: str, params: JsonObject) -> tuple[JsonObject, JsonObject, Path]:
    artifact = next((item for item in store.artifacts_for(session_id) if item["id"] == params.get("artifact_id")), None)
    if artifact is None:
        raise ValueError("El artefacto no pertenece a esta conversación")
    index = params.get("file_index", 0)
    if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(artifact["files"]):
        raise ValueError("Archivo de artefacto inválido")
    file = artifact["files"][index]
    path = drafts.inside(store.drafts_dir(session_id), str(file["path"]))
    if path is None or not path.is_file() or path.stat().st_size > 100 * 1024 * 1024:
        raise ValueError("El PDF ya no está disponible en los borradores")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != file["sha256"] or (params.get("sha256") and params["sha256"] != digest):
        raise ValueError("El PDF cambió; vuelve a generarlo y revisarlo antes de continuar")
    return artifact, file, path


def action(store: AgentStore, session_id: str, params: JsonObject) -> JsonObject:
    artifact, file, path = verified_file(store, session_id, params)
    operation = params.get("action")
    if operation == "preview":
        import base64

        import pymupdf

        page_index = params.get("page", 0)
        with pymupdf.open(path) as pdf:
            if not isinstance(page_index, int) or isinstance(page_index, bool) or not 0 <= page_index < len(pdf):
                raise ValueError("Página de preview inválida")
            page = pdf[page_index]
            scale = min(1.5, 1200 / max(page.rect.width, page.rect.height))
            png = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False).tobytes("png")
        return {"png_base64": base64.b64encode(png).decode("ascii"), "pages": file["pages"], "sha256": file["sha256"]}
    if operation == "review":
        if params.get("sha256") != file["sha256"]:
            raise ValueError("La revisión necesita el hash del PDF mostrado")
        store.review_artifact(session_id, artifact["id"], int(params.get("file_index", 0)), str(file["sha256"]))
        return {"reviewed": True, "sha256": file["sha256"]}
    if operation == "file":
        return {"path": str(path), "name": file["name"], "sha256": file["sha256"]}
    raise ValueError("Acción de artefacto no disponible")


def backend_pdf(store: AgentStore, session_id: str, method: str, result: JsonObject, op_id: str) -> JsonObject:
    """Registra únicamente PDFs de motores locales conocidos; nunca salidas MCP."""
    from backend.core.agent import documents, modules

    if method not in {"sellador_apply", "formatos_generate", "canvas_export_cmyk_pdf",
                      "panel_aviso_corte_render_pdf", "evidencia_volanteo_render"}:
        return result
    if result.get("format") and result["format"] != "pdf":
        return result
    root = store.drafts_dir(session_id)
    root.mkdir(parents=True, exist_ok=True)
    source = result.get("saved_path")
    inline = result.get("pdf_base64") or result.get("content_base64")
    if not source and not inline:
        return result
    if source:
        path = drafts.inside(root, str(source))
        if path is None:
            raise ValueError("El PDF generado está fuera de los borradores de esta conversación")
        content = path.read_bytes()
    else:
        if not isinstance(inline, str):
            raise ValueError("El motor no devolvió un PDF válido")
        content = base64.b64decode(inline, validate=True)
    if len(content) > 100 * 1024 * 1024:
        raise ValueError("El PDF generado supera 100 MiB")
    target = root / f"{uuid.uuid4().hex[:12]}_{drafts.safe_name(result.get('filename') or 'documento.pdf')}"
    with target.open("xb") as stream:
        stream.write(content)
    try:
        file = documents._verify_pdf(target)
        artifact = {"id": op_id, "module": modules.module_for(method), "family": "pdf",
                    "template_id": method, "template_revision": file["sha256"], "files": [file]}
        return {**{key: value for key, value in result.items() if key not in {"pdf_base64", "content_base64"}},
                "artifact": store.add_artifact(session_id, artifact)}
    except Exception:
        target.unlink(missing_ok=True)
        raise


def validate_print(store: AgentStore, session_id: str, params: JsonObject) -> None:
    from backend.core.printing import _DUPLEX_CODES, _QUALITY_DPI, _parse_pages, list_printers

    _, file, _ = verified_file(store, session_id, params)
    copies = params.get("copies", 1)
    if not isinstance(copies, int) or isinstance(copies, bool) or not 1 <= copies <= 99:
        raise ValueError("Las copias deben ser un entero entre 1 y 99")
    if params.get("duplex") is not None and params["duplex"] not in _DUPLEX_CODES:
        raise ValueError("Opción de dúplex inválida")
    if params.get("quality") is not None and params["quality"] not in _QUALITY_DPI:
        raise ValueError("Calidad de impresión inválida")
    if not 1 <= file["pages"] <= 200:
        raise ValueError("La impresión admite entre 1 y 200 páginas")
    _parse_pages(params.get("pages"), file["pages"])
    if params.get("printer_name") not in {item["name"] for item in list_printers()}:
        raise ValueError("Selecciona una impresora instalada en Windows")


def print_artifact(
    store: AgentStore, session_id: str, params: JsonObject, op_id: str,
    *, cancelled: Callable[[], bool] | None = None,
) -> JsonObject:
    from backend.core.agent.cancel import RunCancelled
    from backend.core.printing import print_pdf

    artifact, file, path = verified_file(store, session_id, params)
    if (artifact.get("reviewed") or {}).get(str(params.get("file_index", 0))) != file["sha256"]:
        raise ValueError("Revisa el PDF en el chat antes de imprimirlo")
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != params.get("sha256"):
        raise ValueError("El PDF cambió desde la revisión")
    copy = store.drafts_dir(session_id) / f"print-{uuid.uuid4().hex}.pdf"

    def submitted(job_id: int) -> None:
        try:
            store.dispatch_note(session_id, op_id, {"job_id": job_id, "printer_name": params["printer_name"], "pdf_sha256": file["sha256"]})
        except Exception:
            # StartDoc ya ocurrió: fallar el journal no demuestra que el
            # spooler carezca de efecto, incluso si AbortDoc se solicita.
            raise RunCancelled() from None

    try:
        with copy.open("xb") as stream:
            stream.write(data)
        return {**print_pdf(str(copy), str(params.get("printer_name") or ""), params.get("copies", 1),
            cancelled=cancelled,
            pages=params.get("pages"), duplex=params.get("duplex"), quality=params.get("quality"),
            job_name=f"Antares-{op_id}", on_submitted=submitted),
                "sha256": file["sha256"]}
    finally:
        copy.unlink(missing_ok=True)
