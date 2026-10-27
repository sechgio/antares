from __future__ import annotations

import copy
import json
import math
from datetime import datetime, timezone
from typing import Any, cast

import jsonschema  # type: ignore

from backend.utils.paths import resource_path

SCHEMA_VERSION: int = 1


def _load_schema() -> dict[str, Any]:  # allowlist: dict[str, Any]
    p = resource_path("shared/editor-schema.json")
    return cast("dict[str, Any]", json.loads(p.read_text(encoding="utf-8")))  # allowlist: dict[str, Any]


_SCHEMA = _load_schema()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class EditorContractError(ValueError):
    pass


def _format_error(exc: jsonschema.ValidationError) -> str:
    path = "/".join(str(p) for p in exc.absolute_path) or "(raíz)"
    return f"{path}: {exc.message}"


def _check_semantics(document: dict[str, Any]) -> None:  # allowlist: dict[str, Any]
    for clip in document.get("clips", []):
        clip_id = clip.get("id", "?")
        if int(clip["sourceOutUs"]) <= int(clip["sourceInUs"]):
            raise EditorContractError(
                f"clip {clip_id}: sourceOutUs debe ser mayor que sourceInUs "
                f"(intervalo semiabierto [inicio, fin))"
            )
        crop = clip.get("transform", {}).get("crop")
        if crop is not None:
            right = crop["x"] + crop["width"]
            bottom = crop["y"] + crop["height"]
            if right > 1.0 or bottom > 1.0:
                raise EditorContractError(
                    f"clip {clip_id}: el crop excede el origen orientado "
                    f"(x+ancho={right:.3f}, y+alto={bottom:.3f}; máximo 1)"
                )
        for rect in clip.get("delogo", {}).get("rects", []):
            right = rect["x"] + rect["width"]
            bottom = rect["y"] + rect["height"]
            if right > 1.0 or bottom > 1.0:
                raise EditorContractError(
                    f"clip {clip_id}: la máscara delogo {rect.get('id', '?')} "
                    f"excede el origen orientado (x+ancho={right:.3f}, "
                    f"y+alto={bottom:.3f}; máximo 1)"
                )


def validate_document(document: Any) -> dict[str, Any]:  # allowlist: dict[str, Any]
    if not isinstance(document, dict):
        raise EditorContractError("(raíz): el documento debe ser un objeto JSON")
    version = document.get("schemaVersion")
    if version != SCHEMA_VERSION:
        raise EditorContractError(
            f"schemaVersion incompatible: el documento usa {version!r} y esta "
            f"versión de Antares solo soporta {SCHEMA_VERSION}"
        )
    validator = jsonschema.Draft202012Validator(_SCHEMA)
    errors = sorted(validator.iter_errors(document), key=lambda e: list(e.absolute_path))
    if errors:
        first = errors[0]
        raise EditorContractError(_format_error(first))
    _check_semantics(cast("dict[str, Any]", document))  # allowlist: dict[str, Any]
    return cast("dict[str, Any]", document)  # allowlist: dict[str, Any]


def clip_duration_us(clip: dict[str, Any]) -> int:  # allowlist: dict[str, Any]
    source_us = int(clip["sourceOutUs"]) - int(clip["sourceInUs"])
    speed = clip["speed"]
    num = int(speed["num"])
    den = int(speed["den"])
    if num <= 0 or den <= 0:
        raise EditorContractError("speed.num y speed.den deben ser positivos")
    if source_us <= 0:
        raise EditorContractError("sourceOutUs debe ser mayor que sourceInUs")
    raw = source_us * den / num
    return math.floor(raw + 0.5)


def normalize_document(
    document: dict[str, Any],  # allowlist: dict[str, Any]
    *,
    expected_revision: int | None = None,
) -> dict[str, Any]:  # allowlist: dict[str, Any]
    doc = copy.deepcopy(document)
    if expected_revision is not None:
        current = int(doc.get("revision", 0))
        if current != int(expected_revision):
            raise EditorContractError(
                f"revision obsoleta: se esperaba {expected_revision} y el "
                f"documento está en {current}"
            )
    doc["revision"] = int(doc.get("revision", 0)) + 1
    doc["updatedAt"] = utc_now_iso()
    return validate_document(doc)
