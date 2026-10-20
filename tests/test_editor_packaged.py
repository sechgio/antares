import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "backend/backend.spec"
BUILDER_YML = ROOT / "electron-builder.yml"
MEDIA_DIR = ROOT / "media"
SHARED_DIR = ROOT / "shared"


def test_backend_spec_packs_editor_schema() -> None:
    text = SPEC.read_text(encoding="utf-8")
    assert "'shared'" in text
    assert "editor-schema.json" in text, "backend.spec no incluye shared/editor-schema.json"


def test_backend_spec_packs_media_manifest_and_notices() -> None:
    text = SPEC.read_text(encoding="utf-8")
    assert "media" in text
    assert "manifest.json" in text, "backend.spec no incluye media/manifest.json"
    assert "LICENSE-THIRD-PARTY.txt" in text, "backend.spec no incluye los avisos de licencia"


def test_manifest_and_notices_exist_on_disk() -> None:
    assert (MEDIA_DIR / "manifest.json").is_file()
    assert (MEDIA_DIR / "LICENSE-THIRD-PARTY.txt").is_file()
    assert (SHARED_DIR / "editor-schema.json").is_file()


def test_installer_carries_media_folder() -> None:
    text = BUILDER_YML.read_text(encoding="utf-8")
    assert re.search(r"from:\s*media\b", text), (
        "electron-builder.yml no incluye media/ en extraResources"
    )


def test_schema_in_spec_matches_repo_schema() -> None:
    schema = json.loads((SHARED_DIR / "editor-schema.json").read_text(encoding="utf-8"))
    assert schema.get("$id") == "antares-editor-schema"
    assert schema.get("additionalProperties") is False
    props = schema.get("properties", {})
    assert "schemaVersion" in props
    assert props["schemaVersion"].get("const") == 1


def test_toolchain_resolves_without_path(monkeypatch, tmp_path: Path) -> None:
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
