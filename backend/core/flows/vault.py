"""Vault mínimo de secretos del backend: sella payloads JSON a disco.

- Windows: DPAPI (``CryptProtectData``) vía ``win32ctypes.pywin32``, la misma
  clase de protección que ``safeStorage`` de Electron.
- Otros SO (desarrollo): cifrado de flujo HMAC-SHA256 + etiqueta de integridad,
  con clave aleatoria persistida en ``<datos>/.vault-key`` (permisos 0600) —
  comparable al fallback v1 de ``electron/autoimg-secure-storage.js`` (no es
  DPAPI pero sí cifrado autenticado de verdad). Los payloads sellados con la
  clave derivada antigua (pre-v4) siguen leyéndose y se resellan al escribir.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import hmac
import importlib
import json
import logging
import os
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol, cast

from backend.core.flows.types import JsonObject
from backend.utils.paths import user_data_path

logger = logging.getLogger(__name__)

_NS = "antares-connections"


_KEY_FILE = ".vault-key"


def _legacy_machine_key(namespace: str) -> bytes:
    """Derivación antigua (determinista) conservada para leer vaults previos."""
    base = user_data_path(".")
    seed = f"antares:{os.path.realpath(base)}:{_NS}:{namespace}".encode()
    return hashlib.sha256(seed).digest()


def _machine_key(namespace: str) -> bytes:
    """Clave por namespace derivada de un material aleatorio persistido a disco."""
    key_path = user_data_path(_KEY_FILE)
    material: bytes | None = None
    try:
        raw = key_path.read_bytes()
        if len(raw) == 32:
            material = raw
    except OSError:
        pass
    if material is None:
        material = secrets.token_bytes(32)
        try:
            key_path.parent.mkdir(parents=True, exist_ok=True)
            key_path.write_bytes(material)
            os.chmod(key_path, 0o600)
        except OSError:
            logger.warning("No se pudo persistir la clave del vault en %s", key_path)
    return hmac.new(material, f"antares:{_NS}:{namespace}".encode(), hashlib.sha256).digest()


class _Win32Crypt(Protocol):
    def CryptProtectData(self, data: bytes, *args: object) -> bytes: ...
    def CryptUnprotectData(self, data: bytes, *args: object) -> tuple[bytes, bytes]: ...


def _dpapi_module() -> _Win32Crypt | None:
    if sys.platform != "win32":
        return None
    try:
        return cast(_Win32Crypt, importlib.import_module("win32ctypes.pywin32.win32crypt"))
    except Exception:
        return None


def _dpapi_available() -> bool:
    return _dpapi_module() is not None


def _dpapi_seal(namespace: str, payload: JsonObject) -> JsonObject:
    mod = _dpapi_module()
    if mod is None:
        raise ValueError("DPAPI no disponible en esta plataforma")
    blob = mod.CryptProtectData(
        json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        f"Antares connections:{namespace}",
        None,
        None,
        None,
        0,
    )
    return {"v": 2, "kind": "dpapi", "data": base64.b64encode(blob).decode("ascii")}


def _dpapi_open(encoded: str) -> JsonObject:
    mod = _dpapi_module()
    if mod is None:
        raise ValueError("DPAPI no disponible en esta plataforma")
    blob = base64.b64decode(encoded)
    data, _desc = mod.CryptUnprotectData(blob, None, None, None, 0)
    result: JsonObject = json.loads(bytes(data).decode("utf-8"))
    return result


def _xor_stream(key: bytes, iv: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        out.extend(hmac.new(key, iv + counter.to_bytes(8, "big"), hashlib.sha256).digest())
        counter += 1
    return bytes(out[:length])


def _hmac_seal(namespace: str, payload: JsonObject) -> JsonObject:
    enc_key = _machine_key(namespace)
    mac_key = hashlib.sha256(enc_key + b":mac").digest()
    iv = secrets.token_bytes(16)
    plain = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    stream = _xor_stream(enc_key, iv, len(plain))
    ciphertext = bytes(a ^ b for a, b in zip(plain, stream, strict=True))
    tag = hmac.new(mac_key, iv + ciphertext, hashlib.sha256).digest()
    return {
        "v": 3,
        "kind": "hmac-sha256-stream",
        "data": base64.b64encode(iv + tag + ciphertext).decode("ascii"),
    }


def _hmac_open(namespace: str, encoded: str) -> JsonObject:
    buf = base64.b64decode(encoded)
    iv, tag, ciphertext = buf[:16], buf[16:48], buf[48:]
    for enc_key in (_machine_key(namespace), _legacy_machine_key(namespace)):
        mac_key = hashlib.sha256(enc_key + b":mac").digest()
        expected = hmac.new(mac_key, iv + ciphertext, hashlib.sha256).digest()
        if not hmac.compare_digest(tag, expected):
            continue
        stream = _xor_stream(enc_key, iv, len(ciphertext))
        plain = bytes(a ^ b for a, b in zip(ciphertext, stream, strict=True))
        result: JsonObject = json.loads(plain.decode("utf-8"))
        return result
    raise ValueError("payload del vault corrupto o clave distinta")


def seal(namespace: str, path: Path, payload: JsonObject) -> None:
    """Escribe ``payload`` sellado en ``path`` atómicamente (tmp + rename)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    envelope = _dpapi_seal(namespace, payload) if _dpapi_available() else _hmac_seal(namespace, payload)
    envelope["savedAt"] = datetime.now(timezone.utc).isoformat()
    tmp = path.with_suffix(f".{secrets.token_hex(4)}.tmp")
    try:
        tmp.write_text(json.dumps(envelope, ensure_ascii=False, indent=2), encoding="utf-8")
        os.chmod(tmp, 0o600)
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink()


def open_sealed(namespace: str, path: Path) -> JsonObject | None:
    """Lee y des-sella ``path``; None si no existe o está vacío."""
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        logger.warning("Vault de conexiones corrupto en %s", path)
        return None
    if not isinstance(raw, dict) or not isinstance(raw.get("data"), str):
        return None
    kind = raw.get("kind")
    if kind == "dpapi":
        if not _dpapi_available():
            raise ValueError("payload DPAPI no descifrable en esta plataforma")
        return _dpapi_open(raw["data"])
    if kind == "hmac-sha256-stream":
        return _hmac_open(namespace, raw["data"])
    raise ValueError(f"formato de vault desconocido: {kind}")


def clear(path: Path) -> None:
    with contextlib.suppress(FileNotFoundError):
        path.unlink()
