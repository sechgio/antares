from __future__ import annotations

import base64
import contextlib
import ctypes
import hashlib
import hmac
import json
import logging
import os
import secrets
import sys
from ctypes import wintypes
from datetime import datetime, timezone
from pathlib import Path
from typing import cast

from backend.core.integrations.types import JsonObject
from backend.utils.paths import user_data_path

logger = logging.getLogger(__name__)

_NS = "antares-connections"


_KEY_FILE = ".vault-key"


def _legacy_machine_key(namespace: str) -> bytes:
    base = user_data_path(".")
    seed = f"antares:{os.path.realpath(base)}:{_NS}:{namespace}".encode()
    return hashlib.sha256(seed).digest()


def _machine_key(namespace: str) -> bytes:
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


class _CRYPT_DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.c_void_p),
    ]


def _blob(data: bytes) -> _CRYPT_DATA_BLOB:
    buf = (ctypes.c_ubyte * max(len(data), 1)).from_buffer_copy(data or b"\x00")
    blob = _CRYPT_DATA_BLOB(len(data), ctypes.cast(buf, ctypes.c_void_p))
    blob._holder = buf  # mantiene vivo el buffer mientras exista el BLOB
    return blob


_crypt32_cache: ctypes.WinDLL | None = None
_crypt32_checked = False


def _crypt32_dll() -> ctypes.WinDLL | None:
    # authn-006: el import antiguo (win32ctypes...win32crypt) apuntaba a un
    # módulo que no existe en pywin32-ctypes, de modo que DPAPI nunca estaba
    # disponible y TODOS los secretos caían al sello HMAC de clave en claro.
    # crypt32.dll se llama directamente vía ctypes: la API vive en Windows.
    global _crypt32_cache, _crypt32_checked
    if sys.platform != "win32":
        return None
    if not _crypt32_checked:
        _crypt32_checked = True
        try:
            _crypt32_cache = ctypes.WinDLL("crypt32")
        except OSError:
            _crypt32_cache = None
    return _crypt32_cache


def _dpapi_available() -> bool:
    return _crypt32_dll() is not None


def _dpapi_free(ptr: int | None) -> None:
    if ptr:
        ctypes.windll.kernel32.LocalFree(ctypes.c_void_p(ptr))


def _dpapi_seal(namespace: str, payload: JsonObject) -> JsonObject:
    dll = _crypt32_dll()
    if dll is None:
        raise ValueError("DPAPI no disponible en esta plataforma")
    plain = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    blob = _blob(plain)
    out = _CRYPT_DATA_BLOB()
    description = ctypes.c_wchar_p(f"Antares connections:{namespace}")
    if not dll.CryptProtectData(
        ctypes.byref(blob), description, None, None, None, 0, ctypes.byref(out)
    ):
        raise ValueError("CryptProtectData falló")
    try:
        data = ctypes.string_at(out.pbData, out.cbData)
    finally:
        _dpapi_free(out.pbData)
    return {"v": 2, "kind": "dpapi", "data": base64.b64encode(data).decode("ascii")}


def _dpapi_open(encoded: str) -> JsonObject:
    dll = _crypt32_dll()
    if dll is None:
        raise ValueError("DPAPI no disponible en esta plataforma")
    blob = _blob(base64.b64decode(encoded))
    out = _CRYPT_DATA_BLOB()
    if not dll.CryptUnprotectData(
        ctypes.byref(blob), None, None, None, None, 0, ctypes.byref(out)
    ):
        raise ValueError("payload DPAPI no descifrable en esta plataforma")
    try:
        data = ctypes.string_at(out.pbData, out.cbData)
    finally:
        _dpapi_free(out.pbData)
    return cast(JsonObject, json.loads(data.decode("utf-8")))


def _xor_stream(key: bytes, iv: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        out.extend(hmac.new(key, iv + counter.to_bytes(8, "big"), hashlib.sha256).digest())
        counter += 1
    return bytes(out[:length])


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
    path.parent.mkdir(parents=True, exist_ok=True)
    # authn-006: sin DPAPI la escritura caía a un sello HMAC con la clave en
    # claro junto a los sobres (o a una clave pública heredada recalcable):
    # equivalente a texto plano en disco. Fallar en voz alta, igual que el
    # almacenamiento seguro del lado Electron; los sobres legados siguen
    # leyéndose con _hmac_open para migrarlos a DPAPI en el próximo guardado.
    if not _dpapi_available():
        raise ValueError(
            "El cifrado DPAPI no está disponible: Antares no guardará el secreto sin cifrado confidencial. "
            "Reinicia la sesión de Windows e inténtalo de nuevo."
        )
    envelope = _dpapi_seal(namespace, payload)
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
