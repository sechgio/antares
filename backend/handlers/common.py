from __future__ import annotations

from functools import wraps
from typing import TYPE_CHECKING, Any, cast

from backend.utils.i18n import set_locale
from backend.utils.image_data import decode_b64_payload
from backend.utils.validators import is_safe_user_path, path_param_violations

if TYPE_CHECKING:
    from collections.abc import Callable

def with_locale(fn: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(fn)
    def wrapper(params: dict[str, Any]) -> Any:
        set_locale(params.get("locale", "es"))
        return fn(params)
    return wrapper


def get_item_id(params: dict[str, Any]) -> str:
    return str(params.get("id") or "")


def require_update_payload(params: dict[str, Any], payload_key: str) -> tuple[str, dict[str, Any]]:
    item_id = get_item_id(params)
    payload = params.get(payload_key)
    if not item_id or not isinstance(payload, dict):
        msg = f"id y {payload_key} son requeridos"
        raise ValueError(msg)
    return item_id, payload


def get_item_or_raise(store: Any, item_id: str, missing_message: str) -> dict[str, Any]:
    item = store.get(item_id)
    if item is None:
        msg = f"{missing_message}: {item_id}"
        raise ValueError(msg)
    return cast(dict[str, Any], item)


def delete_item_or_raise(store: Any, item_id: str, missing_message: str) -> None:
    if not store.delete(item_id):
        msg = f"{missing_message}: {item_id}"
        raise ValueError(msg)


def clear_store(store: Any, item_name: str) -> dict[str, Any]:
    count = store.clear_all()
    return {"success": True, "deleted_count": count, "message": f"Se eliminaron {count} {item_name}"}


def create_report_from_params(store: Any, params: dict[str, Any], payload_key: str) -> dict[str, Any]:
    payload = params.get(payload_key)
    created = store.create(payload) if isinstance(payload, dict) else store.create_empty()
    return cast(dict[str, Any], created)


def update_item_or_raise(store: Any, item_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return cast(dict[str, Any], store.update(item_id, payload))
    except KeyError as exc:
        raise ValueError(str(exc)) from exc


def resolve_payload_or_store(
    store: Any,
    params: dict[str, Any],
    payload_key: str,
    missing_message: str,
) -> dict[str, Any]:
    payload = params.get(payload_key)
    item_id = str(params.get("id") or "").strip()
    if isinstance(payload, dict) and payload:
        return payload
    if item_id:
        stored = store.get(item_id)
        if isinstance(stored, dict):
            return stored
    raise ValueError(missing_message)


def require_b64_file_payload(params: dict[str, Any]) -> tuple[str, bytes]:
    filename = str(params.get("filename") or "")
    content_b64 = str(params.get("content_b64") or "")
    if not filename or not content_b64:
        msg = "filename y content_b64 son requeridos"
        raise ValueError(msg)
    return filename, decode_b64_payload(content_b64)


def import_into_store(
    store: Any,
    params: dict[str, Any],
    importer: Callable[[str, bytes], list[dict[str, Any]]],
    imported_label: str,
) -> dict[str, Any]:
    filename, content = require_b64_file_payload(params)
    items = importer(filename, content)
    imported, deleted_count = store.replace_all_counted(items)
    return {
        "success": True,
        "message": f"{len(imported)} {imported_label}",
        "deleted_count": deleted_count,
        "imported_count": len(imported),
        "total_rows_in_file": len(items),
    }


def get_items_by_optional_ids(
    store: Any,
    raw_ids: Any,
    empty_message: str,
) -> list[dict[str, Any]]:  # allowlist: dict[str, Any]
    if isinstance(raw_ids, list) and raw_ids:
        items = store.get_many([str(item_id) for item_id in raw_ids])
    else:
        items = store.get_all()
    if not items:
        raise ValueError(empty_message)
    return cast(list[dict[str, Any]], items)  # allowlist: dict[str, Any]


def parse_positive_int(value: Any, label: str, *, maximum: int | None = None) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        msg = f"{label} inválido"
        raise ValueError(msg) from exc
    if parsed <= 0:
        msg = f"{label} debe ser mayor a cero"
        raise ValueError(msg)
    if maximum is not None and parsed > maximum:
        msg = f"{label} debe ser menor o igual a {maximum}"
        raise ValueError(msg)
    return parsed


def validate_params(*required_params: str):
    def decorator(fn):
        @wraps(fn)
        def wrapper(params: dict[str, Any]) -> Any:
            for param in required_params:
                if param not in params or params[param] is None:
                    msg = f"Missing required parameter: {param}"
                    raise ValueError(msg)
            for _key, value in path_param_violations(params, strict=True):
                _validate_path(value)
            return fn(params)
        return wrapper
    return decorator


def _validate_path(path: str) -> None:
    if not path or not isinstance(path, str):
        msg = f"Invalid path: {path}"
        raise ValueError(msg)
    if not is_safe_user_path(path):
        msg = f"Path traversal detected: {path}"
        raise ValueError(msg)
