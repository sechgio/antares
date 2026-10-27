from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
import time
from pathlib import Path

from backend.core.integrations.types import JsonObject

MAX_SNAPSHOT_BYTES = 25 * 1024 * 1024
UNDO_METHODS = frozenset({"fs_write", "fs_edit", "drafts_save"})


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _target(method: str, resources: list[JsonObject]) -> JsonObject | None:
    if method not in UNDO_METHODS or not resources:
        return None
    return resources[-1] if method == "drafts_save" else resources[0]


def _directory_size(directory: Path) -> int:
    total = 0
    try:
        for entry in directory.rglob("*"):
            try:
                if entry.is_file() and not entry.is_symlink():
                    total += entry.stat().st_size
            except OSError:
                continue
    except OSError:
        pass
    return total


def _safe_path(path: Path) -> None:
    if not path.is_absolute():
        raise ValueError("La ruta registrada no es absoluta")
    if path.is_symlink() or any(parent.is_symlink() for parent in path.parents):
        raise ValueError("La ruta o una carpeta superior es un enlace simbólico; no se deshizo")
    if os.path.normcase(os.path.realpath(path)) != os.path.normcase(os.path.abspath(path)):
        raise ValueError("La ruta real no coincide con la ruta registrada; no se deshizo")


class UndoJournal:

    def __init__(self, base_dir: Path) -> None:
        self._root = base_dir / "undo"

    def prepare(self, op_id: str, method: str, resources: list[JsonObject]) -> JsonObject | None:
        target = _target(method, resources)
        if target is None:
            return None
        raw = target.get("path")
        if not isinstance(raw, str) or not raw:
            return {"available": False, "reason": "No se pudo identificar el archivo"}
        path = Path(raw)
        directory = self._root / op_id
        try:
            _safe_path(path)
            if path.exists() and not path.is_file():
                return {"available": False, "reason": "La ruta no es un archivo local seguro"}
            existed = path.is_file()
            if existed and path.stat().st_size > MAX_SNAPSHOT_BYTES:
                return {"available": False, "reason": "El archivo supera 25 MB"}
            directory.mkdir(parents=True, exist_ok=True)
            snapshot = directory / "before"
            before_sha256 = None
            if existed:
                shutil.copy2(path, snapshot)
                before_sha256 = _sha256(snapshot)
                expected = target.get("sha256")
                if isinstance(expected, str) and expected and before_sha256 != expected:
                    shutil.rmtree(directory, ignore_errors=True)
                    return {"available": False, "reason": "El archivo cambió antes de la copia previa"}
            return {
                "available": True,
                "kind": "restore" if existed else "delete",
                "path": str(path),
                "dir": str(directory),
                "snapshot": str(snapshot) if existed else None,
                "before_sha256": before_sha256,
                "after_sha256": None,
                "undone_at": None,
            }
        except ValueError as err:
            shutil.rmtree(directory, ignore_errors=True)
            return {"available": False, "reason": str(err)}
        except OSError as err:
            shutil.rmtree(directory, ignore_errors=True)
            return {"available": False, "reason": f"No se pudo guardar la copia previa: {err}"}

    def finish(self, undo: JsonObject | None) -> JsonObject | None:
        if not undo or not undo.get("available"):
            return undo
        path = Path(str(undo.get("path") or ""))
        try:
            _safe_path(path)
            if path.is_file():
                undo["after_sha256"] = _sha256(path)
            elif undo.get("kind") == "delete":
                undo["available"] = False
                undo["reason"] = "La acción no creó el archivo esperado"
            else:
                undo["available"] = False
                undo["reason"] = "El archivo ya no existe"
        except ValueError as err:
            undo["available"] = False
            undo["reason"] = str(err)
        except OSError as err:
            undo["available"] = False
            undo["reason"] = f"No se pudo verificar el resultado: {err}"
        return undo

    def matches_after(self, undo: JsonObject) -> bool:
        expected = undo.get("after_sha256")
        if not isinstance(expected, str) or not expected:
            return False
        path = Path(str(undo.get("path") or ""))
        try:
            _safe_path(path)
            return path.is_file() and _sha256(path) == expected
        except (ValueError, OSError):
            return False

    def restore(self, undo: JsonObject) -> None:
        path = Path(str(undo.get("path") or ""))
        _safe_path(path)
        current = _sha256(path) if path.is_file() else None
        if current != undo.get("after_sha256"):
            raise ValueError("El archivo cambió después de la acción; no se deshizo para no perder cambios")
        if undo.get("kind") == "delete":
            if path.is_file():
                path.unlink()
            return
        snapshot = Path(str(undo.get("snapshot") or ""))
        if not snapshot.is_file() or _sha256(snapshot) != undo.get("before_sha256"):
            raise ValueError("La copia previa ya no está disponible")
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temp = tempfile.mkstemp(prefix=".antares-undo-", suffix=path.suffix or ".tmp", dir=path.parent)
        os.close(descriptor)
        try:
            shutil.copy2(snapshot, temp)
            if _sha256(Path(temp)) != undo.get("before_sha256"):
                raise ValueError("La copia restaurada no coincide con el original")
            os.replace(temp, path)
        except BaseException:
            Path(temp).unlink(missing_ok=True)
            raise

    def prune(self, max_age_days: int = 7, max_bytes: int = 512 * 1024 * 1024) -> list[str]:
        try:
            directories = [entry for entry in self._root.iterdir() if entry.is_dir() and not entry.is_symlink()]
        except OSError:
            return []
        entries: list[tuple[float, int, str]] = []
        for directory in directories:
            try:
                entries.append((directory.stat().st_mtime, _directory_size(directory), directory.name))
            except OSError:
                continue
        cutoff = time.time() - max_age_days * 86400
        removed: list[str] = []
        kept: list[tuple[float, int, str]] = []
        for modified, size, name in entries:
            if modified < cutoff:
                shutil.rmtree(self._root / name, ignore_errors=True)
                if not (self._root / name).exists():
                    removed.append(name)
            else:
                kept.append((modified, size, name))
        total = sum(size for _, size, _ in kept)
        kept.sort(key=lambda entry: entry[0])
        for _, size, name in kept:
            if total <= max_bytes:
                break
            shutil.rmtree(self._root / name, ignore_errors=True)
            if not (self._root / name).exists():
                removed.append(name)
                total -= size
        return removed

    def discard(self, undo: JsonObject | None) -> None:
        directory = undo.get("dir") if isinstance(undo, dict) else None
        if isinstance(directory, str) and directory:
            shutil.rmtree(directory, ignore_errors=True)
