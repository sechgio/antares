"""Tests para RenamerEngine con mapeo directo ID → RENOMBRE."""

from backend.core.renamer import RenamerEngine


class TestRenamerMapping:
    def test_mapping_with_extension(self, monkeypatch, tmp_path) -> None:
        monkeypatch.setattr("backend.core.renamer.get_field_names", lambda: ["codigo"])
        engine = RenamerEngine("{codigo}{ext}")
        archivo = tmp_path / "IMG_0001.jpg"
        archivo.write_text("x")
        result = engine.aplicar(archivo, file_mapping={"IMG_0001.jpg": "fachada_norte"})
        assert result == "fachada_norte.jpg"

    def test_mapping_without_extension_in_id(self, monkeypatch, tmp_path) -> None:
        monkeypatch.setattr("backend.core.renamer.get_field_names", lambda: ["codigo"])
        engine = RenamerEngine("{codigo}{ext}")
        archivo = tmp_path / "IMG_0001.jpg"
        archivo.write_text("x")
        result = engine.aplicar(archivo, file_mapping={"IMG_0001": "fachada"})
        assert result == "fachada.jpg"

    def test_mapping_case_insensitive(self, monkeypatch, tmp_path) -> None:
        monkeypatch.setattr("backend.core.renamer.get_field_names", lambda: ["codigo"])
        engine = RenamerEngine("{codigo}{ext}")
        archivo = tmp_path / "IMG_0001.jpg"
        archivo.write_text("x")
        result = engine.aplicar(archivo, file_mapping={"img_0001.jpg": "fachada"})
        assert result == "fachada.jpg"

    def test_no_match_falls_back_to_pattern(self, monkeypatch, tmp_path) -> None:
        monkeypatch.setattr("backend.core.renamer.get_field_names", lambda: ["codigo"])
        engine = RenamerEngine("{codigo}{ext}")
        archivo = tmp_path / "IMG_0001.jpg"
        archivo.write_text("x")
        result = engine.aplicar(
            archivo,
            codigo_manual="IMG_0001",
            file_mapping={"OTHER.jpg": "otro"},
        )
        assert result == "IMG_0001.jpg"

    def test_empty_mapping_ignored(self, monkeypatch, tmp_path) -> None:
        monkeypatch.setattr("backend.core.renamer.get_field_names", lambda: ["codigo"])
        engine = RenamerEngine("{codigo}{ext}")
        archivo = tmp_path / "X.jpg"
        archivo.write_text("x")
        result = engine.aplicar(archivo, codigo_manual="X", file_mapping={})
        assert result == "X.jpg"

    def test_build_mapping_patron(self) -> None:
        assert RenamerEngine.build_mapping_patron(["a", "b"]) == "{renombre}{ext}"
