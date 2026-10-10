"""Preparación y exportación de los PDFs configurados con la guía de Flujos."""

from __future__ import annotations

import base64
import csv
import hashlib
import json
import re
import time
import unicodedata
from datetime import date
from pathlib import Path

from backend.core.flows.types import JsonObject
from backend.utils.atomic_write import atomic_output_file
from backend.utils.validators import sanitizar_nombre


def _digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _flatten(value: JsonObject, prefix: str = "") -> JsonObject:
    result: JsonObject = {}
    for key, item in value.items():
        field = f"{prefix}.{key}" if prefix else key
        if isinstance(item, dict):
            result.update(_flatten(item, field))
        else:
            result[field] = json.dumps(item, ensure_ascii=False) if isinstance(item, list) else str("" if item is None else item)
    return result


def template_profile(kind: str, template_id: str) -> JsonObject:
    if kind == "html":
        from jinja2 import Environment, nodes

        from backend.handlers.flows import _batch_template_profile
        from backend.handlers.templates import template_get

        profile = _batch_template_profile(template_id)
        content = template_get({"name": template_id})["content"]
        ast = Environment().parse(content)
        roots = {node.name for output in ast.find_all(nodes.Output) for node in output.find_all(nodes.Name) if node.ctx == "load"}
        roots.difference_update(Environment().globals)
        roots.difference_update({"loop", "self", "super"})
        roots.difference_update(node.name for node in ast.find_all(nodes.Name) if node.ctx != "load")
        roots.difference_update(node.name for node in ast.find_all(nodes.Macro))
        optional = {node.node.name for node in ast.find_all(nodes.Filter) if node.name in {"default", "d"} and isinstance(node.node, nodes.Name)}
        roots.difference_update({"reports", "fichas", "panels", "pages", "data", "row", "title", "logo_left", "logo_right", "logo_center"})
        if template_id == "evidencia-volanteo.html":
            from backend.core.evidencia_volanteo.layout import layout_context

            roots.difference_update(layout_context())
        if template_id in {"technical_reports/informe_tecnico.html", "informes_v2/informe_v2.html", "informes_v2/reservorios_2.html", "fichas_tecnicas/ficha_tecnica.html"}:
            roots.clear()
        profile["root_fields"] = sorted(roots)
        profile["fields"] = list(dict.fromkeys([*profile["fields"], *sorted(roots)]))
        profile["required_fields"] = list(dict.fromkeys([*profile["required_fields"], *sorted(roots - optional)]))
        profile["version"] = _digest(content)
        return profile
    if kind == "canvas":
        from backend.handlers.canvas import canvas_get

        document = canvas_get({"id": template_id})["document"]
        fields: set[str] = set()
        images = 0
        for layer in document.get("layers") or []:
            meta = layer.get("meta") or {}
            if layer.get("type") == "field" and meta.get("key"):
                fields.add(str(meta["key"]))
            if layer.get("type") in {"field", "text"}:
                fields.update(re.findall(r"\{\{\s*([\w]+)\s*\}\}", str(layer.get("value") or "")))
            if layer.get("type") in {"image", "imageSlot"} and "index" in meta:
                images = max(images, int(meta["index"]) + 1)
        if not document.get("layers"):
            raise ValueError("La plantilla de Canvas no contiene elementos")
        return {"fields": sorted(fields), "required_fields": sorted(fields), "image_limit": images,
                "field_labels": {}, "version": _digest(document), "document": document}
    if kind == "formato":
        from backend.core.formatos import get_template_pdf

        content, _ = get_template_pdf(template_id)
        return {"fields": ["NUMERO"], "required_fields": ["NUMERO"], "image_limit": 0,
                "field_labels": {"NUMERO": "Número del documento"}, "version": hashlib.sha256(content).hexdigest()}
    raise ValueError("Selecciona una plantilla HTML, de Canvas o un formato PDF")


def _folder(value: object, grants: JsonObject, mode: str) -> Path | None:
    if not value:
        return None
    if not isinstance(value, str) or value not in grants.get(mode, []):
        raise ValueError("Selecciona las carpetas con los diálogos de Antares")
    path = Path(value)
    if not path.is_absolute() or path.is_symlink() or any(p.is_symlink() for p in path.parents):
        raise ValueError("La carpeta debe ser absoluta y no contener enlaces simbólicos")
    return path


def _filename(pattern: str, data: JsonObject, fingerprint: str, index: int | None) -> str:
    if not pattern.strip() or any(c in pattern for c in ("/", "\\", "..")):
        raise ValueError("El nombre debe ser un archivo PDF, sin rutas ni '..'")

    def replace(match: re.Match[str]) -> str:
        field = match.group(1)
        if field not in data or not str(data[field]).strip():
            raise ValueError(f"Completa el campo {field} utilizado en el nombre del PDF")
        return str(data[field])

    name = re.sub(r"\{([^{}]+)\}", replace, pattern)
    if "{" in name or "}" in name:
        raise ValueError("Revisa las llaves del nombre del PDF")
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
    stem = name[:-4] if name.lower().endswith(".pdf") else name
    stem = stem[:110].strip(" .") or "Documento"
    if re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])", stem.split(".")[0]):
        stem = f"_{stem}"
    suffix = f"-{index + 1}" if index is not None else ""
    return sanitizar_nombre(f"{stem}{suffix}-{fingerprint[:12]}.pdf")


def output_paths(params: JsonObject) -> list[str]:
    contexts = params["contexts"]
    individual = params.get("output_mode") == "individual"
    root = Path(params["output_path"]).parent
    pattern = str(params.get("filename_pattern") or "Documento.pdf")
    rows = contexts if individual else contexts[:1]
    return [str(root / _filename(pattern, item["data"], params["fingerprint"], i if individual else None))
            for i, item in enumerate(rows)]


def prepare(params: JsonObject) -> JsonObject:
    from backend.core.panel_aviso_corte import parse_excel_bytes
    from backend.core.panel_aviso_corte.matcher import _normalize_date_str
    from backend.handlers import HANDLERS
    from backend.handlers.flows import _store

    grants = params.get("_flow_file_grants") or {}
    if not _store().verify_paths(grants):
        raise ValueError("Vuelve a seleccionar las carpetas y archivos del flujo")
    output = _folder(params.get("output_folder"), grants, "write")
    source = _folder(params.get("source_folder"), grants, "folders")
    if output is None or not output.is_dir() or (source is not None and not source.is_dir()):
        return {"ready": False, "reason": "Selecciona carpetas de origen y salida disponibles"}
    kind = str(params.get("template_kind") or "html")
    template_id = str(params.get("template_id") or "")
    if not template_id:
        return {"ready": False, "reason": "Selecciona una plantilla para el PDF"}
    profile = template_profile(kind, template_id)
    rows = params.get("rows")
    records_source = params.get("records_source")
    if records_source:
        if records_source not in {"technical_reports", "informes_v2", "fichas_tecnicas"}:
            raise ValueError("Selecciona una herramienta de datos disponible")
        handler = HANDLERS.get(f"{records_source}_list")
        if handler is None:
            raise ValueError("La herramienta de datos no está disponible")
        rows = [_flatten(row) for row in handler({"summary": False})["items"]]
    sheet_value = params.get("spreadsheet_path")
    if sheet_value:
        sheet = Path(sheet_value)
        if str(sheet) not in grants.get("read", []) or sheet.is_symlink() or any(p.is_symlink() for p in sheet.parents):
            raise ValueError("Selecciona el Excel con el diálogo de Antares")
        if not sheet.is_file() or time.time() - sheet.stat().st_mtime < 15:
            return {"ready": False, "reason": "Esperando que termine la copia del Excel"}
        if sheet.stat().st_size > 100 * 1024 * 1024:
            raise ValueError("El Excel excede el máximo de 100 MiB")
        if sheet.suffix.lower() == ".csv":
            from backend.handlers.spreadsheet import _sniff_csv

            encoding, delimiter = _sniff_csv(sheet)
            with sheet.open("r", encoding=encoding, newline="") as handle:
                rows = []
                for row in csv.DictReader(handle, delimiter=delimiter):
                    if None in row:
                        raise ValueError("El CSV tiene filas con más valores que columnas")
                    if any(value for value in row.values()):
                        rows.append(row)
                    if len(rows) > 200:
                        break
        else:
            parsed = parse_excel_bytes(sheet.read_bytes(), sheet.name)
            rows = [dict(row) for row in parsed.rows]
    if kind == "formato":
        start, end = params.get("number_from", 1), params.get("number_to", 1)
        if any(not isinstance(n, int) or isinstance(n, bool) for n in (start, end)) or not 0 <= start <= end or end - start >= 200:
            raise ValueError("Elige un rango de hasta 200 números, con final mayor o igual al inicial")
        rows = [{"NUMERO": str(n)} for n in range(start, end + 1)]
    if rows is None:
        rows = [{}]
    if not isinstance(rows, list) or not rows or len(rows) > 200 or any(not isinstance(r, dict) for r in rows):
        raise ValueError("Selecciona entre uno y 200 registros para el lote")
    headers = list(dict.fromkeys(key for row in rows for key in row))
    mappings = params.get("field_mappings") or {}
    values = params.get("field_values") or {}
    selections = params.get("photo_selections") or {}
    overrides = params.get("row_values") or {}
    if any(not isinstance(v, dict) for v in (mappings, values, selections, overrides)):
        raise ValueError("Revisa los campos y las fotos del lote")
    if any(not isinstance(k, str) or not isinstance(v, str) for k, v in mappings.items()):
        raise ValueError("El mapeo debe contener campos y nombres de columnas")
    if any(not isinstance(value, dict) for value in overrides.values()):
        raise ValueError("Las correcciones deben contener los campos de cada registro")
    def normal(text: str) -> str:
        return re.sub(r"[\W_]", "", unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().casefold())
    suggested = {field: next((h for h in headers if normal(h) in {normal(field), normal(field.rsplit('.', 1)[-1])}), "")
                 for field in profile["fields"]}
    key_column = "" if kind == "formato" else str(params.get("match_key") or next((h for key in ("ot", "nis", "headersgio", "osnumero", "id") for h in headers if normal(h) == key), ""))
    date_column = "" if kind == "formato" else str(params.get("match_date") or "")
    required = list(dict.fromkeys([*profile["required_fields"], *(params.get("required_fields") or [])]))
    expected = params.get("images_per_panel", min(1, profile["image_limit"]))
    if not isinstance(expected, int) or isinstance(expected, bool) or not 0 <= expected <= profile["image_limit"]:
        raise ValueError("Revisa la cantidad de fotos obligatorias para la plantilla")
    files = sorted((p for p in source.rglob("*") if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
                    and not p.is_symlink() and not any(parent.is_symlink() for parent in p.parents)), key=lambda p: p.as_posix()) if source and profile["image_limit"] else []
    if len(files) > 1000:
        raise ValueError("La carpeta excede el máximo de 1000 imágenes")
    if any(p.stat().st_size == 0 or time.time() - p.stat().st_mtime < 15 for p in files):
        return {"ready": False, "reason": "Esperando que termine la copia de las imágenes"}
    names = [p.relative_to(source).as_posix() for p in files] if source else []
    identities = [(str("" if row.get(key_column) is None else row[key_column]).strip(), _normalize_date_str(str(row.get(date_column) or "")) if date_column else "") for row in rows]
    candidates: JsonObject = {}
    for name in names:
        matches = [i for i, (key, day) in enumerate(identities) if key and re.search(rf"(?<![A-Za-z0-9]){re.escape(key)}(?![A-Za-z0-9])", name, re.IGNORECASE)
                   and (not date_column or any(day == _normalize_date_str(d.replace("_", "-")) for d in re.findall(r"\d{4}[-_]\d{2}[-_]\d{2}|\d{2}[-_]\d{2}[-_]\d{4}", name)))]
        candidates[name] = matches
    previews: list[JsonObject] = []
    contexts: list[JsonObject] = []
    pending: list[str] = []
    used: set[str] = set()
    for i, (row, (key, day)) in enumerate(zip(rows, identities, strict=True)):
        record_key = _digest([key, day])[:16] if key else str(i)
        data = {**_flatten(row), **{field: str("" if row.get(column) is None else row[column]) for field, column in mappings.items() if column}, **values, **overrides.get(record_key, {})}
        data.setdefault("OT", key)
        data.setdefault("FECHA_TRABAJO", day)
        automatic = [name for name in names if candidates[name] == [i]][:profile["image_limit"]]
        chosen = selections.get(record_key, automatic)
        errors = []
        if not isinstance(chosen, list) or any(name not in names for name in chosen) or len(set(chosen)) != len(chosen) or len(chosen) > profile["image_limit"]:
            chosen = []
            errors.append("Revisa las fotos seleccionadas")
        if len(chosen) < expected:
            errors.append(f"Esperando {expected} fotos; hay {len(chosen)} seleccionadas")
        if key_column and not key:
            errors.append("Falta la clave del registro")
        if expected and not key_column and record_key not in selections:
            errors.append("Selecciona la columna que identifica las fotos")
        if date_column:
            try:
                date.fromisoformat(day)
            except ValueError:
                errors.append("Falta una fecha válida para asociar las fotos")
        if identities.count((key, day)) > 1 and key:
            errors.append("La clave se repite; elige una fecha o una clave única")
        if record_key not in selections and any(i in indexes and len(indexes) > 1 for indexes in candidates.values()):
            errors.append("Hay fotos ambiguas: asígnalas en la vista previa")
        if used.intersection(chosen):
            errors.append("Una foto está asignada a más de un registro")
        errors.extend(f"Falta {field}" for field in required if data.get(field) is None or not str(data.get(field)).strip())
        errors.extend(f"La columna {column} ya no existe" for column in mappings.values() if column and column not in headers)
        used.update(chosen)
        contexts.append({"data": data, "images": [f"flow-image:{name}" for name in chosen]})
        previews.append({"row_index": i, "record_key": record_key, "ot": key, "date": day, "data": data,
                         "images": chosen, "candidates": names, "errors": errors})
        pending.extend(f"Registro {i + 1}: {error}" for error in errors)
    selected = {f"flow-image:{name}": str(files[names.index(name)]) for name in used}
    if sum(Path(p).stat().st_size for p in selected.values()) > 100 * 1024 * 1024:
        raise ValueError("Las imágenes seleccionadas exceden 100 MiB")
    digests = {ref: hashlib.sha256(Path(p).read_bytes()).hexdigest() for ref, p in selected.items()}
    stamps = {ref: Path(p).stat().st_mtime_ns for ref, p in selected.items()}
    mode = params.get("output_mode", "consolidado")
    if mode not in {"consolidado", "individual"}:
        raise ValueError("Selecciona salida consolidada o individual")
    if kind == "canvas" and mode == "consolidado" and (len(contexts) > 50 or len(contexts) * len(profile["document"].get("pages") or [1]) > 200 or len(selected) > 64):
        pending.append("El consolidado de Canvas admite hasta 50 registros, 200 páginas y 64 imágenes; usa salida individual o reduce el lote")
    fingerprint = _digest([kind, template_id, profile["version"], contexts, digests, stamps, mode, params.get("filename_pattern")])
    pdf_args = {"guided_pdf": True, "template_kind": kind, "template_id": template_id, "template_version": profile["version"], "contexts": contexts,
                "localImagePaths": selected, "photo_digests": digests, "photo_stamps": stamps, "output_mode": mode,
                "filename_pattern": params.get("filename_pattern") or "Documento.pdf", "fingerprint": fingerprint, "required_image_count": expected,
                "output_path": str(output / "Documento.pdf")}
    try:
        planned = output_paths(pdf_args)
    except ValueError as exc:
        planned = []
        pending.append(str(exc))
    result = {"ready": not pending, "reason": pending[0] if pending else "Lote completo",
              "guided_pdf": True, "fingerprint": fingerprint, "files": list(selected.values()), "contexts": contexts,
              "localImagePaths": selected, "output_folder": str(output), "output_path": planned[0] if planned else str(output / "Documento.pdf"),
              "planned_paths": planned, "output_names": [Path(p).name for p in planned], "pdf_args": pdf_args,
              "headers": headers, "match_key": key_column, "suggested_mappings": suggested, "image_limit": profile["image_limit"],
              "field_labels": profile["field_labels"], "required_fields": required, "preview": previews, "pending": pending}
    if not pending and params.get("preview_pdf") is True:
        index = params.get("preview_index", 0)
        if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(contexts):
            raise ValueError("Selecciona un registro disponible para la vista previa")
        preview_params = {**pdf_args, "contexts": [contexts[index]]}
        pdf = _render(preview_params)
        if len(pdf) > 40 * 1024 * 1024:
            raise ValueError("La vista previa supera 40 MiB; reduce las imágenes del registro")
        result["pdf_base64"] = base64.b64encode(pdf).decode("ascii")
        import pymupdf

        with pymupdf.open(stream=pdf, filetype="pdf") as document:
            result["preview_pages"] = len(document)
    return result


def _render(params: JsonObject) -> bytes:
    kind = params["template_kind"]
    contexts = params["contexts"]
    refs = {ref for item in contexts for ref in item.get("images") or []}
    paths = {ref: path for ref, path in params["localImagePaths"].items() if ref in refs}
    if kind == "html":
        from backend.handlers.flows import _render_pdf

        root_fields = template_profile("html", params["template_id"])["root_fields"]
        if root_fields and len(contexts) > 1:
            import pymupdf

            with pymupdf.open() as merged:
                total_bytes = 0
                for item in contexts:
                    content = _render({**params, "contexts": [item]})
                    total_bytes += len(content)
                    if total_bytes > 100 * 1024 * 1024:
                        raise ValueError("El lote de PDFs supera 100 MiB; divide los registros en lotes más pequeños")
                    with pymupdf.open(stream=content, filetype="pdf") as part:
                        merged.insert_pdf(part)
                return bytes(merged.tobytes())
        data = contexts[0]["data"]
        result = _render_pdf({"template_name": params["template_id"], "contexts": contexts,
                              "context": {"data": data, "row": data, **{field: data[field] for field in root_fields if field in data}},
                              "localImagePaths": paths, "photo_digests": params["photo_digests"], "_preview_pdf": True,
                              "_guided_contexts": True, "expected_pages": len(contexts)})
        if not result.get("pdf_base64"):
            raise ValueError(result.get("reason") or "No se pudo preparar el PDF")
        return base64.b64decode(result["pdf_base64"])
    if kind == "canvas":
        from backend.handlers.canvas import canvas_export_cmyk_pdf, canvas_get

        result = canvas_export_cmyk_pdf({"document": canvas_get({"id": params["template_id"]})["document"],
                                        "contexts": contexts, "localImagePaths": paths, "_inline_only": True})
        if not result.get("pdf_base64"):
            raise ValueError("El PDF de Canvas excede el límite de tamaño para este lote")
        return base64.b64decode(result["pdf_base64"])
    if kind == "formato":
        from backend.core.formatos import generate_pdf

        numbers = [int(item["data"]["NUMERO"]) for item in contexts]
        return generate_pdf(params["template_id"], min(numbers), max(numbers))[0]
    raise ValueError("Selecciona una plantilla válida")


def export_pdf(params: JsonObject) -> JsonObject:
    contexts = params.get("contexts")
    if not isinstance(contexts, list) or not contexts or len(contexts) > 200:
        return {"ready": False, "reason": "Espera a que el lote esté completo"}
    profile = template_profile(params["template_kind"], params["template_id"])
    if profile["version"] != params.get("template_version"):
        return {"ready": False, "reason": "La plantilla cambió; vuelve a revisar el lote"}
    if any(any(item["data"].get(field) is None or not str(item["data"].get(field)).strip() for field in profile["required_fields"]) for item in contexts):
        return {"ready": False, "reason": "Completa los campos obligatorios antes de generar"}
    if any(len(item.get("images") or []) < params.get("required_image_count", 0) for item in contexts):
        return {"ready": False, "reason": "Espera todas las fotos obligatorias antes de generar"}
    paths = params.get("localImagePaths") or {}
    if any(hashlib.sha256(Path(path).read_bytes()).hexdigest() != params.get("photo_digests", {}).get(ref)
           or Path(path).stat().st_mtime_ns != params.get("photo_stamps", {}).get(ref) for ref, path in paths.items()):
        return {"ready": False, "reason": "Las fotos cambiaron; vuelve a revisar el lote"}
    planned = output_paths(params)
    individual = params.get("output_mode") == "individual"
    payloads = [{**params, "contexts": [item]} for item in contexts] if individual else [params]
    rendered: list[tuple[str, bytes]] = []
    total_bytes = 0
    for path, payload in zip(planned, payloads, strict=True):
        pdf = _render(payload)
        total_bytes += len(pdf)
        if total_bytes > 100 * 1024 * 1024:
            raise ValueError("El lote de PDFs supera 100 MiB; divide los registros en lotes más pequeños")
        rendered.append((path, pdf))
    if template_profile(params["template_kind"], params["template_id"])["version"] != params.get("template_version"):
        return {"ready": False, "reason": "La plantilla cambió; vuelve a revisar el lote"}
    for path, pdf in rendered:
        destination = Path(path)
        if destination.is_symlink() or any(parent.is_symlink() for parent in destination.parents):
            raise ValueError("El archivo de salida no puede contener enlaces simbólicos")
        if destination.exists():
            if destination.read_bytes() == pdf:
                continue
            raise ValueError(f"El archivo {destination.name} ya existe con otro contenido; cambia el nombre del PDF")
    created: list[tuple[Path, bytes]] = []
    try:
        for path, pdf in rendered:
            if not Path(path).exists():
                with atomic_output_file(path, extension=".pdf") as target:
                    target.tmp_path.write_bytes(pdf)
                created.append((Path(path), pdf))
    except Exception:
        for destination, content in created:
            if destination.is_file() and destination.read_bytes() == content:
                destination.unlink()
        raise
    return {"ready": True, "saved_path": planned[0], "saved_paths": planned,
            "filename": Path(planned[0]).name, "count": len(planned)}
