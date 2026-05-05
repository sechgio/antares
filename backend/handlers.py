"""Handlers IPC — exponen toda la lógica de negocio al frontend via JSON-RPC."""

from __future__ import annotations

import json
import logging
import os
import threading
from collections.abc import Callable
from concurrent.futures import CancelledError, ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from functools import wraps
from pathlib import Path
from typing import Any

from backend.core.config_fields import (
    get_field_names,
    load_fields,
    save_fields,
)
from backend.core.config_patterns import (
    load_patterns,
    save_patterns,
)
from backend.core.config_patterns import (
    reset_to_defaults as reset_patterns_defaults,
)
from backend.core.config_theme import (
    PRESETS,
    load_preset,
    load_theme,
    reset_theme,
    save_theme,
)
from backend.core.converter import FORMATOS_SOPORTADOS, VIDEO_FORMATS, convertir_imagen, copiar_archivo, copiar_video, es_video
from backend.core.database import (
    buscar_por_codigo,
    exportar_excel,
    generar_plantilla_excel,
    importar_excel,
    limpiar_base_datos,
    obtener_todos,
)
from backend.core.renamer import RenamerEngine
from backend.ipc_protocol import send_notification
from backend.utils.i18n import set_locale, t
from backend.utils.paths import resource_path
from backend.utils.validators import parse_filename_parts
from backend.version import __version__

logger = logging.getLogger(__name__)


def _preview_templates_dir() -> Path:
    """Resolve report-generator templates in source and PyInstaller builds."""
    bundled = resource_path("backend/templates")
    if bundled.exists():
        return bundled
    return Path(__file__).resolve().parent / "templates"

# ─── Decorador para locale ──────────────────────────────────────────────────

def with_locale(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Auto-set locale from params before executing handler."""
    def wrapper(params: dict[str, Any]) -> Any:
        set_locale(params.get("locale", "es"))
        return fn(params)
    return wrapper


# ─── Decorador de validación ──────────────────────────────────────────────

def validate_params(*required_params):
    """Decorator to validate required parameters."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(params: dict[str, Any]) -> Any:
            # Check required params
            for param in required_params:
                if param not in params or params[param] is None:
                    raise ValueError(f"Missing required parameter: {param}")

            # Validate file paths if present
            for key in ['files', 'destino', 'path', 'folder']:
                if params.get(key):
                    if isinstance(params[key], list):
                        for f in params[key]:
                            _validate_path(f)
                    else:
                        _validate_path(params[key])

            return fn(params)
        return wrapper
    return decorator


_PATH_TRAVERSAL_RE = __import__('re').compile(r'\.\.[\\/]')


def _validate_path(path: str) -> None:
    """Validate that path doesn't contain traversal attempts."""
    if not path or not isinstance(path, str):
        raise ValueError(f"Invalid path: {path}")

    # Reject path traversal
    if '..' in path or _PATH_TRAVERSAL_RE.search(path):
        raise ValueError(f"Path traversal detected: {path}")

# ─── Estado de procesamiento ────────────────────────────────────────────────

@dataclass
class ProcessState:
    running: bool = False
    progress: int = 0
    total: int = 0
    current_file: str = ""
    ok_count: int = 0
    err_count: int = 0
    logs: list[dict[str, str]] = field(default_factory=list)
    cancel_requested: bool = False
    _lock: threading.Lock = field(default_factory=threading.Lock)

_state = ProcessState()


def _reset_state() -> None:
    with _state._lock:
        _state.running = False
        _state.progress = 0
        _state.total = 0
        _state.current_file = ""
        _state.ok_count = 0
        _state.err_count = 0
        _state.logs = []
        _state.cancel_requested = False


def _log(msg: str, tag: str = "info") -> None:
    with _state._lock:
        _state.logs.insert(0, {"message": msg, "tag": tag})
        if len(_state.logs) > 100:
            _state.logs.pop()


# ─── Handlers ─────────────────────────────────────────────────────────────────

class Handlers:
    """Todos los métodos IPC expuestos al frontend.
    Cada método recibe params: dict y retorna un dict/list/primitive.
    """

    # ─── Info ────────────────────────────────────────────────────────────────

    @staticmethod
    @with_locale
    def version(params: dict[str, Any]) -> dict[str, str]:
        return {"version": __version__}

    @staticmethod
    @with_locale
    def formats(params: dict[str, Any]) -> dict[str, list[str]]:
        return {"formats": list(FORMATOS_SOPORTADOS.keys())}

    @staticmethod
    @with_locale
    def plugin_formats(params: dict[str, Any]) -> dict[str, list[str]]:
        from backend.core.format_registry import get_registry
        return {"formats": get_registry().list_formats()}

    # ─── Diálogos ────────────────────────────────────────────────────────────
    # NOTE: These are now handled by Electron's native dialogs
    # The frontend should use window.electronAPI for dialogs directly

    @staticmethod
    @with_locale
    def dialog_files(params: dict[str, Any]) -> dict[str, list[str]]:
        # DEPRECATED: Use Electron's dialog API directly from frontend
        return {"paths": [], "deprecated": True, "message": "Use Electron dialog from frontend"}

    @staticmethod
    @with_locale
    def dialog_folder(params: dict[str, Any]) -> dict[str, list[str]]:
        return {"paths": [], "deprecated": True}

    @staticmethod
    @with_locale
    def dialog_dest(params: dict[str, Any]) -> dict[str, list[str]]:
        return {"paths": [], "deprecated": True}

    @staticmethod
    @with_locale
    def dialog_save(params: dict[str, Any]) -> dict[str, list[str]]:
        return {"paths": [], "deprecated": True}

    # ─── Base de datos ───────────────────────────────────────────────────────

    @staticmethod
    @with_locale
    def db_records(params: dict[str, Any]) -> dict[str, Any]:
        return {"records": obtener_todos(), "fields": get_field_names()}

    @staticmethod
    @with_locale
    @validate_params('path')
    def db_import(params: dict[str, Any]) -> dict[str, int]:
        path = params.get("path", "")
        n = importar_excel(path)
        return {"imported": n}

    @staticmethod
    @with_locale
    @validate_params('path')
    def db_export(params: dict[str, Any]) -> dict[str, int]:
        path = params.get("path", "")
        n = exportar_excel(path)
        return {"exported": n}

    @staticmethod
    @with_locale
    def db_clear(params: dict[str, Any]) -> dict[str, int]:
        n = limpiar_base_datos()
        return {"cleared": n}

    @staticmethod
    @with_locale
    @validate_params('path')
    def db_template(params: dict[str, Any]) -> dict[str, Any]:
        path = params.get("path", "")
        # Ensure .xlsx extension
        if path and not path.lower().endswith('.xlsx'):
            path = path + '.xlsx'
        generar_plantilla_excel(path)
        return {"path": path}

    @staticmethod
    @with_locale
    @validate_params('folder')
    def scan_folder(params: dict[str, Any]) -> dict[str, list[str]]:
        folder = params.get("folder", "")
        path = Path(folder)
        if not path.is_dir():
            return {"files": []}
        exts: set[str] = set()
        # Incluir extensiones de imágenes
        for info in FORMATOS_SOPORTADOS.values():
            exts.update(e.lower() for e in info["ext"])
            exts.update(e.upper() for e in info["ext"])
        # Incluir extensiones de video
        for ext in VIDEO_FORMATS.values():
            exts.add(ext.lower())
            exts.add(ext.upper())
        files = [str(f.resolve()) for f in path.rglob("*") if f.is_file() and f.suffix in exts]
        return {"files": files}

    # ─── Campos ─────────────────────────────────────────────────────────────

    @staticmethod
    @with_locale
    def db_fields(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
        return {"fields": load_fields()}

    @staticmethod
    @with_locale
    def db_fields_update(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
        fields = params.get("fields", [])
        result = save_fields(fields)
        from backend.core.database import init_db
        init_db()
        return {"fields": result}

    @staticmethod
    @with_locale
    def db_fields_reset(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
        from backend.core.config_fields import reset_to_defaults
        result = reset_to_defaults()
        from backend.core.database import init_db
        init_db()
        return {"fields": result}

    # ─── Patrones de renombrado ────────────────────────────────────────────

    @staticmethod
    @with_locale
    def rename_patterns_get(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
        return {"patterns": load_patterns()}

    @staticmethod
    @with_locale
    def rename_patterns_update(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
        patterns = params.get("patterns", [])
        result = save_patterns(patterns)
        return {"patterns": result}

    @staticmethod
    @with_locale
    def rename_patterns_reset(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
        result = reset_patterns_defaults()
        return {"patterns": result}

    # ─── Temas ───────────────────────────────────────────────────────────────

    @staticmethod
    @with_locale
    def theme_get(params: dict[str, Any]) -> dict[str, str]:
        return load_theme()

    @staticmethod
    @with_locale
    def theme_save(params: dict[str, Any]) -> dict[str, str]:
        return save_theme(params)

    @staticmethod
    @with_locale
    def theme_presets(params: dict[str, Any]) -> dict[str, list[str]]:
        return {"presets": list(PRESETS.keys())}

    @staticmethod
    @with_locale
    def theme_preset(params: dict[str, Any]) -> dict[str, str]:
        name = params.get("name", "")
        return load_preset(name)

    @staticmethod
    @with_locale
    def theme_reset(params: dict[str, Any]) -> dict[str, str]:
        return reset_theme()

    # ─── Proceso y Vista Previa ────────────────────────────────────────────

    @staticmethod
    @with_locale
    @validate_params('files')
    def preview(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
        files = params.get("files", [])
        patron = params.get("patron", "")
        secuencia = params.get("secuencia", 1)
        use_filename_seq = params.get("use_filename_seq", True)

        engine = RenamerEngine(patron, secuencia)

        file_seqs = {}
        codigos_manuales = {}
        for f in files:
            code, seq = parse_filename_parts(Path(f).name)
            codigos_manuales[Path(f).name] = code
            if use_filename_seq:
                file_seqs[Path(f).name] = seq

        def lookup(codigo: str) -> dict[str, Any] | None:
            return buscar_por_codigo(codigo)

        res = engine.preview_lote(files, lookup_fn=lookup, codigos_manuales=codigos_manuales, file_seqs=file_seqs)
        preview = [{"origen": Path(orig).name, "nuevo": nuev, "en_bd": en_bd} for orig, nuev, en_bd in res]
        return {"preview": preview}

    @staticmethod
    @with_locale
    @validate_params('files', 'destino')
    def process_start(params: dict[str, Any]) -> dict[str, bool]:
        with _state._lock:
            if _state.running:
                error_msg = "error.process_already_running"
                _log(t(error_msg), "warn")
                return {"started": False}

        files = params.get("files", [])
        if not files or not isinstance(files, list) or len(files) == 0:
            _log(t("error.no_files_to_process"), "error")
            return {"started": False}

        destino = params.get("destino", "")
        if not destino:
            _log(t("error.no_destination"), "error")
            return {"started": False}

        _reset_state()
        with _state._lock:
            _state.running = True
            _state.total = len(files)

        worker_thread = threading.Thread(target=_process_thread, args=(params,), daemon=True)
        worker_thread.start()
        return {"started": True}

    @staticmethod
    @with_locale
    def process_status(params: dict[str, Any]) -> dict[str, Any]:
        with _state._lock:
            return {
                "running": _state.running,
                "progress": _state.progress,
                "current_file": _state.current_file,
                "ok_count": _state.ok_count,
                "err_count": _state.err_count,
                "logs": _state.logs.copy(),
            }

    @staticmethod
    @with_locale
    def process_cancel(params: dict[str, Any]) -> dict[str, bool]:
        with _state._lock:
            _state.cancel_requested = True
        _log(t("info.process_cancelled"), "warn")
        return {"cancelled": True}

    @staticmethod
    @with_locale
    def history_list(params: dict[str, Any]) -> dict[str, Any]:
        from backend.core.history import list_runs
        limit = params.get("limit", 50)
        offset = params.get("offset", 0)
        run_type = params.get("run_type")
        return {"runs": list_runs(run_type, limit, offset)}

    @staticmethod
    @with_locale
    def history_get(params: dict[str, Any]) -> dict[str, Any]:
        from backend.core.history import get_run
        run_id = params.get("id", 0)
        run = get_run(run_id)
        if run:
            run["files"] = json.loads(run["files_json"])
            run["options"] = json.loads(run["options_json"])
        return {"run": run}

    @staticmethod
    @with_locale
    def history_delete(params: dict[str, Any]) -> dict[str, bool]:
        from backend.core.history import delete_run
        run_id = params.get("id", 0)
        return {"deleted": delete_run(run_id)}

    @staticmethod
    @with_locale
    def history_save(params: dict[str, Any]) -> dict[str, Any]:
        from backend.core.history import save_run
        run_id = save_run(
            files=params.get("files", []),
            options=params.get("options", {}),
            patron=params.get("patron", ""),
            formato=params.get("formato", ""),
            calidad=params.get("calidad", 0),
            resize=params.get("resize"),
            ok_count=params.get("ok_count", 0),
            err_count=params.get("err_count", 0),
            run_type=params.get("run_type", "conversion"),
        )
        return {"id": run_id}

    @staticmethod
    @with_locale
    def preview_image(params: dict[str, Any]) -> dict[str, str]:
        from backend.core.converter import convertir_a_preview
        path = params.get("path", "")
        formato = params.get("formato", "PNG")
        calidad = params.get("calidad", 85)
        resize = params.get("resize")
        return convertir_a_preview(path, formato, calidad, resize)

    @staticmethod
    @with_locale
    def is_video(params: dict[str, Any]) -> dict[str, bool]:
        path = params.get("path", "")
        return {"is_video": es_video(path)}

    # ─── Formatos PDF ──────────────────────────────────────────────────────────

    @staticmethod
    @with_locale
    def formatos_list(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
        from backend.core.formatos import list_formats
        return {"formats": list_formats()}

    @staticmethod
    @with_locale
    def formatos_generate(params: dict[str, Any]) -> dict[str, str]:
        from backend.core.formatos import generate_pdf
        fmt_id = params.get("format_id", "")
        desde = int(params.get("desde", 1))
        hasta = int(params.get("hasta", 1))
        pdf_bytes, filename = generate_pdf(fmt_id, desde, hasta)
        import base64
        return {"pdf_base64": base64.b64encode(pdf_bytes).decode("ascii"), "filename": filename}

    @staticmethod
    @with_locale
    def formatos_upload(params: dict[str, Any]) -> dict[str, Any]:
        from backend.core.formatos import add_uploaded_format
        nombre = params.get("nombre", "")
        filename = params.get("filename", "")
        content_b64 = params.get("content_b64", "")
        persisted = params.get("persisted", True)
        filename_pattern = params.get("filename_pattern")
        import base64
        content = base64.b64decode(content_b64)
        entry = add_uploaded_format(nombre, filename, content, bool(persisted), filename_pattern)
        # Ensure has_mapping field is included
        result = dict(entry)
        result["has_mapping"] = result.get("mapping") is not None
        return {"format": result}

    @staticmethod
    @with_locale
    def formatos_delete(params: dict[str, Any]) -> dict[str, bool]:
        from backend.core.formatos import delete_format
        fmt_id = params.get("format_id", "")
        return {"deleted": delete_format(fmt_id)}

    @staticmethod
    @with_locale
    def formatos_update_mapping(params: dict[str, Any]) -> dict[str, Any]:
        from backend.core.formatos import update_mapping
        fmt_id = params.get("format_id", "")
        mapping = params.get("mapping", {})
        entry = update_mapping(fmt_id, mapping)
        if entry is None:
            raise ValueError("Formato no encontrado")
        # Ensure has_mapping field is included
        result = dict(entry)
        result["has_mapping"] = result.get("mapping") is not None
        return {"format": result}

    @staticmethod
    @with_locale
    def image_optimizer_zip(params: dict[str, Any]) -> dict[str, str]:
        """Create a ZIP file from base64-encoded images."""
        import base64
        import io
        import os
        import zipfile

        files = params.get("files", [])
        zip_name = params.get("zip_name", "imagenes_optimizadas")

        if not files:
            raise ValueError("No files provided")

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, mode='w', compression=zipfile.ZIP_DEFLATED) as zip_file:
            for file_info in files:
                filename = file_info.get("filename", "file")
                content_b64 = file_info.get("content_b64", "")
                if not content_b64:
                    continue
                content = base64.b64decode(content_b64)
                safe_name = os.path.basename(filename)
                zip_file.writestr(safe_name, content)

        zip_buffer.seek(0)
        zip_bytes = zip_buffer.read()
        zip_base64 = base64.b64encode(zip_bytes).decode("ascii")

        safe_zip_name = zip_name.strip().replace(" ", "_")
        if not safe_zip_name.lower().endswith(".zip"):
            safe_zip_name += ".zip"

        return {"zip_base64": zip_base64, "filename": safe_zip_name}

    # ─── Plantillas HTML para PreviewPanel ───────────────────────────────────

    @staticmethod
    @with_locale
    def templates_list(params: dict[str, Any]) -> dict[str, list[dict[str, str]]]:
        """Listar plantillas HTML disponibles en backend/templates."""
        templates_dir = _preview_templates_dir()
        if not templates_dir.exists():
            return {"templates": []}

        templates = []
        for f in sorted(templates_dir.glob("*.html")):
            templates.append({
                "id": f.stem,
                "name": f.name,
                "filename": f.name,
            })
        return {"templates": templates}

    @staticmethod
    @with_locale
    @validate_params('name')
    def template_get(params: dict[str, Any]) -> dict[str, str]:
        """Obtener contenido de una plantilla HTML por nombre."""
        name = params.get("name", "")
        templates_dir = _preview_templates_dir()
        target = templates_dir / name

        # Validar que no haya path traversal
        try:
            target.relative_to(templates_dir.resolve())
        except ValueError as err:
            raise ValueError("Invalid template name") from err

        if not target.exists() or not target.is_file():
            raise ValueError(f"Template not found: {name}")

        content = target.read_text(encoding="utf-8")
        return {"name": name, "content": content}


def _process_thread(params: dict[str, Any]) -> None:
    """Thread de procesamiento en background con conversión paralela."""
    set_locale(params.get("locale", "es"))
    files = params.get("files", [])
    destino = params.get("destino", "")
    formato = params.get("formato", "JPEG")
    calidad = params.get("calidad", 95)
    conversion_enabled = params.get("conversion_enabled", True)
    resize_ancho = params.get("resize_ancho")
    resize_alto = params.get("resize_alto")
    keep_exif = params.get("keep_exif", False)
    usar_rename = params.get("usar_rename", True)
    patron = params.get("patron", "")
    secuencia = params.get("secuencia", 1)
    use_filename_seq = params.get("use_filename_seq", True)

    engine = RenamerEngine(patron, secuencia) if usar_rename else None

    resize = None
    if resize_ancho and resize_alto:
        resize = (int(resize_ancho), int(resize_alto))

    ext_dest = FORMATOS_SOPORTADOS[formato]["ext"] if conversion_enabled else None
    total = len(files)

    # Pre-compute output paths (rename lookup needs DB access — do sequentially)
    tasks: list[tuple[str, Path, bool]] = []
    for fpath in files:
        p = Path(fpath)
        is_video_file = es_video(p)

        if engine:
            codigo, seq = parse_filename_parts(p.name)
            datos = buscar_por_codigo(codigo)
            fseq = seq if use_filename_seq else None
            nuevo_nombre = engine.aplicar(p, datos_bd=datos, codigo_manual=codigo, file_seq=fseq)
            if is_video_file or not conversion_enabled:
                out_path = Path(destino) / nuevo_nombre
            else:
                out_path = (Path(destino) / nuevo_nombre).with_suffix(ext_dest)
        else:
            out_path = Path(destino) / p.name if is_video_file or not conversion_enabled else Path(destino) / (p.stem + ext_dest)

        tasks.append((fpath, out_path, is_video_file))

    # Process files in parallel using ThreadPoolExecutor
    # Pillow releases the GIL during C-level image operations (resize, save, convert)
    max_workers = min(os.cpu_count() or 2, 4)
    completed = 0

    def _process_one(task: tuple[str, Path, bool]) -> tuple[bool, str, str]:
        """Process a single file. Returns (success, filename, error_msg)."""
        fpath, out_path, is_video_file = task
        p = Path(fpath)
        try:
            if is_video_file:
                copiar_video(fpath, out_path)
            elif not conversion_enabled:
                copiar_archivo(fpath, out_path)
            else:
                convertir_imagen(fpath, out_path, formato, calidad, resize, keep_exif)
            return (True, out_path.name, "")
        except Exception as e:
            return (False, p.name, str(e))

    pool = ThreadPoolExecutor(max_workers=max_workers)
    futures = [pool.submit(_process_one, task) for task in tasks]
    cancelled = False

    try:
        for future in as_completed(futures):
            if not cancelled:
                with _state._lock:
                    if _state.cancel_requested:
                        cancelled = True
                        _log(t("info.process_cancelled"), "warn")
                        for f in futures:
                            if not f.done():
                                f.cancel()

            if future.cancelled():
                continue

            try:
                success, name, error = future.result()
            except CancelledError:
                continue

            completed += 1

            with _state._lock:
                if success:
                    _state.ok_count += 1
                    _log(f"{'Renombrado' if not conversion_enabled else 'Procesado'}: {name}", "ok")
                else:
                    _state.err_count += 1
                    _log(t("error.process_failed", file=name, error=error), "error")

                _state.progress = int((completed / total) * 100)
                _state.current_file = name
                progress = _state.progress
                current_file = _state.current_file
                ok_count = _state.ok_count
                err_count = _state.err_count

            send_notification("process.progress", {
                "progress": progress,
                "current_file": current_file,
                "ok_count": ok_count,
                "err_count": err_count,
            })
    finally:
        pool.shutdown(wait=True)

    with _state._lock:
        _state.running = False
        _state.progress = 100 if not cancelled else _state.progress
        ok_count = _state.ok_count
        err_count = _state.err_count
    if cancelled:
        _log(t("info.process_cancelled"), "warn")
    else:
        _log(t("info.process_complete", ok=ok_count, err=err_count), "info")
    send_notification("process.complete", {"ok_count": ok_count, "err_count": err_count})
    from backend.core.history import save_run
    save_run(
        files=[str(f) for f in files],
        options={"formato": formato, "calidad": calidad, "conversion_enabled": conversion_enabled, "resize": str(resize) if resize else None, "keep_exif": keep_exif, "usar_rename": usar_rename},
        patron=patron,
        formato=formato,
        calidad=calidad,
        resize=str(resize) if resize else None,
        ok_count=ok_count,
        err_count=err_count,
    )


# ─── Router ─────────────────────────────────────────────────────────────────

HANDLERS: dict[str, Callable[[dict[str, Any]], Any]] = {
    "version": Handlers.version,
    "formats": Handlers.formats,
    "plugin_formats": Handlers.plugin_formats,
    "dialog_files": Handlers.dialog_files,
    "dialog_folder": Handlers.dialog_folder,
    "dialog_dest": Handlers.dialog_dest,
    "dialog_save": Handlers.dialog_save,
    "db_records": Handlers.db_records,
    "db_import": Handlers.db_import,
    "db_export": Handlers.db_export,
    "db_template": Handlers.db_template,
    "db_clear": Handlers.db_clear,
    "scan_folder": Handlers.scan_folder,
    "db_fields": Handlers.db_fields,
    "db_fields_update": Handlers.db_fields_update,
    "db_fields_reset": Handlers.db_fields_reset,
    "rename_patterns_get": Handlers.rename_patterns_get,
    "rename_patterns_update": Handlers.rename_patterns_update,
    "rename_patterns_reset": Handlers.rename_patterns_reset,
    "theme_get": Handlers.theme_get,
    "theme_save": Handlers.theme_save,
    "theme_presets": Handlers.theme_presets,
    "theme_preset": Handlers.theme_preset,
    "theme_reset": Handlers.theme_reset,
    "preview": Handlers.preview,
    "process_start": Handlers.process_start,
    "process_status": Handlers.process_status,
    "process_cancel": Handlers.process_cancel,
    "history_list": Handlers.history_list,
    "history_get": Handlers.history_get,
    "history_delete": Handlers.history_delete,
    "history_save": Handlers.history_save,
    "preview_image": Handlers.preview_image,
    "is_video": Handlers.is_video,
    "formatos_list": Handlers.formatos_list,
    "formatos_generate": Handlers.formatos_generate,
    "formatos_upload": Handlers.formatos_upload,
    "formatos_delete": Handlers.formatos_delete,
    "formatos_update_mapping": Handlers.formatos_update_mapping,

    # ─── Image Optimizer ────────────────────────────────────────────────────

    "image_optimizer_zip": Handlers.image_optimizer_zip,

    # ─── Plantillas PreviewPanel ─────────────────────────────────────────────

    "templates_list": Handlers.templates_list,
    "template_get": Handlers.template_get,
}
