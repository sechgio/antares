from __future__ import annotations

from backend.core import formatos


def test_delete_format_disables_builtin_without_removing_b64_file(monkeypatch, tmp_path) -> None:
    builtin_b64 = tmp_path / "builtin.b64"
    builtin_b64.write_text("JVBERi0=", encoding="ascii")

    entry = {
        "id": "builtin-test",
        "nombre": "Builtin Test",
        "origen": "builtin",
        "storage_path": "builtin.b64",
        "enabled": True,
        "persisted": True,
        "strategy": formatos.VISUAL_OVERLAY,
        "mapping": None,
        "filename_pattern": "builtin-test_{desde}.pdf",
        "max_pages": 500,
        "number_min": 1,
        "number_max": 9999999,
        "has_mapping": False,
    }

    monkeypatch.setattr(formatos, "_CATALOG_PATH", tmp_path / "catalog.json")
    monkeypatch.setattr(formatos, "_BUILTIN_DIR", tmp_path)
    monkeypatch.setattr(formatos, "_formats", {"builtin-test": dict(entry)})

    removed_paths: list[str] = []
    real_remove = formatos.os.remove

    def spy_remove(path):
        removed_paths.append(str(path))

    monkeypatch.setattr(formatos.os, "remove", spy_remove)

    result = formatos.delete_format("builtin-test")

    assert result is True
    assert builtin_b64.exists()
    assert removed_paths == []
    assert formatos._formats["builtin-test"]["enabled"] is False
    monkeypatch.setattr(formatos.os, "remove", real_remove)


def test_delete_format_removes_uploaded_file_and_drops_entry(monkeypatch, tmp_path) -> None:
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir()
    uploaded_pdf = uploads_dir / "upload-abc.pdf"
    uploaded_pdf.write_bytes(b"%PDF-1.4")

    entry = {
        "id": "upload-abc",
        "nombre": "Upload ABC",
        "origen": "uploaded",
        "storage_path": "upload-abc.pdf",
        "enabled": True,
        "persisted": True,
        "strategy": formatos.SIMPLE_OVERLAY,
        "mapping": None,
        "filename_pattern": "upload-abc_{desde}.pdf",
        "max_pages": 500,
        "number_min": 1,
        "number_max": 9999999,
        "has_mapping": False,
    }

    monkeypatch.setattr(formatos, "_CATALOG_PATH", tmp_path / "catalog.json")
    monkeypatch.setattr(formatos, "_UPLOADS_DIR", uploads_dir)
    monkeypatch.setattr(formatos, "_formats", {"upload-abc": dict(entry)})

    result = formatos.delete_format("upload-abc")

    assert result is True
    assert not uploaded_pdf.exists()
    assert "upload-abc" not in formatos._formats


def test_delete_format_returns_false_for_unknown_id(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(formatos, "_CATALOG_PATH", tmp_path / "catalog.json")
    monkeypatch.setattr(formatos, "_formats", {})

    result = formatos.delete_format("does-not-exist")

    assert result is False
