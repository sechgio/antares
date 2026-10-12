"""L8.1: el empaquetado incluye todo lo que el editor necesita.

El build congelado (PyInstaller onedir) debe llevar el schema del
editor, el manifest multimedia y los avisos de licencia dentro del
paquete, y la resolución de herramientas debe funcionar sin PATH y en
directorios con caracteres Unicode. Este test verifica el contrato
declarado en ``backend/backend.spec`` sin necesidad de compilar.
"""

import json
import re
from pathlib import Path

SPEC = Path("backend/backend.spec")
BUILDER_YML = Path("electron-builder.yml")
MEDIA_DIR = Path("media")
SHARED_DIR = Path("shared")


def test_backend_spec_packs_editor_schema() -> None:
    """El schema del editor viaja en shared/ dentro del paquete."""
    text = SPEC.read_text(encoding="utf-8")
    assert "'shared'" in text
    assert "editor-schema.json" in text, "backend.spec no incluye shared/editor-schema.json"


def test_backend_spec_packs_media_manifest_and_notices() -> None:
    """El manifest y los avisos de licencia de media/ viajan en el paquete."""
    text = SPEC.read_text(encoding="utf-8")
    assert "media" in text
    assert "manifest.json" in text, "backend.spec no incluye media/manifest.json"
    assert "LICENSE-THIRD-PARTY.txt" in text, "backend.spec no incluye los avisos de licencia"


def test_manifest_and_notices_exist_on_disk() -> None:
    """Los archivos que empaqueta el spec existen en el repositorio."""
    assert (MEDIA_DIR / "manifest.json").is_file()
    assert (MEDIA_DIR / "LICENSE-THIRD-PARTY.txt").is_file()
    assert (SHARED_DIR / "editor-schema.json").is_file()


def test_installer_carries_media_folder() -> None:
    """electron-builder copia media/ a los recursos del instalador."""
    text = BUILDER_YML.read_text(encoding="utf-8")
    assert re.search(r"from:\s*media\b", text), (
        "electron-builder.yml no incluye media/ en extraResources"
    )


def test_schema_in_spec_matches_repo_schema() -> None:
    """El schema empaquetado es el mismo que valida el backend en desarrollo."""
    schema = json.loads((SHARED_DIR / "editor-schema.json").read_text(encoding="utf-8"))
    assert schema.get("$id") == "antares-editor-schema"
    assert schema.get("additionalProperties") is False
    props = schema.get("properties", {})
    assert "schemaVersion" in props
    assert props["schemaVersion"].get("const") == 1


def test_toolchain_resolves_without_path(monkeypatch, tmp_path: Path) -> None:
    """resolve_toolchain encuentra las herramientas por resource_path, sin PATH.

    Simula el paquete congelado: el directorio media/ con los binarios
    fuera de PATH y un directorio con caracteres Unicode.
    """
    from backend.core.editor import toolchain

    unicode_dir = tmp_path / "Antares Ñañó"
    media = unicode_dir / "media"
    media.mkdir(parents=True)
    for name in ("ffmpeg.exe", "ffprobe.exe"):
        (media / name).write_bytes(b"MZ-fake")
    monkeypatch.setattr(toolchain, "resource_path", lambda rel: unicode_dir / rel)
    monkeypatch.delenv("ANTARES_FFMPEG_DIR", raising=False)
    monkeypatch.setenv("PATH", r"C:\Windows\System32")

    resolved = toolchain.resolve_toolchain()
    assert resolved.ffmpeg == media / "ffmpeg.exe"
    assert resolved.ffprobe == media / "ffprobe.exe"


def test_toolchain_missing_media_raises_clear_error(monkeypatch, tmp_path: Path) -> None:
    """Sin binarios empaquetados el error es claro, no un fallo críptico."""
    from backend.core.editor import toolchain

    monkeypatch.setattr(toolchain, "resource_path", lambda rel: tmp_path / rel)
    monkeypatch.delenv("ANTARES_FFMPEG_DIR", raising=False)
    monkeypatch.setenv("PATH", r"C:\Windows\System32")

    try:
        toolchain.resolve_toolchain()
    except toolchain.ToolchainError as exc:
        assert "media" in str(exc).lower() or "ffmpeg" in str(exc).lower()
    else:
        raise AssertionError("resolve_toolchain debería fallar sin binarios")
