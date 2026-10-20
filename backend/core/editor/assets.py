from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import uuid
from pathlib import Path
from typing import Any

from backend.utils.paths import user_data_path

_CHUNK = 1024 * 1024
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

ALLOWED_SUFFIXES: frozenset[str] = frozenset(
    {
        ".mp4",
        ".mkv",
        ".mov",
        ".webm",
        ".avi",
        ".mp3",
        ".wav",
        ".m4a",
        ".aac",
        ".ogg",
        ".flac",
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".gif",
    }
)

LARGE_FILE_WARN_BYTES = 512 * 1024 * 1024


class AssetImportError(ValueError):
    pass


def _validate_token(token: str) -> Path:
    if not token:
        raise AssetImportError("token de archivo vacío")
    source = Path(token).expanduser()
    if not source.is_absolute():
        raise AssetImportError("el token debe ser una ruta absoluta")
    if source.is_symlink():
        raise AssetImportError("symlink no permitido")
    if not source.is_file():
        raise AssetImportError("el archivo no existe o no es regular")
    if source.suffix.lower() not in ALLOWED_SUFFIXES:
        raise AssetImportError(f"extensión no admitida: {source.suffix or '(sin extensión)'}")
    return source


def free_disk_bytes(directory: Path) -> int:
    usage = shutil.disk_usage(directory)
    return usage.free


def _probe_streams(source: Path) -> tuple[int, list[dict[str, Any]]]:  # allowlist: dict[str, Any]
    from backend.core.editor.toolchain import probe_json, resolve_toolchain

    toolchain = resolve_toolchain()
    meta = probe_json(toolchain, source)
    duration_s = float(meta.get("format", {}).get("duration", 0) or 0)
    duration_us = round(duration_s * 1_000_000)
    streams: list[dict[str, Any]] = []  # allowlist: dict[str, Any]
    for stream in meta.get("streams", []):
        kind = stream.get("codec_type")
        if kind not in ("video", "audio"):
            continue
        time_base = stream.get("time_base", "1/1000")
        tb_num, _, tb_den = str(time_base).partition("/")
        entry: dict[str, Any] = {  # allowlist: dict[str, Any]
            "index": int(stream.get("index", len(streams))),
            "kind": kind,
            "codec": str(stream.get("codec_name", "")),
            "timeBase": {"num": int(tb_num or 1), "den": int(tb_den or 1000)},
        }
        if kind == "video":
            entry["width"] = int(stream.get("width", 0))
            entry["height"] = int(stream.get("height", 0))
            sar = stream.get("sample_aspect_ratio", "1:1")
            sar_num, _, sar_den = str(sar).partition(":")
            entry["sar"] = {"num": int(sar_num or 1), "den": int(sar_den or 1)}
            rotation = 0
            for side_data in stream.get("side_data_list") or []:
                if "rotation" in side_data:
                    rotation = round(float(side_data["rotation"])) % 360
            entry["rotation"] = rotation if rotation in (0, 90, 180, 270) else 0
            w, h = entry["width"], entry["height"]
            entry["orientation"] = "landscape" if w > h else ("portrait" if h > w else "square")
            entry["colorPrimaries"] = str(stream.get("color_primaries", ""))
            entry["colorTransfer"] = str(stream.get("color_transfer", ""))
            entry["colorSpace"] = str(stream.get("color_space", ""))
        else:
            entry["sampleRate"] = int(stream.get("sample_rate", 0))
            entry["channels"] = int(stream.get("channels", 0))
        streams.append(entry)
    if not streams:
        raise AssetImportError("el archivo no contiene streams de video ni audio reproducibles")
    return duration_us, streams


def _asset_type(suffix: str, streams: list[dict[str, Any]]) -> str:  # allowlist: dict[str, Any]
    image_suffixes = {".png", ".jpg", ".jpeg", ".webp"}
    animated = {".gif"}
    if suffix in animated:
        return "animation"
    if suffix in image_suffixes:
        return "image"
    if any(s["kind"] == "video" for s in streams):
        return "video"
    return "audio"


def import_file(token: str, *, assets_dir: Path | None = None) -> dict[str, Any]:  # allowlist: dict[str, Any]
    source = _validate_token(token)
    base = assets_dir if assets_dir is not None else user_data_path("editor") / "assets"
    base.mkdir(parents=True, exist_ok=True)

    size = source.stat().st_size
    if size == 0:
        raise AssetImportError("la grabación está vacía")
    if free_disk_bytes(base) < size:
        raise AssetImportError("espacio en disco insuficiente para importar el archivo")

    from backend.core.editor.toolchain import ToolchainError

    try:
        duration_us, streams = _probe_streams(source)
    except ToolchainError as exc:
        raise AssetImportError(f"el archivo no es un medio válido: {str(exc)[:120]}") from exc
    asset_id = uuid.uuid4().hex
    suffix = source.suffix.lower()
    target = base / f"{asset_id}{suffix}"
    digest = hashlib.sha256()
    copied = 0
    try:
        with source.open("rb") as src, target.open("wb") as dst:
            while True:
                chunk = src.read(_CHUNK)
                if not chunk:
                    break
                digest.update(chunk)
                dst.write(chunk)
                copied += len(chunk)
            dst.flush()
            os.fsync(dst.fileno())
    except OSError as exc:
        with_remove(target)
        raise AssetImportError(f"la copia falló: {exc}") from exc

    if copied != size:
        with_remove(target)
        raise AssetImportError(
            f"archivo truncado: se copiaron {copied} de {size} bytes"
        )

    from backend.core.editor.toolchain import ToolchainError, resolve_toolchain, verify_decodable

    try:
        verify_decodable(resolve_toolchain(), target)
    except ToolchainError as exc:
        with_remove(target)
        raise AssetImportError(f"archivo truncado o dañado: {exc}") from exc

    asset: dict[str, Any] = {  # allowlist: dict[str, Any]
        "id": asset_id,
        "type": _asset_type(suffix, streams),
        "displayName": source.name[:200],
        "byteSize": copied,
        "sha256": digest.hexdigest(),
        "streams": streams,
    }
    if duration_us > 0:
        asset["durationUs"] = duration_us

    index_path = base / f"{asset_id}.json"
    tmp = base / f".{asset_id}.json.tmp"
    try:
        tmp.write_text(json.dumps(asset, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, index_path)
    except OSError:
        with_remove(target)
        with_remove(index_path)
        raise AssetImportError("no se pudo registrar el asset") from None

    return asset


def with_remove(path: Path) -> None:
    import contextlib

    with contextlib.suppress(OSError):
        path.unlink(missing_ok=True)


def large_file_warning(source: Path) -> str | None:
    size = source.stat().st_size
    if size >= LARGE_FILE_WARN_BYTES:
        gb = size / (1024**3)
        return f"Este archivo ocupa {gb:.1f} GB y se copiará al almacén local de Antares."
    return None
