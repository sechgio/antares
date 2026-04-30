"""Tests para el motor de renombrado automático.

Prove-It: El bug reportado era que {codigo}_{nombre}{ext} generaba
1_1_1_1.jpg en lugar de 1_2454514245.jpg cuando la BD tenía
nombre=2454514245 para codigo=1.
"""

import pytest
from pathlib import Path
from backend.core.renamer import RenamerEngine


class TestRenamerEngine:
    """Pruebas para RenamerEngine.aplicar y preview_lote."""

    def test_aplicar_con_datos_completos(self, monkeypatch, tmp_path):
        """Patrón {codigo}_{nombre}{ext} con datos en BD → nombre correcto."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo", "nombre"],
        )

        engine = RenamerEngine("{codigo}_{nombre}{ext}", secuencia_inicial=1)
        archivo = tmp_path / "1.jpg"
        archivo.write_text("dummy")

        resultado = engine.aplicar(archivo, codigo_manual="1", datos_bd={"codigo": "1", "nombre": "2454514245"})

        assert resultado == "1_2454514245.jpg"

    def test_aplicar_fallback_codigo_para_campo_principal(self, monkeypatch, tmp_path):
        """Si faltan campos secundarios, elimina separadores sobrantes."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo", "nombre"],
        )

        engine = RenamerEngine("{codigo}_{nombre}{ext}", secuencia_inicial=1)
        archivo = tmp_path / "1.jpg"
        archivo.write_text("dummy")

        resultado = engine.aplicar(archivo, codigo_manual="1")

        assert resultado == "1.jpg"

    def test_aplicar_otros_campos_vacios_si_no_estan_en_bd(self, monkeypatch, tmp_path):
        """Campos distintos al primero quedan vacíos si no hay BD."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo", "nombre"],
        )

        engine = RenamerEngine("{codigo}_{nombre}{ext}", secuencia_inicial=1)
        archivo = tmp_path / "1.jpg"
        archivo.write_text("dummy")

        resultado = engine.aplicar(archivo, codigo_manual="1", datos_bd={"codigo": "1"})

        assert resultado == "1.jpg"

    def test_aplicar_no_propaga_stem_como_dato(self, monkeypatch, tmp_path):
        """Bugfix: el stem del archivo NO debe usarse como fallback para campos secundarios.

        Antes del fix, si el archivo se llamaba '1_1.jpg' y no había BD,
        el nombre se convertía en '1_1_1_1.jpg' porque ruta.stem era el fallback.
        """
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo", "nombre"],
        )

        engine = RenamerEngine("{codigo}_{nombre}{ext}", secuencia_inicial=1)
        archivo = tmp_path / "1_1.jpg"
        archivo.write_text("dummy")

        resultado = engine.aplicar(archivo, codigo_manual="1")

        # El código es "1", nombre no está en BD → vacío → "1.jpg"
        assert resultado == "1.jpg"
        assert "1_1_1_1" not in resultado

    def test_limpia_separadores_repetidos_al_faltar_datos(self, monkeypatch, tmp_path):
        """Los campos vacíos no deben dejar guiones o espacios colgando."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo", "nombre", "categoria"],
        )

        engine = RenamerEngine("{codigo} - {nombre} - {categoria}{ext}", secuencia_inicial=1)
        archivo = tmp_path / "1.jpg"
        archivo.write_text("dummy")

        resultado = engine.aplicar(archivo, codigo_manual="1", datos_bd={"codigo": "1"})

        assert resultado == "1.jpg"

    def test_secuencia_autoincremental(self, monkeypatch, tmp_path):
        """Cada llamada a aplicar incrementa {seq}."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo"],
        )

        engine = RenamerEngine("img_{seq}{ext}", secuencia_inicial=5)
        archivo = tmp_path / "a.jpg"
        archivo.write_text("dummy")

        assert engine.aplicar(archivo) == "img_005.jpg"
        assert engine.aplicar(archivo) == "img_006.jpg"
        assert engine.aplicar(archivo) == "img_007.jpg"

    def test_ext_mantiene_extension_original(self, monkeypatch, tmp_path):
        """{ext} usa la extensión del archivo origen."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo"],
        )

        engine = RenamerEngine("{codigo}{ext}", secuencia_inicial=1)

        jpg = tmp_path / "a.jpg"
        png = tmp_path / "b.png"
        jpg.write_text("dummy")
        png.write_text("dummy")

        assert engine.aplicar(jpg, codigo_manual="X") == "X.jpg"
        assert engine.aplicar(png, codigo_manual="Y") == "Y.png"

    def test_sanitiza_nombre(self, monkeypatch, tmp_path):
        """Elimina caracteres inválidos del resultado final."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo", "nombre"],
        )

        engine = RenamerEngine("{nombre}{ext}", secuencia_inicial=1)
        archivo = tmp_path / "a.jpg"
        archivo.write_text("dummy")

        resultado = engine.aplicar(archivo, codigo_manual="A", datos_bd={"codigo": "A", "nombre": "prod<1>"})

        assert "<" not in resultado
        assert ">" not in resultado
        assert resultado == "prod_1_.jpg"

    def test_preview_lote_no_mutua_secuencia(self, monkeypatch, tmp_path):
        """preview_lote no debe cambiar el contador interno de secuencia."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo"],
        )

        engine = RenamerEngine("{seq}{ext}", secuencia_inicial=10)
        a = tmp_path / "a.jpg"
        b = tmp_path / "b.jpg"
        a.write_text("d")
        b.write_text("d")

        previews = engine.preview_lote([a, b], lookup_fn=lambda c: None)

        assert len(previews) == 2
        assert engine.secuencia == 10  # No cambió
        # La primera llamada real debe seguir desde 10
        assert engine.aplicar(a, codigo_manual="x") == "010.jpg"

    def test_patron_por_defecto(self, monkeypatch, tmp_path):
        """Sin patrón explícito usa los dos primeros campos."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: ["codigo", "nombre", "categoria"],
        )

        engine = RenamerEngine(patron=None, secuencia_inicial=1)
        archivo = tmp_path / "a.jpg"
        archivo.write_text("dummy")

        assert engine.patron == "{codigo}_{nombre}{ext}"

    def test_patron_por_defecto_sin_campos_usa_secuencia(self, monkeypatch, tmp_path):
        """Sin campos configurados usa un patrón secuencial simple."""
        monkeypatch.setattr(
            "backend.core.renamer.get_field_names",
            lambda: [],
        )

        engine = RenamerEngine(patron=None, secuencia_inicial=1)
        archivo = tmp_path / "a.jpg"
        archivo.write_text("dummy")

        assert engine.patron == "img_{seq}{ext}"
        assert engine.aplicar(archivo) == "img_001.jpg"
