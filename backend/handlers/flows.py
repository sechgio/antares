from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from datetime import date
from pathlib import Path

from backend.core import flows as _flows_core
from backend.core.exceptions import NotFoundError, ValidationError
from backend.core.flows import ai_providers as _ai_providers
from backend.core.flows import connections as _connections
from backend.core.flows import os_tasks as _os_tasks
from backend.core.flows import webhooks as _webhooks
from backend.core.flows.events import APP_EVENTS
from backend.core.flows.runner import FlowRunner, cancel_run
from backend.core.flows.store import FlowStore, _utc_now, approval_expired
from backend.core.flows.types import JsonObject
from backend.core.ipc_catalog import FLOW_ACTION_METHODS, ORCHESTRATABLE_METHODS
from backend.handlers import HANDLERS as _REGISTRY
from backend.handlers.common import get_item_id, validate_params, with_locale

logger = logging.getLogger(__name__)

_runner = FlowRunner(_flows_core.get_flow_store(), _REGISTRY.get)


def _store() -> FlowStore:
    return _flows_core.get_flow_store()


def _flow_or_raise(flow_id: str) -> JsonObject:
    flow = _store().get(flow_id)
    if flow is None:
        raise NotFoundError(f"Flujo no encontrado: {flow_id}")
    return flow


@with_locale
def _list(params: JsonObject) -> JsonObject:
    return {"flows": _store().list_flows()}


@with_locale
@validate_params("id")
def _get(params: JsonObject) -> JsonObject:
    return {"flow": _flow_or_raise(get_item_id(params))}


@with_locale
def _create(params: JsonObject) -> JsonObject:
    name = str(params.get("name") or "Sin nombre")[:120]
    description = params.get("description")
    graph = params.get("graph")
    try:
        flow = _store().create(
            name,
            graph=graph if isinstance(graph, dict) else None,
            description=str(description) if isinstance(description, str) else "",
        )
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    return {"flow": flow}


@with_locale
@validate_params("id")
def _update(params: JsonObject) -> JsonObject:
    flow_id = get_item_id(params)
    graph = params.get("graph")
    enabled = params.get("enabled")
    name = params.get("name")
    description = params.get("description")
    expected = params.get("expected_updated_at")
    try:
        flow = _store().update(
            flow_id,
            name=name if isinstance(name, str) else None,
            description=description if isinstance(description, str) else None,
            enabled=bool(enabled) if enabled is not None else None,
            graph=graph if isinstance(graph, dict) else None,
            expected_updated_at=expected if isinstance(expected, str) else None,
        )
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    if flow is None:
        raise NotFoundError(f"Flujo no encontrado: {flow_id}")
    _os_tasks.sync_flow_task(flow)
    return {"flow": flow}


@with_locale
@validate_params("id")
def _delete(params: JsonObject) -> JsonObject:
    flow_id = get_item_id(params)
    if not _store().delete(flow_id):
        raise NotFoundError(f"Flujo no encontrado: {flow_id}")
    _os_tasks.delete_flow_task(flow_id)
    return {"deleted": True, "id": flow_id}


@with_locale
@validate_params("id")
def _duplicate(params: JsonObject) -> JsonObject:
    flow_id = get_item_id(params)
    name = params.get("name")
    flow = _store().duplicate(flow_id, name if isinstance(name, str) else None)
    if flow is None:
        raise NotFoundError(f"Flujo no encontrado: {flow_id}")
    return {"flow": flow}


@with_locale
@validate_params("id")
def _run(params: JsonObject) -> JsonObject:
    flow_id = get_item_id(params)
    _flow_or_raise(flow_id)
    trigger_payload = params.get("trigger_payload")
    if not isinstance(trigger_payload, dict):
        trigger_payload = {}
    try:
        run = _runner.start(flow_id, {**trigger_payload, "source": "manual"},
                            acknowledge_uncertain=params.get("acknowledge_uncertain") is True)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    return {"run": run}


@with_locale
@validate_params("run_id")
def _run_status(params: JsonObject) -> JsonObject:
    run = _store().get_run(str(params["run_id"]))
    if run is None:
        raise NotFoundError(f"Run no encontrado: {params['run_id']}")
    return {"run": run}


@with_locale
def _runs_list(params: JsonObject) -> JsonObject:
    flow_id = params.get("flow_id")
    limit = params.get("limit")
    runs = _store().list_runs(
        str(flow_id) if isinstance(flow_id, str) and flow_id else None,
        min(int(limit), 200) if isinstance(limit, (int, float)) else 50,
    )
    return {"runs": runs}


@with_locale
@validate_params("run_id")
def _run_cancel(params: JsonObject) -> JsonObject:
    run_id = str(params["run_id"])
    run = _store().get_run(run_id)
    if run is None:
        raise NotFoundError(f"Run no encontrado: {run_id}")
    if run["status"] in ("success", "error", "cancelled", "skipped"):
        return {"run": run, "cancelled": False}
    if run["status"] == "waiting":
        _store().update_run(run_id, status="cancelled", finished_at=_utc_now())
        return {"run": _store().get_run(run_id), "cancelled": True}
    # Run interrumpido sin hilo vivo (reinicio): no hay token que señalar.
    if not cancel_run(run_id) and not run.get("interrupted"):
        return {"run": run, "cancelled": False}
    # Marcado inmediato: el hilo aún libera operaciones en curso en segundo plano.
    _store().update_run(run_id, status="cancelled", finished_at=_utc_now())
    return {"run": _store().get_run(run_id), "cancelled": True}


@with_locale
@validate_params("run_id")
def _run_resume(params: JsonObject) -> JsonObject:
    run_id = str(params["run_id"])
    try:
        run = _runner.resume(run_id)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    return {"run": run}


@with_locale
def _approvals_list(params: JsonObject) -> JsonObject:
    approvals: list[JsonObject] = []
    store = _store()
    for run in store.list_runs(limit=200):
        if run["status"] != "waiting":
            continue
        checkpoint = run.get("checkpoint") or {}
        pending = checkpoint.get("pending") or {}
        for approval_id, approval in (checkpoint.get("approvals") or {}).items():
            if approval.get("decision") is not None or approval_expired(approval.get("created_at")):
                continue
            approvals.append({
                "id": approval_id,
                "run_id": run["id"],
                "flow_id": run["flow_id"],
                "flow_name": (store.get(run["flow_id"]) or {}).get("name") or run["flow_id"],
                "node_id": approval.get("node_id"),
                "node_name": approval.get("node_name"),
                "method": approval.get("method"),
                "params": approval.get("params"),
                "inside_loop": bool((pending.get(approval.get("node_id")) or {}).get("loop_node")),
                "created_at": approval.get("created_at"),
            })
    return {"approvals": approvals}


@with_locale
@validate_params("run_id", "approval_id", "decision")
def _approval_decide(params: JsonObject) -> JsonObject:
    decision = str(params["decision"])
    if decision not in ("approved", "denied"):
        raise ValidationError("decision debe ser 'approved' o 'denied'")
    try:
        approval = _runner.decide_approval(
            str(params["run_id"]), str(params["approval_id"]), decision == "approved"
        )
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    return {"approval": approval, "run": _store().get_run(str(params["run_id"]))}


@with_locale
def _effects_pending(params: JsonObject) -> JsonObject:
    flow_id = params.get("flow_id")
    return {"effects": _store().list_pending_effects(str(flow_id) if isinstance(flow_id, str) and flow_id else None)}


@with_locale
@validate_params("flow_id", "fingerprint", "resolution")
def _effect_resolve(params: JsonObject) -> JsonObject:
    resolution = str(params["resolution"])
    try:
        resolved = _store().resolve_effect(str(params["flow_id"]), str(params["fingerprint"]), resolution)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    if not resolved:
        raise NotFoundError("Efecto pendiente no encontrado")
    return {"resolved": True}


@with_locale
def _events_list(params: JsonObject) -> JsonObject:
    return {"events": APP_EVENTS}


@with_locale
def _webhook_info(params: JsonObject) -> JsonObject:
    server = _webhooks.get_webhook_server(_flows_core.get_flow_store, lambda: _runner)
    return server.info()


@with_locale
def _orchestratable_methods(params: JsonObject) -> JsonObject:
    return {"methods": sorted(FLOW_ACTION_METHODS), "actions": sorted(FLOW_ACTION_METHODS - ORCHESTRATABLE_METHODS)}


@with_locale
def _read_images(params: JsonObject) -> JsonObject:
    """Entrada local de un flujo; solo carpetas autorizadas por el bridge."""
    if params.get("guided_pdf") is True:
        from backend.core.flows.pdf_workflow import prepare

        return prepare({**params, "preview_pdf": False})
    folder = str(params.get("source_folder") or "").strip()
    output = str(params.get("output_folder") or "").strip()
    if not folder or not output:
        return {"ready": False, "reason": "Selecciona la carpeta de imágenes y la carpeta de salida"}
    grants = params.get("_flow_file_grants") or {}
    if not _store().verify_paths(grants) or folder not in (grants.get("folders") or []) or output not in (grants.get("write") or []):
        raise ValueError("Selecciona las carpetas con los diálogos de Antares")
    roots = [Path(folder), Path(output)]
    for root in roots:
        if not root.is_absolute() or root.is_symlink() or any(parent.is_symlink() for parent in root.parents):
            raise ValueError("La carpeta debe ser absoluta y no contener enlaces simbólicos")
        if not root.is_dir():
            return {"ready": False, "reason": f"Carpeta no disponible: {root.name}"}
    minimum = params.get("expected_images", 1)
    per_panel = params.get("images_per_panel", 1)
    report_batch = bool(params.get("report_template"))
    profile = _batch_template_profile(str(params["report_template"])) if report_batch else None
    for value in (minimum, per_panel):
        if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 1000:
            raise ValueError("La cantidad de imágenes debe ser un entero entre 1 y 1000")
    if report_batch and per_panel > 6:
        raise ValueError("El reporte admite entre una y seis fotos esperadas por fila")
    if profile is not None:
        per_panel = min(per_panel, profile["image_limit"])
    files = sorted(
        (p for p in (roots[0].rglob("*") if report_batch else roots[0].iterdir())
         if p.is_file() and not p.is_symlink()
         and (not report_batch or not any(parent.is_symlink() for parent in p.parents))
         and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}),
        key=lambda p: (p.name.casefold(), p.relative_to(roots[0]).as_posix()) if report_batch else p.name.casefold(),
    )
    if profile is not None and not profile["image_limit"]:
        files = []
    if len(files) > 1000:
        raise ValueError("La carpeta excede el máximo de 1000 imágenes por lote")
    if not report_batch and (len(files) < minimum or len(files) % per_panel):
        return {"ready": False, "reason": "Esperando todas las imágenes del lote", "count": len(files)}
    stats = [p.stat() for p in files]
    if any(stat.st_size == 0 or time.time() - stat.st_mtime < 15 for stat in stats):
        return {"ready": False, "reason": "Esperando que termine la copia de las imágenes"}
    rows: list[JsonObject] = []
    spreadsheet = str(params.get("spreadsheet_path") or "").strip()
    stamp: list[object] = [(p.name, s.st_size, s.st_mtime_ns) for p, s in zip(files, stats, strict=True)]
    if spreadsheet:
        sheet = Path(spreadsheet)
        if spreadsheet not in (grants.get("read") or []) and sheet.parent not in [Path(p) for p in grants.get("folders") or []]:
            raise ValueError("Selecciona la hoja de datos con el diálogo de Antares")
        if not sheet.is_absolute() or sheet.is_symlink() or any(p.is_symlink() for p in sheet.parents):
            raise ValueError("La hoja de datos debe ser un archivo autorizado sin enlaces simbólicos")
        if not sheet.is_file() or time.time() - sheet.stat().st_mtime < 15:
            return {"ready": False, "reason": "Esperando la hoja de datos"}
        sheet_stat = sheet.stat()
        if sheet_stat.st_size > 100 * 1024 * 1024:
            raise ValueError("La hoja de datos excede el máximo de 100 MiB")
        from backend.core.panel_aviso_corte import parse_excel_bytes

        parsed = parse_excel_bytes(sheet.read_bytes(), sheet.name)
        rows = [dict(row) for row in parsed.rows]
        stamp.append((spreadsheet, sheet_stat.st_size, sheet_stat.st_mtime_ns))
    if report_batch:
        assert profile is not None
        if not spreadsheet:
            return {"ready": False, "reason": "Selecciona el Excel común del lote"}
        from backend.core.panel_aviso_corte.matcher import _normalize_column_name, _normalize_date_str

        fields = profile["fields"]
        headers = list(parsed.columns)
        suggested = {}
        for field in fields:
            leaf = field.rsplit(".", 1)[-1]
            aliases = [field] + ([leaf] if sum(f.rsplit(".", 1)[-1] == leaf for f in fields) == 1 else [])
            if field == "OT":
                aliases.extend(["Nro OT", "N° OT", "Orden de trabajo"])
            elif field == "FECHA_TRABAJO":
                aliases.extend(["Fecha", "Fecha trabajo", "Fecha de trabajo"])
            elif field in {"Nro OT", "SGIO", "header.sgio", "os_numero"}:
                aliases.extend(["OT", "Nro OT", "Orden de trabajo"])
            elif field in {"FECHA", "fecha", "header.fecha_ejecucion"}:
                aliases.extend(["FECHA_TRABAJO", "Fecha de trabajo", "Fecha"])
            elif field in {"header.cs", "header.estacion"}:
                aliases.extend(["CENTRO", "Centro de servicios"])
            elif field == "cliente":
                aliases.append("NOMBRE")
            normalized = {re.sub(r"[\W_]", "", _normalize_column_name(alias)) for alias in aliases}
            suggested[field] = next((h for h in headers if re.sub(r"[\W_]", "", _normalize_column_name(h)) in normalized), "")
        mappings = params.get("field_mappings") or {}
        selections = params.get("photo_selections") or {}
        if not isinstance(mappings, dict) or not isinstance(selections, dict):
            raise ValueError("Revisa el mapeo y las fotos seleccionadas del lote")
        if any(not isinstance(field, str) or not isinstance(column, str) for field, column in mappings.items()):
            raise ValueError("El mapeo debe contener nombres de campos y columnas")
        missing = [field for field, column in mappings.items() if column and column not in headers]
        missing.extend(field for field in ("OT", "FECHA_TRABAJO") if not mappings.get(field))
        missing.extend(field for field in profile["required_fields"] if not mappings.get(field))
        names = [p.relative_to(roots[0]).as_posix() for p in files]
        identities = []
        for row in rows:
            ot = str(row.get(mappings.get("OT", "")) or "").strip()
            raw_date = str(row.get(mappings.get("FECHA_TRABAJO", "")) or "")
            day = _normalize_date_str(raw_date)
            try:
                day = date.fromisoformat(day).isoformat()
            except ValueError:
                day = ""
            identities.append((ot, day))
        candidates: dict[str, list[int]] = {}
        ot_candidates: dict[str, list[int]] = {}
        for name in names:
            stem = Path(name).stem
            date_pattern = r"(?<!\d)(?:\d{4}[-_]\d{2}[-_]\d{2}|\d{2}[-_]\d{2}[-_]\d{4})(?!\d)"
            dates = {_normalize_date_str(m.group()) for m in re.finditer(date_pattern, stem)}
            dates = {d.replace("_", "-") for d in dates}
            dates = {_normalize_date_str(d) for d in dates}
            ot_stem = re.sub(date_pattern, "", stem)
            matches = [i for i, (ot, day) in enumerate(identities) if ot and day
                       and re.search(rf"(?<![A-Za-z0-9]){re.escape(ot)}(?![A-Za-z0-9])", ot_stem, re.IGNORECASE)]
            ot_candidates[name] = matches
            candidates[name] = [i for i in matches if not dates or identities[i][1] in dates]
        report_used: set[str] = set()
        contexts = []
        previews: list[JsonObject] = []
        pending: list[str] = []
        for index, (row, (ot, day)) in enumerate(zip(rows, identities, strict=True)):
            key = str(index)
            choices = [name for name in names if index in ot_candidates[name]] if profile["image_limit"] else []
            automatic = [name for name in choices if index in candidates[name] and len(candidates[name]) == 1][:profile["image_limit"]]
            explicit = bool(profile["image_limit"]) and key in selections
            chosen = selections[key] if explicit else automatic
            errors = []
            if not isinstance(chosen, list) or any(not isinstance(name, str) or name not in choices for name in chosen):
                chosen = []
                errors.append("La selección contiene fotos que ya no corresponden a esta fila")
            if len(chosen) > profile["image_limit"] or len(set(chosen)) != len(chosen):
                errors.append(f"Selecciona hasta {profile['image_limit']} fotos distintas")
            if not ot:
                errors.append("Falta la OT")
            if not day:
                errors.append("Falta una fecha de trabajo válida")
            if not explicit and any(index in candidates[name] and len(candidates[name]) > 1 for name in choices):
                errors.append("Asigna las fotos que coinciden con varias filas")
            if len(chosen) < per_panel:
                errors.append(f"Esperando {per_panel} fotos; hay {len(chosen)} seleccionadas")
            if any(name in report_used for name in chosen):
                errors.append("Una foto está asignada a más de una fila")
            report_used.update(chosen)
            data = {field: str(row.get(column) or "").strip() for field, column in mappings.items() if column in headers}
            data.update(OT=ot, FECHA_TRABAJO=day)
            for field in fields:
                if field not in mappings and field in {"Nro OT", "SGIO", "FECHA", "fecha"}:
                    data[field] = ot if field in {"Nro OT", "SGIO"} else day
            errors.extend(f"Falta {field}" for field in profile["required_fields"] if not data.get(field))
            contexts.append({"data": data, "images": [f"flow-image:{name}" for name in chosen]})
            previews.append({"row_index": index, "ot": ot, "date": day, "data": data,
                             "images": chosen, "candidates": choices, "errors": errors})
            pending.extend(f"Fila {index + 1}: {error}" for error in errors)
        selected_files = [roots[0] / name for preview in previews for name in preview["images"]]
        if sum(p.stat().st_size for p in selected_files) > 100 * 1024 * 1024:
            raise ValueError("Las imágenes del lote exceden el máximo de 100 MiB")
        image_digests = [hashlib.sha256(p.read_bytes()).hexdigest() for p in selected_files]
        fingerprint = hashlib.sha256(json.dumps([[c["data"] for c in contexts], image_digests], sort_keys=True).encode()).hexdigest()
        if params["report_template"] != "report.html":
            fingerprint = hashlib.sha256(f"{params['report_template']}:{fingerprint}".encode()).hexdigest()
        return {
            "ready": not missing and not pending,
            "reason": f"Revisa las columnas: {', '.join(missing)}" if missing else pending[0] if pending else "Lote completo",
            "report_batch": True, "count": len(selected_files), "fingerprint": fingerprint,
            "headers": headers, "suggested_mappings": suggested, "missing_mappings": missing,
            "template_name": params["report_template"], "image_limit": profile["image_limit"],
            "required_fields": profile["required_fields"],
            "field_labels": profile["field_labels"],
            "preview": previews, "pending": pending, "contexts": contexts,
            "photo_digests": {f"flow-image:{p.relative_to(roots[0]).as_posix()}": digest
                              for p, digest in zip(selected_files, image_digests, strict=True)},
            "expected_pages": len(contexts),
            "files": [str(p) for p in selected_files],
            "localImagePaths": {f"flow-image:{p.relative_to(roots[0]).as_posix()}": str(p) for p in selected_files},
            "output_folder": output, "output_path": str(roots[1] / f"reportes-{fingerprint[:16]}.pdf"),
        }
    contexts = []
    key_column = str(params.get("key_column") or "").strip()
    if rows and key_column:
        from backend.core.panel_aviso_corte.matcher import match_image_to_row
        from backend.core.panel_aviso_corte.models import MatchRule

        rule = MatchRule(key_column=key_column, strategy="prefix")
        used: set[str] = set()
        for row in rows:
            key = str(row.get(key_column) or "").strip()
            matched = [p for p in files if key and match_image_to_row(rule, key, p.name)]
            if len(matched) < per_panel:
                return {"ready": False, "reason": f"Esperando imágenes para el registro {key or '(sin ID)'}"}
            if any(p.name in used for p in matched):
                raise ValueError("La columna ID asocia una imagen con más de una fila; revisa los identificadores")
            used.update(p.name for p in matched)
            contexts.append({"data": row, "images": [f"flow-image:{p.name}" for p in matched]})
    else:
        if rows and len(rows) != len(files) // per_panel:
            return {"ready": False, "reason": "La hoja debe tener una fila por panel"}
        for index in range(0, len(files), per_panel):
            data = rows[index // per_panel] if rows else {"nombre": files[index].stem}
            contexts.append({"data": data, "images": [f"flow-image:{p.name}" for p in files[index:index + per_panel]]})
    fingerprint = hashlib.sha256(json.dumps([params, stamp], sort_keys=True, default=str).encode()).hexdigest()
    return {
        "ready": True, "count": len(files), "fingerprint": fingerprint,
        "files": [str(p) for p in files], "image_names": [p.name for p in files],
        "image_paths": {p.name: str(p) for p in files},
        "localImagePaths": {f"flow-image:{p.name}": str(p) for p in files},
        "contexts": contexts, "rows": rows,
        "key_column": key_column,
        "output_path": str(roots[1] / f"paneles-{fingerprint[:12]}.pdf"),
        "output_folder": output,
    }


def _batch_template_profile(name: str) -> JsonObject:
    from jinja2 import Environment, nodes

    from backend.handlers.templates import template_get, templates_list

    if name not in {t["name"] for t in templates_list({"recursive": True})["templates"]}:
        raise ValueError("Selecciona una plantilla HTML de Antares")
    ast = Environment().parse(template_get({"name": name})["content"])
    fields = ["OT", "FECHA_TRABAJO"]
    if name == "report.html":
        fields = ["CENTRO", "NIS", "OT", "FECHA_TRABAJO", "DIRECCION", "LOCALIDAD", "DISTRITO",
                  "ESTADO", "TIPO RED", "SECTOR", "ACTIVIDAD", "CONTRATA", "SUBACTIVIDAD",
                  "CUADRILLA", "OBSERVACION SEDAPAL", "OBSERVACION CONTRATA"]
    else:
        for call in ast.find_all(nodes.Call):
            if (isinstance(call.node, nodes.Getattr) and call.node.attr == "get" and call.args
                    and isinstance(call.args[0], nodes.Const) and isinstance(call.args[0].value, str)
                    and ((isinstance(call.node.node, nodes.Getattr) and call.node.node.attr == "data")
                         or (isinstance(call.node.node, nodes.Name) and call.node.node.name in {"row", "data"}))):
                fields.append(call.args[0].value)
    defaults: JsonObject = {}
    if name == "technical_reports/informe_tecnico.html":
        from backend.core.technical_reports.models import create_empty_report

        defaults = create_empty_report(1)
    elif name.startswith("informes_v2/"):
        from backend.core.informes_v2.models import create_empty_report as empty_informe

        defaults = empty_informe(1)
        sections = {"header", "reservorios2"} if name.endswith("reservorios_2.html") else {"header", "valvulas", "linea", "medidas"}
        defaults = {key: value for key, value in defaults.items() if key in sections}
    elif name == "fichas_tecnicas/ficha_tecnica.html":
        from backend.core.fichas_tecnicas.models import create_empty_ficha

        defaults = create_empty_ficha(1)

    def add_fields(value: JsonObject, prefix: str = "") -> None:
        for key, item in value.items():
            if not prefix and key in {"id", "status", "last_modified", "plantilla"}:
                continue
            field = f"{prefix}.{key}" if prefix else key
            if isinstance(item, dict):
                add_fields(item, field)
            else:
                fields.append(field)

    add_fields(defaults)
    required = ["cuadrante", "fecha_corte", "motivo"] if name == "panel-aviso-corte.html" else []
    if name == "evidencia-volanteo.html":
        fields.append("cuadrante")
    fields.extend(required)
    photos = any(n.attr in {"images", "_photos", "image_uris"} for n in ast.find_all(nodes.Getattr))
    photos = photos or name == "evidencia-volanteo.html"
    limits = [n.arg.stop.value for n in ast.find_all(nodes.Getitem)
              if isinstance(n.node, nodes.Getattr) and n.node.attr == "images" and isinstance(n.arg, nodes.Slice)
              and isinstance(n.arg.stop, nodes.Const) and isinstance(n.arg.stop.value, int)]
    labels = {"header": "Encabezado", "metadata": "Datos del informe", "inspeccion": "Inspección",
              "valvulas": "Válvulas", "canastillas": "Canastillas", "medidas": "Medidas",
              "reservorios2": "Reservorio", "linea": "Línea", "obs_rec": "Observaciones",
              "cs": "Centro de servicios", "estacion": "Estación", "sgio": "OT"}
    return {"fields": list(dict.fromkeys(fields)), "required_fields": required,
            "field_labels": {field: " · ".join(labels.get(part, part.replace("_", " ")) for part in field.split("."))
                             for field in fields},
            "image_limit": min(6, max(limits, default=6)) if photos else 0}


@with_locale
def _render_pdf(params: JsonObject) -> JsonObject:
    if params.get("guided_pdf") is True:
        from backend.core.flows.pdf_workflow import export_pdf

        return export_pdf(params)
    from backend.utils.atomic_write import atomic_output_file
    from backend.utils.pdf_html import write_pdf_sanitized

    html = params.get("html")
    template_name = params.get("template_name")
    expected_pages = params.get("expected_pages")
    if expected_pages is not None:
        if not template_name or not isinstance(expected_pages, int) or isinstance(expected_pages, bool) or expected_pages < 1:
            raise ValueError("Revisa la cantidad de filas del reporte consolidado")
        profile = _batch_template_profile(str(template_name))
        contexts = params.get("contexts")
        if not isinstance(contexts, list) or len(contexts) != expected_pages or any(
            not isinstance(item, dict) or not (0 if params.get("_guided_contexts") else 1 if profile["image_limit"] else 0) <= len(item.get("images") or []) <= profile["image_limit"]
            or (not params.get("_guided_contexts") and any(not (item.get("data") or {}).get(key) for key in ("OT", "FECHA_TRABAJO"))) for item in contexts
        ):
            return {"ready": False, "reason": "Resuelve todas las filas antes de exportar"}
    if template_name:
        from jinja2 import StrictUndefined, UndefinedError
        from jinja2.sandbox import SandboxedEnvironment

        from backend.handlers.templates import template_get, templates_list

        if not isinstance(template_name, str) or template_name not in {t["name"] for t in templates_list({"recursive": True})["templates"]}:
            raise ValueError("Selecciona una plantilla HTML de Antares")
        content = template_get({"name": template_name})["content"]
        if expected_pages is not None:
            content = re.sub(r"(?i)@import\s+(?:url\([^)]*\)|[\"'][^\"']*[\"'])[^;]*;", "", content)
        context = params.get("context") or {}
        if not isinstance(context, dict):
            raise ValueError("Los datos de la plantilla deben ser un objeto")
        context = dict(context)
        contexts = params.get("contexts")
        if contexts is not None:
            if not isinstance(contexts, list) or not contexts:
                return {"ready": False, "reason": "Esperando datos e imágenes de los paneles"}
            from backend.utils.image_data import build_image_uris

            paths = params.get("localImagePaths") or {}
            if not isinstance(paths, dict) or sum(Path(p).stat().st_size for p in paths.values()) > 100 * 1024 * 1024:
                raise ValueError("Las imágenes del lote exceden el máximo de 100 MiB")
            if expected_pages is not None:
                digests = params.get("photo_digests") or {}
                if any(hashlib.sha256(Path(p).read_bytes()).hexdigest() != digests.get(ref) for ref, p in paths.items()):
                    return {"ready": False, "reason": "Las fotos cambiaron; vuelve a preparar el lote"}
            uris = build_image_uris({}, paths)
            reports: list[JsonObject] = []
            for item in contexts:
                images = item.get("images") or []
                if any(ref not in uris for ref in images):
                    return {"ready": False, "reason": "Esperando imágenes válidas para la plantilla"}
                data = item.get("data") or {}
                if expected_pages is not None and template_name.startswith(("technical_reports/", "informes_v2/", "fichas_tecnicas/")):
                    nested: JsonObject = {}
                    for field, value in data.items():
                        nested_target = nested
                        parts = field.split(".")
                        for part in parts[:-1]:
                            nested_target = nested_target.setdefault(part, {})
                        if template_name == "fichas_tecnicas/ficha_tecnica.html" and field in {"productos", "personal_tecnico"} and value:
                            try:
                                value = json.loads(value) if isinstance(value, str) else value
                            except json.JSONDecodeError as exc:
                                raise ValueError(f"Revisa el contenido JSON del campo {field}") from exc
                            if not isinstance(value, list):
                                raise ValueError(f"El campo {field} debe contener una lista JSON")
                        nested_target[parts[-1]] = value
                    if template_name == "fichas_tecnicas/ficha_tecnica.html":
                        nested.setdefault("os_numero", data["OT"])
                        nested.setdefault("fecha", data["FECHA_TRABAJO"])
                    else:
                        header = nested.setdefault("header", {})
                        header.setdefault("sgio", data["OT"])
                        if template_name.startswith("informes_v2/"):
                            header.setdefault("fecha_ejecucion", data["FECHA_TRABAJO"])
                        elif data.get("FECHA_TRABAJO"):
                            work_date = date.fromisoformat(data["FECHA_TRABAJO"])
                            metadata = nested.setdefault("metadata", {})
                            metadata.setdefault("dia", work_date.day)
                            metadata.setdefault("anio", work_date.year)
                            metadata.setdefault("mes", ("ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
                                                        "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE")[work_date.month - 1])
                    data = nested
                reports.append({"data": data, "images": [
                    {"path": uris[ref], "name": ref.removeprefix("flow-image:"), "coords": "",
                     "date": time.strftime("%d/%m/%Y %H:%M:%S", time.localtime(Path(paths[ref]).stat().st_mtime))}
                    for ref in images
                ]})
            context = {"title": Path(template_name).stem, "logo_left": None, "logo_right": None,
                       "logo_center": None, "reports": reports, **context}
            if template_name == "evidencia-volanteo.html":
                from backend.core.evidencia_volanteo.layout import layout_context

                pages = [{"cuadrante": r["data"].get("cuadrante", "—"), "slots": [
                    {"filename": i["name"], "uri": i["path"]} for i in r["images"][start:start + 6]
                ] + [None] * (6 - len(r["images"][start:start + 6]))}
                    for r in reports for start in range(0, max(1, len(r["images"])), 6)]
                context = {**layout_context(), "pages": pages, **context}
            elif template_name == "panel-aviso-corte.html":
                if any(any(r["data"].get(k) in (None, "") for k in ("cuadrante", "fecha_corte", "motivo")) for r in reports):
                    return {"ready": False, "reason": "Completa cuadrante, fecha_corte y motivo de los avisos"}
                context.setdefault("panels", [{**r["data"], "imagenes": [
                    {"position": index + 1, "filename": i["name"], "caption": i["name"]}
                    for index, i in enumerate(r["images"])
                ], "image_uris": {i["name"]: i["path"] for i in r["images"]}} for r in reports])
            elif template_name in {"technical_reports/informe_tecnico.html", "informes_v2/informe_v2.html",
                                   "informes_v2/reservorios_2.html", "fichas_tecnicas/ficha_tecnica.html"}:
                key = "fichas" if template_name.startswith("fichas_tecnicas/") else "reports"
                context[key] = (params.get("context") or {}).get(key, [r["data"] for r in reports])
        if template_name == "technical_reports/informe_tecnico.html":
            from backend.core.technical_reports.rendering import render_consolidated_html as render_technical_reports

            if not context.get("reports"):
                return {"ready": False, "reason": "Esperando informes técnicos"}
            html = render_technical_reports(context["reports"], context.get("logo_left"), context.get("logo_right"))
        elif template_name in {"informes_v2/informe_v2.html", "informes_v2/reservorios_2.html"}:
            from backend.core.informes_v2.rendering import render_consolidated_html as render_informes_v2

            if not context.get("reports"):
                return {"ready": False, "reason": "Esperando informes v2"}
            reports = [{**r, "id": str(r.get("id") or index),
                        "plantilla": "reservorios2" if template_name.endswith("reservorios_2.html") else "clasica"}
                       for index, r in enumerate(context["reports"])]
            images_by_id = context.get("images_by_id") or {}
            if contexts and not context.get("images_by_id"):
                images_by_id = {r["id"]: [{"path": uris[ref], "name": ref.removeprefix("flow-image:")}
                                         for ref in item.get("images") or []] for r, item in zip(reports, contexts, strict=True)}
            html = render_informes_v2(reports, context.get("logo_left"), context.get("logo_right"), images_by_id)
        elif template_name == "fichas_tecnicas/ficha_tecnica.html":
            from backend.core.fichas_tecnicas.rendering import render_consolidated_html as render_fichas

            if not context.get("fichas"):
                return {"ready": False, "reason": "Esperando fichas técnicas"}
            html = render_fichas(context["fichas"], context.get("logo_left"), context.get("logo_right"))
        else:
            try:
                html = SandboxedEnvironment(autoescape=True, undefined=StrictUndefined).from_string(content).render(context)
            except UndefinedError as exc:
                return {"ready": False, "reason": f"Faltan datos de la plantilla: {exc}"}
    if not isinstance(html, str) or not html.strip():
        return {"ready": False, "reason": "Esperando el contenido del documento"}
    if params.get("_preview_pdf") is True:
        import base64

        return {"pdf_base64": base64.b64encode(write_pdf_sanitized(html)).decode("ascii")}
    output = str(params.get("output_path") or "").strip()
    if not output:
        return {"ready": False, "reason": "Selecciona un archivo de salida"}
    if expected_pages is not None and Path(output).exists():
        import pymupdf

        with pymupdf.open(output) as existing:
            if template_name == "report.html" and len(existing) != expected_pages:
                raise ValueError("El archivo de esta versión ya existe y no coincide con las filas del lote")
        return {"saved_path": output, "filename": Path(output).name, "reused": True}
    pdf = write_pdf_sanitized(html)
    if expected_pages is not None and template_name == "report.html":
        import pymupdf

        with pymupdf.open(stream=pdf, filetype="pdf") as document:
            if len(document) != expected_pages:
                raise ValueError(f"El PDF tiene {len(document)} páginas; se esperaban {expected_pages}. No se guardó")
    with atomic_output_file(output, extension=".pdf") as target:
        target.tmp_path.write_bytes(pdf)
    return {"saved_path": str(target.destination), "filename": target.destination.name}


@with_locale
def _pdf_preview(params: JsonObject) -> JsonObject:
    from backend.core.flows.pdf_workflow import prepare

    return prepare({**params, "guided_pdf": True, "preview_pdf": True})


@with_locale
def _printers_list(params: JsonObject) -> JsonObject:
    from backend.core.printing import list_printers

    return {"printers": list_printers()}


@with_locale
def _print_pdf(params: JsonObject) -> JsonObject:
    from backend.core.printing import print_pdf

    if not params.get("pdf_path") or not params.get("printer_name"):
        return {"ready": False, "reason": "Selecciona el PDF y la impresora"}
    return print_pdf(
        params["pdf_path"],
        params["printer_name"],
        params.get("copies", 1),
        params.get("_cancelled"),
        pages=params.get("pages"),
        duplex=params.get("duplex"),
        quality=params.get("quality"),
    )


def _authorize_paths(params: JsonObject) -> JsonObject:
    store = _store()
    if params.get("_verify") is True:
        return {"valid": store.verify_paths(params)}
    return {"grants": store.authorize_paths(params)}


@with_locale
@validate_params("provider", "tokens")
def _connection_token_put(params: JsonObject) -> JsonObject:
    """Espeja tokens OAuth gestionados por Electron en el vault del backend,
    para que los nodos http_request puedan firmar con connection_ref."""
    provider = str(params["provider"])
    tokens = params["tokens"]
    if not isinstance(tokens, dict) or not isinstance(tokens.get("access_token"), str):
        raise ValidationError("tokens debe contener access_token")
    try:
        return _connections.put_tokens(provider, dict(tokens))
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc


@with_locale
@validate_params("provider")
def _connection_token_delete(params: JsonObject) -> JsonObject:
    provider = str(params["provider"])
    try:
        return _connections.delete_tokens(provider)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc


@with_locale
@validate_params("provider")
def _connection_token_refresh(params: JsonObject) -> JsonObject:
    tokens = _connections.fresh_tokens(str(params["provider"]))
    return {"tokens": {key: tokens.get(key) for key in ("access_token", "refresh_token", "expiry_date", "scope", "account")}}


@with_locale
def _ai_providers_list(params: JsonObject) -> JsonObject:
    specs = _ai_providers.load_provider_specs()
    providers = []
    for pid in sorted(specs):
        spec = specs[pid]
        providers.append(
            {
                "id": pid,
                "label": spec.get("label", pid),
                "description": spec.get("description", ""),
                "docs": spec.get("docs", ""),
                "editable_base_url": bool(spec.get("editable_base_url")),
                "default_base_url": spec.get("base_url", ""),
                **_ai_providers.public_state(pid),
            }
        )
    return {"providers": providers}


@with_locale
@validate_params("provider")
def _ai_provider_save(params: JsonObject) -> JsonObject:
    provider = str(params["provider"])
    config: JsonObject = {k: params[k] for k in ("api_key", "base_url", "model") if k in params}
    try:
        _ai_providers.put_config(provider, config)
        return {"provider": _ai_providers.public_state(provider)}
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc


@with_locale
@validate_params("provider")
def _ai_provider_delete(params: JsonObject) -> JsonObject:
    try:
        return _ai_providers.delete_config(str(params["provider"]))
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc


@with_locale
@validate_params("provider")
def _ai_provider_status(params: JsonObject) -> JsonObject:
    try:
        return {"provider": _ai_providers.status(str(params["provider"]))}
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc


HANDLERS = {
    "flows_list": _list,
    "flows_get": _get,
    "flows_create": _create,
    "flows_update": _update,
    "flows_delete": _delete,
    "flows_duplicate": _duplicate,
    "flows_run": _run,
    "flows_run_status": _run_status,
    "flows_runs_list": _runs_list,
    "flows_run_cancel": _run_cancel,
    "flows_run_resume": _run_resume,
    "flows_approvals_list": _approvals_list,
    "flows_approval_decide": _approval_decide,
    "flows_effects_pending": _effects_pending,
    "flows_effect_resolve": _effect_resolve,
    "flows_events_list": _events_list,
    "flows_webhook_info": _webhook_info,
    "flows_orchestratable_methods": _orchestratable_methods,
    "flows_read_images": _read_images,
    "flows_render_pdf": _render_pdf,
    "flows_pdf_preview": _pdf_preview,
    "flows_printers_list": _printers_list,
    "flows_print_pdf": _print_pdf,
    "flows_path_authorize": _authorize_paths,
    "flows_connection_token_put": _connection_token_put,
    "flows_connection_token_delete": _connection_token_delete,
    "flows_connection_token_refresh": _connection_token_refresh,
    "ai_providers_list": _ai_providers_list,
    "ai_provider_save": _ai_provider_save,
    "ai_provider_delete": _ai_provider_delete,
    "ai_provider_status": _ai_provider_status,
}
