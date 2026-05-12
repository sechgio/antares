"""Tests para el módulo de conversión de imágenes.

Crea imágenes reales con Pillow para verificar conversiones,
redimensiones, manejo de errores y procesamiento por lotes.
"""

from pathlib import Path

import pytest
from PIL import Image

from backend.core.converter import (
    convertir_imagen,
    procesar_lote,
)
from backend.core.format_registry import get_registry


@pytest.fixture
def imagen_rgb(tmp_path):
    """Crea una imagen RGB de 100x100 píxeles."""
    ruta = tmp_path / "origen_rgb.png"
    img = Image.new("RGB", (100, 100), color=(255, 0, 0))
    img.save(ruta)
    return ruta


@pytest.fixture
def imagen_rgba(tmp_path):
    """Crea una imagen RGBA con transparencia."""
    ruta = tmp_path / "origen_rgba.png"
    img = Image.new("RGBA", (100, 100), color=(0, 255, 0, 128))
    img.save(ruta)
    return ruta


class TestObtenerFormatos:
    def test_retorna_lista_no_vacia(self):
        formatos = get_registry().list_formats()
        assert isinstance(formatos, list)
        assert "JPEG" in formatos
        assert "PNG" in formatos


class TestConvertirImagen:
    def test_convierte_png_a_jpeg(self, imagen_rgb, tmp_path):
        salida = tmp_path / "salida.jpg"
        resultado = convertir_imagen(imagen_rgb, salida, "JPEG", calidad=90)
        assert resultado == salida
        assert salida.exists()
        with Image.open(salida) as img:
            assert img.format == "JPEG"

    def test_convierte_rgba_a_jpeg_con_fondo_blanco(self, imagen_rgba, tmp_path):
        salida = tmp_path / "salida.jpg"
        convertir_imagen(imagen_rgba, salida, "JPEG")
        with Image.open(salida) as img:
            assert img.mode == "RGB"
            # El pixel (0,0) debe ser aproximadamente verde claro sobre blanco,
            # no transparente.

    def test_redimensiona(self, imagen_rgb, tmp_path):
        salida = tmp_path / "salida.jpg"
        convertir_imagen(imagen_rgb, salida, "JPEG", resize=(50, 50))
        with Image.open(salida) as img:
            assert img.size == (50, 50)

    def test_mantiene_exif(self, tmp_path):
        # Crear imagen JPEG con EXIF real mínimo válido
        origen = tmp_path / "con_exif.jpg"
        img = Image.new("RGB", (10, 10))
        # EXIF mínimo válido: header + IFD0 con 0 entradas (little-endian)
        exif_bytes = b"Exif\x00\x00II\x2a\x00\x08\x00\x00\x00\x00\x00\x00\x00\x00\x00"
        img.save(origen, exif=exif_bytes)

        salida = tmp_path / "salida_exif.jpg"
        convertir_imagen(origen, salida, "JPEG", keep_exif=True)
        with Image.open(salida) as img:
            assert "exif" in img.info

    def test_calidad_limitada_rango(self, imagen_rgb, tmp_path):
        salida = tmp_path / "salida.jpg"
        # Calidad > 100 se debe clampar a 100 sin error
        convertir_imagen(imagen_rgb, salida, "JPEG", calidad=150)
        assert salida.exists()

    def test_archivo_no_existe(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            convertir_imagen(tmp_path / "no_existe.jpg", tmp_path / "out.jpg", "JPEG")

    def test_formato_no_soportado(self, imagen_rgb, tmp_path):
        with pytest.raises(ValueError, match="Formato no soportado"):
            convertir_imagen(imagen_rgb, tmp_path / "out.xyz", "XYZ")

    def test_usa_encoder_registrado_por_plugin(self, imagen_rgb, tmp_path, monkeypatch):
        from backend.core import converter
        from backend.core.format_registry import FormatRegistry

        registry = FormatRegistry()

        def encoder(img, destino, formato, save_kwargs):
            Path(destino).write_text(
                f"{formato}:{img.mode}:{img.size[0]}x{img.size[1]}:{save_kwargs['quality']}",
                encoding="utf-8",
            )

        registry.add_format("TXTIMG", ".txt", ("RGB",), encoder=encoder)
        monkeypatch.setattr(converter, "FORMATOS_SOPORTADOS", registry)

        salida = tmp_path / "salida.txt"
        resultado = convertir_imagen(imagen_rgb, salida, "TXTIMG", calidad=77)

        assert resultado == salida
        assert salida.read_text(encoding="utf-8") == "TXTIMG:RGB:100x100:77"


class TestProcesarLote:
    def test_procesa_multiples_archivos(self, imagen_rgb, tmp_path):
        destino = tmp_path / "destino"
        resultados = procesar_lote([imagen_rgb], str(destino), "PNG")
        assert len(resultados) == 1
        assert Path(resultados[0]).exists()

    def test_llama_callback(self, imagen_rgb, tmp_path):
        destino = tmp_path / "destino"
        llamadas = []

        def cb(i, total, ruta):
            llamadas.append((i, total, ruta))

        procesar_lote([imagen_rgb], str(destino), "PNG", progreso_callback=cb)
        assert len(llamadas) == 1
        assert llamadas[0][0] == 1
        assert llamadas[0][1] == 1

    def test_error_no_detiene_batch(self, imagen_rgb, tmp_path):
        destino = tmp_path / "destino"
        resultados = procesar_lote(
            [imagen_rgb, tmp_path / "no_existe.jpg"],
            str(destino),
            "PNG",
        )
        assert len(resultados) == 2
        assert Path(resultados[0]).exists()  # Éxito
        assert isinstance(resultados[1], str) and resultados[1].startswith("ERROR")
