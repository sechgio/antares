"""Domain models for Fichas Técnicas (dict-normalized, mirror of frontend types)."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any

SATISFACCION_VALUES = {"muy_satisfecho", "satisfecho", "regular", "insatisfecho", ""}
STATUS_VALUES = {"draft", "completed"}


def ficha_id_from_number(value: int) -> str:
    return f"FT-{int(value):05d}"


def next_ficha_number(items: list[dict[str, Any]]) -> int:
    max_n = 0
    for item in items:
        raw = str(item.get("id") or "")
        if raw.startswith("FT-"):
            try:
                max_n = max(max_n, int(raw[3:]))
            except ValueError:
                continue
    return max_n + 1


def _safe_str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    text = str(value).strip()
    if text.lower() in {"none", "nan"}:
        return default
    return text


def _safe_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().upper() in {"X", "SI", "SÍ", "TRUE", "1", "YES", "V"}


def _normalize_satisfaccion(value: Any) -> str:
    if value is None:
        return ""
    val = str(value).strip().lower().replace(" ", "_")
    if val in SATISFACCION_VALUES:
        return val
    mapping = {
        "muy_satisfecho": "muy_satisfecho",
        "satisfecho": "satisfecho",
        "regular": "regular",
        "insatisfecho": "insatisfecho",
    }
    return mapping.get(val, "")


def empty_producto() -> dict[str, str]:
    return {
        "producto": "",
        "composicion": "",
        "lote": "",
        "fecha_vencimiento": "",
        "unidad": "",
        "concentracion": "",
        "cantidad": "",
    }


def empty_servicio() -> dict[str, bool]:
    return {
        "desinfeccion": False,
        "limpieza_ambientes": False,
        "limpieza_pozos_septicos": False,
        "limpieza_reservorios": False,
    }


def empty_tratamiento() -> dict[str, Any]:
    return {
        "pulverizado": False,
        "atomizado": False,
        "thermonebulizado": False,
        "nebulizado_ulv": False,
        "otros": "",
    }


def empty_obs_rec() -> dict[str, str]:
    return {
        "observacion_a": "",
        "observacion_b": "",
        "observacion_c": "",
        "recomendacion_a": "",
        "recomendacion_b": "",
        "recomendacion_c": "",
    }


def create_empty_ficha(number: int | None = None) -> dict[str, Any]:
    n = int(number or 1)
    return {
        "id": ficha_id_from_number(n),
        "os_numero": f"N° {n:05d}",
        "cliente": "",
        "fecha": "",
        "direccion": "",
        "distrito": "",
        "servicio": empty_servicio(),
        "diagnostico_area": "",
        "condicion_sanitaria": "",
        "tratamiento": empty_tratamiento(),
        "productos": [empty_producto() for _ in range(4)],
        "acciones_correctivas": "",
        "areas_tratadas": "",
        "personal_tecnico": ["", "", "", "", "", ""],
        "hora_inicio": "",
        "hora_termino": "",
        "numero_certificado": "",
        "obs_rec": empty_obs_rec(),
        "satisfaccion": "",
        "status": "draft",
        "last_modified": datetime.now().isoformat(),
    }


def _normalize_producto(raw: Any) -> dict[str, str]:
    source = raw if isinstance(raw, dict) else {}
    return {
        "producto": _safe_str(source.get("producto")),
        "composicion": _safe_str(source.get("composicion")),
        "lote": _safe_str(source.get("lote")),
        "fecha_vencimiento": _safe_str(source.get("fecha_vencimiento")),
        "unidad": _safe_str(source.get("unidad")),
        "concentracion": _safe_str(source.get("concentracion")),
        "cantidad": _safe_str(source.get("cantidad")),
    }


def _normalize_productos(raw: Any) -> list[dict[str, str]]:
    items = raw if isinstance(raw, list) else []
    productos = [_normalize_producto(item) for item in items[:4]]
    while len(productos) < 4:
        productos.append(empty_producto())
    return productos


def _normalize_personal(raw: Any) -> list[str]:
    if isinstance(raw, list):
        values = [_safe_str(v) for v in raw[:6]]
    elif isinstance(raw, str) and raw.strip():
        values = [_safe_str(part) for part in raw.split("\n")[:6]]
    else:
        values = []
    while len(values) < 6:
        values.append("")
    return values


class FichaTecnica:
    """Normalization helpers (dicts, not Pydantic — matches technical_reports style)."""

    @staticmethod
    def normalize(raw: dict[str, Any] | None) -> dict[str, Any]:
        source = raw if isinstance(raw, dict) else {}
        base = create_empty_ficha(1)
        ficha_id = _safe_str(source.get("id")) or base["id"]

        servicio_src = source.get("servicio") if isinstance(source.get("servicio"), dict) else {}
        tratamiento_src = source.get("tratamiento") if isinstance(source.get("tratamiento"), dict) else {}
        obs_src = source.get("obs_rec") if isinstance(source.get("obs_rec"), dict) else {}

        status = _safe_str(source.get("status"), "draft")
        if status not in STATUS_VALUES:
            status = "draft"

        return {
            "id": ficha_id,
            "os_numero": _safe_str(source.get("os_numero")),
            "cliente": _safe_str(source.get("cliente")),
            "fecha": _safe_str(source.get("fecha")),
            "direccion": _safe_str(source.get("direccion")),
            "distrito": _safe_str(source.get("distrito")),
            "servicio": {
                "desinfeccion": _safe_bool(servicio_src.get("desinfeccion")),
                "limpieza_ambientes": _safe_bool(servicio_src.get("limpieza_ambientes")),
                "limpieza_pozos_septicos": _safe_bool(servicio_src.get("limpieza_pozos_septicos")),
                "limpieza_reservorios": _safe_bool(servicio_src.get("limpieza_reservorios")),
            },
            "diagnostico_area": _safe_str(source.get("diagnostico_area")),
            "condicion_sanitaria": _safe_str(source.get("condicion_sanitaria")),
            "tratamiento": {
                "pulverizado": _safe_bool(tratamiento_src.get("pulverizado")),
                "atomizado": _safe_bool(tratamiento_src.get("atomizado")),
                "thermonebulizado": _safe_bool(tratamiento_src.get("thermonebulizado")),
                "nebulizado_ulv": _safe_bool(tratamiento_src.get("nebulizado_ulv")),
                "otros": _safe_str(tratamiento_src.get("otros")),
            },
            "productos": _normalize_productos(source.get("productos")),
            "acciones_correctivas": _safe_str(source.get("acciones_correctivas")),
            "areas_tratadas": _safe_str(source.get("areas_tratadas")),
            "personal_tecnico": _normalize_personal(source.get("personal_tecnico")),
            "hora_inicio": _safe_str(source.get("hora_inicio")),
            "hora_termino": _safe_str(source.get("hora_termino")),
            "numero_certificado": _safe_str(source.get("numero_certificado")),
            "obs_rec": {
                "observacion_a": _safe_str(obs_src.get("observacion_a")),
                "observacion_b": _safe_str(obs_src.get("observacion_b")),
                "observacion_c": _safe_str(obs_src.get("observacion_c")),
                "recomendacion_a": _safe_str(obs_src.get("recomendacion_a")),
                "recomendacion_b": _safe_str(obs_src.get("recomendacion_b")),
                "recomendacion_c": _safe_str(obs_src.get("recomendacion_c")),
            },
            "satisfaccion": _normalize_satisfaccion(source.get("satisfaccion")),
            "status": status,
            "last_modified": _safe_str(source.get("last_modified")) or datetime.now().isoformat(),
        }

    @staticmethod
    def summary(ficha: dict[str, Any]) -> dict[str, Any]:
        normalized = FichaTecnica.normalize(ficha)
        return {
            "id": normalized["id"],
            "os_numero": normalized["os_numero"],
            "cliente": normalized["cliente"],
            "direccion": normalized["direccion"],
            "distrito": normalized["distrito"],
            "fecha": normalized["fecha"],
            "status": normalized["status"],
        }

    @staticmethod
    def clone(ficha: dict[str, Any]) -> dict[str, Any]:
        return deepcopy(FichaTecnica.normalize(ficha))


def template_placeholder_ficha() -> dict[str, Any]:
    """Blank/demo ficha for PDF plantilla."""
    today = datetime.now().strftime("%Y-%m-%d")
    ficha = create_empty_ficha(0)
    ficha.update(
        {
            "id": "XXXXXXXX",
            "os_numero": "OS-0000-000000",
            "cliente": "NOMBRE DEL CLIENTE",
            "direccion": "DIRECCION DE LA OBRA",
            "distrito": "DISTRITO",
            "fecha": today,
        }
    )
    return ficha
