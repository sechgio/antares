"""Firma HMAC de rutas autorizadas por los diálogos de Antares.

El motor de PDFs guiados solo acepta carpetas y archivos cuya lista lleva una
firma emitida por el backend; la clave es local y aleatoria por perfil.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import threading
from pathlib import Path

from backend.core.integrations.types import JsonObject
from backend.utils.paths import user_data_path

_lock = threading.Lock()


def _key_path() -> Path:
    return user_data_path("ai-agent/paths-key")


def _key() -> bytes:
    key_path = _key_path()
    with _lock:
        if not key_path.exists():
            key_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                with key_path.open("x", encoding="ascii") as handle:
                    handle.write(secrets.token_hex(32))
            except FileExistsError:
                pass
        return bytes.fromhex(key_path.read_text(encoding="ascii"))


def authorize_paths(paths: JsonObject) -> JsonObject:
    grants = {mode: paths.get(mode) or [] for mode in ("read", "write", "folders")}
    digest = hmac.new(_key(), json.dumps(grants, sort_keys=True).encode(), hashlib.sha256).hexdigest()
    return {**grants, "signature": digest}


def verify_paths(grants: JsonObject) -> bool:
    signature = grants.get("signature")
    return isinstance(signature, str) and hmac.compare_digest(signature, authorize_paths(grants)["signature"])
