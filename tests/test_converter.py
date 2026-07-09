"""Tests para el módulo de conversión de imágenes.

Crea imágenes reales con Pillow para verificar conversiones,
redimensiones y manejo de errores.
"""

import base64
import io
import os
from pathlib import Path

import pytest
from PIL import Image

from backend.core.converter import _build_save_kwargs, convertir_a_preview, convertir_imagen
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


class TestBuildSaveKwargs:
    def test_jpeg_high_quality_includes_optimize(self) -> None:
        img = Image.new("RGB", (10, 10))
        kwargs = _build_save_kwargs("JPEG", 95, False, img)
        assert kwargs == {"quality": 95, "optimize": True}

    def test_webp_high_quality_omits_optimize(self) -> None:
        img = Image.new("RGB", (10, 10))
        kwargs = _build_save_kwargs("WEBP", 95, False, img)
        assert kwargs == {"quality": 95}


class TestObtenerFormatos:
    def test_retorna_lista_no_vacia(self) -> None:
        formatos = get_registry().list_formats()
        assert isinstance(formatos, list)
        assert "JPEG" in formatos
        assert "PNG" in formatos


class TestConvertirImagen:
    def test_convierte_png_a_jpeg(self, imagen_rgb, tmp_path) -> None:
        salida = tmp_path / "salida.jpg"
        resultado = convertir_imagen(imagen_rgb, salida, "JPEG", calidad=90)
        assert resultado == salida
        assert salida.exists()
        with Image.open(salida) as img:
            assert img.format == "JPEG"

    def test_convierte_rgba_a_jpeg_con_fondo_blanco(self, imagen_rgba, tmp_path) -> None:
        salida = tmp_path / "salida.jpg"
        convertir_imagen(imagen_rgba, salida, "JPEG")
        with Image.open(salida) as img:
            assert img.mode == "RGB"

    def test_redimensiona(self, imagen_rgb, tmp_path) -> None:
        salida = tmp_path / "salida.jpg"
        convertir_imagen(imagen_rgb, salida, "JPEG", resize=(50, 50))
        with Image.open(salida) as img:
            assert img.size == (50, 50)

    def test_mantiene_exif(self, tmp_path) -> None:
        # Crear imagen JPEG con EXIF real mínimo válido
        origen = tmp_path / "con_exif.jpg"
        img = Image.new("RGB", (10, 10))
        exif_bytes = b"Exif\x00\x00II\x2a\x00\x08\x00\x00\x00\x00\x00\x00\x00\x00\x00"
        img.save(origen, exif=exif_bytes)

        salida = tmp_path / "salida_exif.jpg"
        convertir_imagen(origen, salida, "JPEG", keep_exif=True)
        with Image.open(salida) as img:
            assert "exif" in img.info

    def test_aplica_exif_transpose(self, tmp_path, monkeypatch) -> None:
        """Phone photos store Orientation tags; pixels must be baked upright."""
        from PIL import ImageOps

        from backend.core import converter

        origen = tmp_path / "oriented.jpg"
        Image.new("RGB", (20, 10), color=(255, 0, 0)).save(origen, "JPEG")
        salida = tmp_path / "out.jpg"

        calls: list[bool] = []
        original = ImageOps.exif_transpose

        def spy(img: Image.Image) -> Image.Image | None:
            calls.append(True)
            return original(img)

        monkeypatch.setattr(converter.ImageOps, "exif_transpose", spy)
        convertir_imagen(origen, salida, "JPEG")
        assert calls, "exif_transpose must run during conversion"
        assert salida.exists()

    def test_calidad_limitada_rango(self, imagen_rgb, tmp_path) -> None:
        salida = tmp_path / "salida.jpg"
        convertir_imagen(imagen_rgb, salida, "JPEG", calidad=150)
        assert salida.exists()

    def test_archivo_no_existe(self, tmp_path) -> None:
        with pytest.raises(FileNotFoundError):
            convertir_imagen(tmp_path / "no_existe.jpg", tmp_path / "out.jpg", "JPEG")

    def test_formato_no_soportado(self, imagen_rgb, tmp_path) -> None:
        with pytest.raises(ValueError, match="Formato no soportado"):
            convertir_imagen(imagen_rgb, tmp_path / "out.xyz", "XYZ")

    def test_usa_encoder_registrado_por_plugin(self, imagen_rgb, tmp_path, monkeypatch) -> None:
        from backend.core import converter
        from backend.core.format_registry import FormatRegistry

        registry = FormatRegistry()

        def encoder(img, destino, formato, save_kwargs) -> None:
            Path(destino).write_text(
                f"{formato}:{img.mode}:{img.size[0]}x{img.size[1]}:{save_kwargs['quality']}",
                encoding="utf-8",
            )

        registry.add_format("TXTIMG", ".txt", ("RGB",), encoder=encoder)
        monkeypatch.setattr(converter, "_registry", registry)
        monkeypatch.setattr(converter, "FORMATOS_SOPORTADOS", registry)

        salida = tmp_path / "salida.txt"
        resultado = convertir_imagen(imagen_rgb, salida, "TXTIMG", calidad=77)

        assert resultado == salida
        assert salida.read_text(encoding="utf-8") == "TXTIMG:RGB:100x100:77"


class TestConvertirAPreview:
    """Vista previa: cap de 400px (B1) y cache invalidada por mtime (B2)."""

    def test_preview_cap_400px_con_resize_grande(self, tmp_path) -> None:
        from backend.core.preview_cache import get_preview_cache

        get_preview_cache().clear()
        # Imagen grande; el resize pedido (4000x3000) excede el cap de 400px.
        origen = tmp_path / "grande.png"
        Image.new("RGB", (2000, 1500), color=(10, 20, 30)).save(origen)

        resultado = convertir_a_preview(origen, "JPEG", calidad=85, resize=[4000, 3000])
        assert resultado["width"] == "2000"
        assert resultado["height"] == "1500"

        _header, b64 = resultado["preview"].split(",", 1)
        img = Image.open(io.BytesIO(base64.b64decode(b64)))
        # El cap de 400px debe sostenerse aunque resize sea enorme.
        assert max(img.size) <= 400, f"preview excede 400px: {img.size}"
        # El aspect del resize (4:3) se respeta dentro del cap.
        assert img.size == (400, 300)

    def test_preview_cache_invalidada_por_mtime(self, tmp_path) -> None:
        from backend.core.preview_cache import get_preview_cache

        get_preview_cache().clear()
        origen = tmp_path / "mut.png"
        Image.new("RGB", (800, 600), color=(255, 0, 0)).save(origen)
        os.utime(origen, (1_000_000, 1_000_000))

        r1 = convertir_a_preview(origen, "PNG")
        r2 = convertir_a_preview(origen, "PNG")
        assert r2["preview"] == r1["preview"]  # cache hit: misma mtime

        # Reescribir contenido y avanzar mtime -> cache miss, preview nueva.
        Image.new("RGB", (800, 600), color=(0, 0, 255)).save(origen)
        os.utime(origen, (2_000_000, 2_000_000))
        r3 = convertir_a_preview(origen, "PNG")
        assert r3["preview"] != r1["preview"], "preview stale tras editar imagen"
