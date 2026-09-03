
import base64
import io
import os
from pathlib import Path

import pytest
from PIL import Image

from backend.core.converter import (
    _build_save_kwargs,
    convertir_a_preview,
    convertir_imagen,
    copiar_archivo,
)
from backend.core.format_registry import get_registry


@pytest.fixture
def imagen_rgb(tmp_path):
    ruta = tmp_path / "origen_rgb.png"
    img = Image.new("RGB", (100, 100), color=(255, 0, 0))
    img.save(ruta)
    return ruta


@pytest.fixture
def imagen_rgba(tmp_path):
    ruta = tmp_path / "origen_rgba.png"
    img = Image.new("RGBA", (100, 100), color=(0, 255, 0, 128))
    img.save(ruta)
    return ruta


class TestBuildSaveKwargs:
    def test_jpeg_high_quality_omits_optimize_by_default(self) -> None:
        img = Image.new("RGB", (10, 10))
        kwargs = _build_save_kwargs("JPEG", 95, False, img)
        assert kwargs == {"quality": 95}
        assert "optimize" not in kwargs

    def test_jpeg_optimize_true_includes_optimize(self) -> None:
        img = Image.new("RGB", (10, 10))
        kwargs = _build_save_kwargs("JPEG", 95, False, img, optimize=True)
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
        origen = tmp_path / "con_exif.jpg"
        img = Image.new("RGB", (10, 10))
        exif_bytes = b"Exif\x00\x00II\x2a\x00\x08\x00\x00\x00\x00\x00\x00\x00\x00\x00"
        img.save(origen, exif=exif_bytes)

        salida = tmp_path / "salida_exif.jpg"
        convertir_imagen(origen, salida, "JPEG", keep_exif=True)
        with Image.open(salida) as img:
            assert "exif" in img.info

    def test_aplica_exif_transpose_when_oriented(self, tmp_path, monkeypatch) -> None:
        from PIL import ImageOps

        from backend.core import converter

        origen = tmp_path / "oriented.jpg"
        img = Image.new("RGB", (20, 10), color=(255, 0, 0))
        exif = img.getexif()
        exif[0x0112] = 6
        img.save(origen, "JPEG", exif=exif)
        salida = tmp_path / "out.jpg"

        calls: list[bool] = []
        original = ImageOps.exif_transpose

        def spy(source: Image.Image) -> Image.Image | None:
            calls.append(True)
            return original(source)

        monkeypatch.setattr(converter.ImageOps, "exif_transpose", spy)
        convertir_imagen(origen, salida, "JPEG")
        assert calls, "exif_transpose must run when Orientation requires transpose"
        with Image.open(salida) as out:
            assert out.size == (10, 20)

    def test_skips_exif_transpose_when_upright(self, tmp_path, monkeypatch) -> None:
        from backend.core import converter

        origen = tmp_path / "upright.jpg"
        Image.new("RGB", (20, 10), color=(255, 0, 0)).save(origen, "JPEG")
        salida = tmp_path / "out.jpg"

        calls: list[bool] = []

        def spy(source: Image.Image) -> Image.Image | None:
            calls.append(True)
            return source

        monkeypatch.setattr(converter.ImageOps, "exif_transpose", spy)
        convertir_imagen(origen, salida, "JPEG")
        assert not calls, "exif_transpose must be skipped for upright images"
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

    def test_escribe_via_tmp_y_replace(self, imagen_rgb, tmp_path, monkeypatch) -> None:
        import backend.core.converter as conv

        replace_calls: list[tuple[str, str]] = []
        real_replace = os.replace

        def tracking_replace(src, dst):
            replace_calls.append((str(src), str(dst)))
            return real_replace(src, dst)

        monkeypatch.setattr(conv.os, "replace", tracking_replace)

        salida = tmp_path / "atomic.jpg"
        resultado = convertir_imagen(imagen_rgb, salida, "JPEG", calidad=90)
        assert resultado == salida
        assert salida.exists()
        assert not list(tmp_path.glob("*.antares-tmp"))
        assert len(replace_calls) == 1
        src, dst = replace_calls[0]
        src_path = Path(src)
        assert src_path.parent == tmp_path
        assert src_path.name.endswith(".antares-tmp")
        assert src_path.name != salida.name
        assert Path(dst) == salida

    def test_ensure_dir_false_writes_when_parent_exists(self, imagen_rgb, tmp_path, monkeypatch) -> None:
        out_dir = tmp_path / "already_there"
        out_dir.mkdir()
        salida = out_dir / "out.jpg"

        mkdir_calls: list[Path] = []
        real_mkdir = Path.mkdir

        def tracking_mkdir(self, *args, **kwargs):
            mkdir_calls.append(self)
            return real_mkdir(self, *args, **kwargs)

        monkeypatch.setattr(Path, "mkdir", tracking_mkdir)

        resultado = convertir_imagen(imagen_rgb, salida, "JPEG", ensure_dir=False)
        assert resultado == salida
        assert salida.exists()
        assert salida.parent not in mkdir_calls

    def test_animated_gif_converts_only_first_frame(self, tmp_path) -> None:
        f0 = Image.new("RGB", (8, 8), (255, 0, 0))
        f1 = Image.new("RGB", (8, 8), (0, 255, 0))
        f2 = Image.new("RGB", (8, 8), (0, 0, 255))
        gif_path = tmp_path / "anim.gif"
        f0.save(
            gif_path,
            save_all=True,
            append_images=[f1, f2],
            duration=50,
            loop=0,
            format="GIF",
        )
        with Image.open(gif_path) as src:
            assert getattr(src, "n_frames", 1) >= 2

        out = tmp_path / "out.png"
        convertir_imagen(gif_path, out, "PNG")
        with Image.open(out) as img:
            assert getattr(img, "n_frames", 1) == 1
            px = img.convert("RGB").getpixel((0, 0))
            assert px[0] > 200 and px[1] < 80 and px[2] < 80


class TestFastCopy:

    def _make_jpeg(self, tmp_path, name="src.jpg", quality=95, exif: bytes | None = None):
        ruta = tmp_path / name
        img = Image.new("RGB", (64, 48), color=(10, 200, 30))
        kwargs = {"quality": quality}
        if exif is not None:
            kwargs["exif"] = exif
        img.save(ruta, "JPEG", **kwargs)
        return ruta

    def test_copia_byte_identica_jpeg_mismo_formato(self, tmp_path, monkeypatch) -> None:


        origen = self._make_jpeg(tmp_path)
        salida = tmp_path / "out.jpg"

        save_calls: list = []
        real_save = Image.Image.save

        def spy_save(self, *args, **kwargs):
            save_calls.append(1)
            return real_save(self, *args, **kwargs)

        monkeypatch.setattr(Image.Image, "save", spy_save)
        convertir_imagen(origen, salida, "JPEG", calidad=95)
        assert not save_calls, "fast-path must skip re-encode"
        assert salida.read_bytes() == origen.read_bytes()

    def test_copia_byte_identica_con_alias_jpg(self, tmp_path, monkeypatch) -> None:


        origen = self._make_jpeg(tmp_path, name="src.jpg")
        salida = tmp_path / "out.jpg"
        save_calls: list = []
        real_save = Image.Image.save

        def spy_save(self, *args, **kwargs):
            save_calls.append(1)
            return real_save(self, *args, **kwargs)

        monkeypatch.setattr(Image.Image, "save", spy_save)
        convertir_imagen(origen, salida, "JPG", calidad=95)
        assert not save_calls
        assert salida.read_bytes() == origen.read_bytes()

    def test_no_fast_path_cuando_calidad_baja(self, tmp_path, monkeypatch) -> None:


        origen = self._make_jpeg(tmp_path, quality=95)
        salida = tmp_path / "out.jpg"
        save_calls: list = []
        real_save = Image.Image.save

        def spy_save(self, *args, **kwargs):
            save_calls.append(1)
            return real_save(self, *args, **kwargs)

        monkeypatch.setattr(Image.Image, "save", spy_save)
        convertir_imagen(origen, salida, "JPEG", calidad=80)
        assert save_calls, "quality < 95 must re-encode"
        assert salida.read_bytes() != origen.read_bytes()

    def test_no_fast_path_con_resize(self, tmp_path, monkeypatch) -> None:


        origen = self._make_jpeg(tmp_path)
        salida = tmp_path / "out.jpg"
        save_calls: list = []
        real_save = Image.Image.save

        def spy_save(self, *args, **kwargs):
            save_calls.append(1)
            return real_save(self, *args, **kwargs)

        monkeypatch.setattr(Image.Image, "save", spy_save)
        convertir_imagen(origen, salida, "JPEG", calidad=95, resize=(32, 24))
        assert save_calls, "resize must re-encode"
        with Image.open(salida) as out:
            assert out.size == (32, 24)

    def test_no_fast_path_con_optimize(self, tmp_path, monkeypatch) -> None:


        origen = self._make_jpeg(tmp_path)
        salida = tmp_path / "out.jpg"
        save_calls: list = []
        real_save = Image.Image.save

        def spy_save(self, *args, **kwargs):
            save_calls.append(1)
            return real_save(self, *args, **kwargs)

        monkeypatch.setattr(Image.Image, "save", spy_save)
        convertir_imagen(origen, salida, "JPEG", calidad=95, optimize=True)
        assert save_calls, "optimize=True must re-encode"

    def test_no_fast_path_con_exif_y_keep_exif_false(self, tmp_path, monkeypatch) -> None:


        origen = tmp_path / "con_exif.jpg"
        img = Image.new("RGB", (10, 10))
        exif = img.getexif()
        exif[0x010F] = "TestMake"
        img.save(origen, "JPEG", exif=exif)
        with Image.open(origen) as src:
            assert src.getexif(), "fixture must carry parseable EXIF"
        salida = tmp_path / "out.jpg"
        save_calls: list = []
        real_save = Image.Image.save

        def spy_save(self, *args, **kwargs):
            save_calls.append(1)
            return real_save(self, *args, **kwargs)

        monkeypatch.setattr(Image.Image, "save", spy_save)
        convertir_imagen(origen, salida, "JPEG", calidad=95, keep_exif=False)
        assert save_calls, "EXIF strip contract requires re-encode"
        with Image.open(salida) as out:
            assert "exif" not in out.info

    def test_fast_path_con_exif_y_keep_exif_true(self, tmp_path, monkeypatch) -> None:


        origen = tmp_path / "con_exif.jpg"
        img = Image.new("RGB", (10, 10))
        exif = img.getexif()
        exif[0x010F] = "TestMake"
        img.save(origen, "JPEG", exif=exif)
        with Image.open(origen) as src:
            assert src.getexif(), "fixture must carry parseable EXIF"
        salida = tmp_path / "out.jpg"
        save_calls: list = []
        real_save = Image.Image.save

        def spy_save(self, *args, **kwargs):
            save_calls.append(1)
            return real_save(self, *args, **kwargs)

        monkeypatch.setattr(Image.Image, "save", spy_save)
        convertir_imagen(origen, salida, "JPEG", calidad=95, keep_exif=True)
        assert not save_calls
        with Image.open(salida) as out:
            assert "exif" in out.info
        assert salida.read_bytes() == origen.read_bytes()

    def test_no_fast_path_con_orientacion(self, tmp_path, monkeypatch) -> None:


        origen = tmp_path / "oriented.jpg"
        img = Image.new("RGB", (20, 10), color=(255, 0, 0))
        exif = img.getexif()
        exif[0x0112] = 6
        img.save(origen, "JPEG", exif=exif)
        salida = tmp_path / "out.jpg"

        save_calls: list = []
        real_save = Image.Image.save

        def spy_save(self, *args, **kwargs):
            save_calls.append(1)
            return real_save(self, *args, **kwargs)

        monkeypatch.setattr(Image.Image, "save", spy_save)
        convertir_imagen(origen, salida, "JPEG", calidad=95)
        assert save_calls, "oriented source must re-encode (bake pixels)"
        with Image.open(salida) as out:
            assert out.size == (10, 20)

    def test_no_fast_path_png_a_jpeg(self, tmp_path, monkeypatch) -> None:


        origen = tmp_path / "src.png"
        Image.new("RGB", (10, 10), color=(1, 2, 3)).save(origen)
        salida = tmp_path / "out.jpg"
        save_calls: list = []
        real_save = Image.Image.save

        def spy_save(self, *args, **kwargs):
            save_calls.append(1)
            return real_save(self, *args, **kwargs)

        monkeypatch.setattr(Image.Image, "save", spy_save)
        convertir_imagen(origen, salida, "JPEG", calidad=95)
        assert save_calls

    def test_fast_path_png_a_png(self, tmp_path, monkeypatch) -> None:


        origen = tmp_path / "src.png"
        Image.new("RGB", (10, 10), color=(1, 2, 3)).save(origen)
        salida = tmp_path / "out.png"
        save_calls: list = []
        real_save = Image.Image.save

        def spy_save(self, *args, **kwargs):
            save_calls.append(1)
            return real_save(self, *args, **kwargs)

        monkeypatch.setattr(Image.Image, "save", spy_save)
        convertir_imagen(origen, salida, "PNG", calidad=95)
        assert not save_calls
        assert salida.read_bytes() == origen.read_bytes()


class TestCopiarArchivo:
    def test_ensure_dir_false_skips_mkdir(self, imagen_rgb, tmp_path, monkeypatch) -> None:
        out_dir = tmp_path / "copy_dest"
        out_dir.mkdir()
        destino = out_dir / "copied.png"

        mkdir_calls: list[Path] = []
        real_mkdir = Path.mkdir

        def tracking_mkdir(self, *args, **kwargs):
            mkdir_calls.append(self)
            return real_mkdir(self, *args, **kwargs)

        monkeypatch.setattr(Path, "mkdir", tracking_mkdir)

        resultado = copiar_archivo(imagen_rgb, destino, ensure_dir=False)
        assert resultado == destino
        assert destino.exists()
        assert destino.parent not in mkdir_calls


class TestConvertirAPreview:

    def test_preview_cap_400px_con_resize_grande(self, tmp_path) -> None:
        from backend.core.preview_cache import get_preview_cache

        get_preview_cache().clear()
        origen = tmp_path / "grande.png"
        Image.new("RGB", (2000, 1500), color=(10, 20, 30)).save(origen)

        resultado = convertir_a_preview(origen, "JPEG", calidad=85, resize=[4000, 3000])
        assert resultado["width"] == "2000"
        assert resultado["height"] == "1500"
        assert "preview_path" in resultado
        assert resultado["preview"].startswith("file:")
        img = Image.open(resultado["preview_path"])
        assert max(img.size) <= 400, f"preview excede 400px: {img.size}"
        assert img.size == (400, 300)

    def test_preview_legacy_data_uri_opt_in(self, tmp_path) -> None:
        from backend.core.preview_cache import get_preview_cache

        get_preview_cache().clear()
        origen = tmp_path / "legacy.png"
        Image.new("RGB", (100, 80), color=(1, 2, 3)).save(origen)
        resultado = convertir_a_preview(origen, "JPEG", as_data_uri=True)
        assert resultado["preview"].startswith("data:image/")
        _header, b64 = resultado["preview"].split(",", 1)
        img = Image.open(io.BytesIO(base64.b64decode(b64)))
        assert max(img.size) <= 400

    def test_preview_cache_invalidada_por_mtime(self, tmp_path) -> None:
        from backend.core.preview_cache import get_preview_cache

        get_preview_cache().clear()
        origen = tmp_path / "mut.png"
        Image.new("RGB", (800, 600), color=(255, 0, 0)).save(origen)
        os.utime(origen, (1_000_000, 1_000_000))

        r1 = convertir_a_preview(origen, "PNG")
        r2 = convertir_a_preview(origen, "PNG")
        assert r2["preview"] == r1["preview"]
        assert r2["preview_path"] == r1["preview_path"]

        Image.new("RGB", (800, 600), color=(0, 0, 255)).save(origen)
        os.utime(origen, (2_000_000, 2_000_000))
        r3 = convertir_a_preview(origen, "PNG")
        assert r3["preview"] != r1["preview"], "preview stale tras editar imagen"

    def test_preview_cache_normaliza_formato_y_detecta_reemplazo_rapido(self, tmp_path) -> None:
        from backend.core.preview_cache import get_preview_cache

        get_preview_cache().clear()
        origen = tmp_path / "quick-replace.png"
        fixed_ns = 2_000_000_000_000_000_000

        Image.new("RGB", (80, 60), color=(255, 0, 0)).save(origen)
        os.utime(origen, ns=(fixed_ns, fixed_ns))
        first = convertir_a_preview(origen, "PNG")
        alias = convertir_a_preview(origen, "png")
        assert alias["preview"] == first["preview"]

        Image.new("RGB", (80, 60), color=(0, 0, 255)).save(origen)
        os.utime(origen, ns=(fixed_ns, fixed_ns))
        replaced = convertir_a_preview(origen, "PNG")
        assert replaced["preview"] != first["preview"], "quick replacement reused stale preview"
