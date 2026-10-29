from __future__ import annotations

import base64
import hashlib
import json
import uuid
from collections.abc import Callable
from io import BytesIO
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
    "description": "Imprimir un PDF revisado con su hash y opciones exactas; requiere aprobación", "inputSchema": PRINT_SCHEMA},
    {"name": "images_show", "module": "documents", "gated": False,
     "description": "Mostrar imágenes o gráficos ya generados en el chat como una galería persistente. "
                    "Lee PNG, JPEG o WebP del espacio de trabajo o archivos autorizados; no genera imágenes "
                    "ni ejecuta código. Admite hasta 8 imágenes de 25 MiB y 25 megapíxeles cada una (100 MiB en total).",
     "inputSchema": {"type": "object", "properties": {"images": {"type": "array", "minItems": 1, "maxItems": 8,
         "items": {"type": "object", "properties": {"path": {"type": "string"},
                   "title": {"type": "string", "maxLength": 200}}, "required": ["path"]}}}, "required": ["images"]}}]

_IMAGE_FORMATS = {"PNG": ("image/png", ".png"), "JPEG": ("image/jpeg", ".jpg"), "WEBP": ("image/webp", ".webp")}
_MAX_IMAGE_BYTES = 25 * 1024 * 1024
_MAX_IMAGE_PIXELS = 25_000_000


def show_images(store: AgentStore, session_id: str, params: JsonObject) -> JsonObject:
    from PIL import Image, UnidentifiedImageError

    from backend.core.agent import computer_files

    images = params.get("images")
    if not isinstance(images, list) or not 1 <= len(images) <= 8:
        raise ValueError("Indica entre 1 y 8 imágenes")
    root = store.drafts_dir(session_id)
    workspace = store.workspace_dir(session_id)
    grants = store.grants_for(session_id)
    files: list[JsonObject] = []
    created: list[Path] = []
    total = 0
    try:
        for item in images:
            if not isinstance(item, dict):
                raise ValueError("Indica la ruta de cada imagen")
            title = item.get("title", "")
            if not isinstance(title, str) or len(title) > 200:
                raise ValueError("El título de la imagen admite hasta 200 caracteres")
            value = item.get("path")
            draft = drafts.inside(root, value) if isinstance(value, str) and Path(value).is_absolute() else None
            source = computer_files.resolve(value, {}, root) if draft is not None else \
                computer_files.resolve(value, grants, workspace)
            if not source.is_file() or source.stat().st_size > _MAX_IMAGE_BYTES:
                raise ValueError("Cada imagen debe ser un archivo de hasta 25 MiB")
            with source.open("rb") as stream:
                content = stream.read(_MAX_IMAGE_BYTES + 1)
            total += len(content)
            if len(content) > _MAX_IMAGE_BYTES or total > 100 * 1024 * 1024:
                raise ValueError("Las imágenes exceden el tamaño permitido")
            try:
                with Image.open(BytesIO(content)) as image:
                    if image.format not in _IMAGE_FORMATS:
                        raise ValueError("Usa imágenes PNG, JPEG o WebP")
                    mime, suffix = _IMAGE_FORMATS[image.format]
                    width, height = image.size
                    if width * height > _MAX_IMAGE_PIXELS:
                        raise ValueError("Cada imagen admite hasta 25 megapíxeles")
                    image.verify()
                with Image.open(BytesIO(content)) as image:
                    image.load()
            except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError) as err:
                raise ValueError("No se pudo leer una imagen PNG, JPEG o WebP válida") from err
            name = drafts.safe_name(source.stem) + suffix
            root.mkdir(parents=True, exist_ok=True)
            target = root / f"{uuid.uuid4().hex[:12]}_{name}"
            with target.open("xb") as stream:
                stream.write(content)
            created.append(target)
            files.append({"path": str(target), "name": name, "title": title.strip() or name,
                          "mime": mime, "size": len(content), "width": width, "height": height,
                          "sha256": hashlib.sha256(content).hexdigest()})
        return {"artifact": store.add_artifact(session_id, {
            "id": uuid.uuid4().hex, "kind": "image", "family": "image", "module": "documents", "files": files})}
    except Exception:
        for target in created:
            target.unlink(missing_ok=True)
        raise


def verified_file(store: AgentStore, session_id: str, params: JsonObject) -> tuple[JsonObject, JsonObject, Path]:
    artifact = next((item for item in store.artifacts_for(session_id) if item["id"] == params.get("artifact_id")), None)
    if artifact is None:
        raise ValueError("El artefacto no pertenece a esta conversación")
    index = params.get("file_index", 0)
    if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(artifact["files"]):
        raise ValueError("Archivo de artefacto inválido")
    file = artifact["files"][index]
    label = "La imagen" if artifact.get("kind") == "image" else "La página" if artifact.get("kind") == "page" else "El PDF"
    path = drafts.inside(store.drafts_dir(session_id), str(file["path"]))
    is_image = artifact.get("kind") == "image"
    if path is None or not path.is_file() or path.stat().st_size > 100 * 1024 * 1024:
        raise ValueError(f"{label} ya no está disponible en los borradores")
    if is_image:
        from backend.core.agent import computer_files

        computer_files.resolve(str(path), {}, store.drafts_dir(session_id))
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != file["sha256"] or (params.get("sha256") and params["sha256"] != digest):
        if is_image:
            raise ValueError("La imagen cambió; vuelve a registrarla antes de continuar")
        raise ValueError("La página cambió; vuelve a generarla antes de abrirla" if artifact.get("kind") == "page"
                         else "El PDF cambió; vuelve a generarlo y revisarlo antes de continuar")
    return artifact, file, path


def action(store: AgentStore, session_id: str, params: JsonObject) -> JsonObject:
    artifact, file, path = verified_file(store, session_id, params)
    operation = params.get("action")
    if artifact.get("kind") == "page":
        if operation != "file":
            raise ValueError("Abre la página interactiva para consultar sus controles")
        from backend.core.agent.pages import MAX_BYTES

        content = path.read_bytes()
        if len(content) > MAX_BYTES or hashlib.sha256(content).hexdigest() != file["sha256"]:
            raise ValueError("La página cambió; vuelve a generarla antes de abrirla")
        return {"page": json.loads(content), "name": file["name"], "sha256": file["sha256"]}
    if artifact.get("kind") == "image":
        if operation == "file":
            return {"path": str(path), "name": file["name"], "sha256": file["sha256"], "mime": file["mime"]}
        if operation != "preview":
            raise ValueError("Esta acción solo admite documentos PDF")
        from PIL import Image, ImageOps

        limit = 2400 if params.get("full_size") is True else 360
        with path.open("rb") as stream:
            content = stream.read(_MAX_IMAGE_BYTES + 1)
        if hashlib.sha256(content).hexdigest() != file["sha256"]:
            raise ValueError("La imagen cambió; vuelve a registrarla antes de continuar")
        with Image.open(BytesIO(content)) as image:
            if image.width * image.height > _MAX_IMAGE_PIXELS:
                raise ValueError("La imagen excede 25 megapíxeles")
            preview = ImageOps.exif_transpose(image)
            preview.thumbnail((limit, limit))
            png = BytesIO()
            preview.save(png, format="PNG")
        return {"png_base64": base64.b64encode(png.getvalue()).decode("ascii"), "sha256": file["sha256"]}
    if operation == "preview":
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

    artifact, file, _ = verified_file(store, session_id, params)
    if artifact.get("kind") == "image":
        raise ValueError("La impresión solo admite documentos PDF")
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
    if artifact.get("kind") == "image":
        raise ValueError("La impresión solo admite documentos PDF")
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
