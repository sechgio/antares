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

    def test_mapping_does_not_consume_secuencia(self, monkeypatch, tmp_path) -> None:
        monkeypatch.setattr("backend.core.renamer.get_field_names", lambda: ["codigo"])
        engine = RenamerEngine("img_{seq}{ext}", secuencia_inicial=1)
        mapped = tmp_path / "mapped.jpg"
        mapped.write_text("x")

        assert engine.aplicar(mapped, file_mapping={"mapped.jpg": "fachada"}) == "fachada.jpg"
        assert engine.secuencia == 1

        unmapped = tmp_path / "other.jpg"
        unmapped.write_text("x")
        assert engine.aplicar(unmapped) == "img_001.jpg"
        assert engine.aplicar(unmapped) == "img_002.jpg"

    def test_mixed_mapping_and_pattern_keeps_secuencia(self, monkeypatch, tmp_path) -> None:
        monkeypatch.setattr("backend.core.renamer.get_field_names", lambda: ["codigo"])
        engine = RenamerEngine("img_{seq}{ext}", secuencia_inicial=1)
        mapping = {f"mapped_{i}.jpg": f"fachada_{i}" for i in range(1, 6)}
        results: list[str] = []

        for i in range(1, 6):
            archivo = tmp_path / f"mapped_{i}.jpg"
            archivo.write_text("x")
            results.append(engine.aplicar(archivo, file_mapping=mapping))

        for i in range(1, 6):
            archivo = tmp_path / f"pattern_{i}.jpg"
            archivo.write_text("x")
            results.append(engine.aplicar(archivo))

        assert results[:5] == [f"fachada_{i}.jpg" for i in range(1, 6)]
        assert results[5:] == [f"img_{i:03d}.jpg" for i in range(1, 6)]

    def test_preview_lote_unmapped_preserves_original(self, monkeypatch, tmp_path) -> None:
        monkeypatch.setattr("backend.core.renamer.get_field_names", lambda: ["codigo"])
        engine = RenamerEngine("img_{seq}{ext}", secuencia_inicial=1)
        mapped = tmp_path / "mapped.jpg"
        orphan = tmp_path / "orphan_1.jpg"
        mapped.write_text("x")
        orphan.write_text("x")

        preview = engine.preview_lote(
            [mapped, orphan],
            file_mapping={"mapped.jpg": "fachada"},
        )

        assert preview[0][1] == "fachada.jpg"
        assert preview[0][2] is True
        assert preview[1][1] == "orphan_1.jpg"
        assert preview[1][2] is False

    def test_preview_lote_empty_patron_unmapped_not_extension_only(
        self, monkeypatch, tmp_path
    ) -> None:
        monkeypatch.setattr("backend.core.renamer.get_field_names", lambda: ["codigo"])
        engine = RenamerEngine("")
        orphan = tmp_path / "orphan.jpg"
        orphan.write_text("x")

        preview = engine.preview_lote(
            [orphan],
            file_mapping={"other.jpg": "renamed"},
        )

        assert preview == [(str(orphan), "orphan.jpg", False)]
