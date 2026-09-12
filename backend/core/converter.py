
from __future__ import annotations

import contextlib
import os
import shutil
import tempfile
from pathlib import Path

from PIL import Image, ImageOps

from backend.core.format_registry import get_registry
from backend.core.image_limits import apply_default_pixels_limit

apply_default_pixels_limit()

_registry = get_registry()
_registry.add_format("JPEG", ".jpg", ("RGB", "L", "CMYK"))
_registry.add_format("JPG", ".jpg", ("RGB", "L", "CMYK"))
_registry.add_format("PNG", ".png", ("RGB", "RGBA", "L", "LA", "P"))
_registry.add_format("WEBP", ".webp", ("RGB", "RGBA", "L"))
_registry.add_format("BMP", ".bmp", ("RGB", "RGBA", "L"))
_registry.add_format("TIFF", ".tiff", ("RGB", "RGBA", "L", "CMYK"))
_registry.add_format("GIF", ".gif", ("P", "RGB", "L"))
_registry.add_format("ICO", ".ico", ("RGB", "RGBA", "L"))
_registry.add_format("PDF", ".pdf", ("RGB", "RGBA", "L", "P"))

VIDEO_FORMATS = {
    "MP4": ".mp4",
    "AVI": ".avi",
    "MOV": ".mov",
    "MKV": ".mkv",
    "WMV": ".wmv",
    "FLV": ".flv",
    "WEBM": ".webm",
    "M4V": ".m4v",
    "3GP": ".3gp",
    "MPG": ".mpg",
    "MPEG": ".mpeg",
}

FORMATOS_SOPORTADOS = _registry

PIL_FORMAT_MAP: dict[str, str] = {
    "JPG": "JPEG",
}

_EXIF_ORIENTATION = 0x0112
_TRANSPOSE_ORIENTATIONS = frozenset({2, 3, 4, 5, 6, 7, 8})


def _bake_orientation(source_img: Image.Image) -> Image.Image:
    try:
        orientation = source_img.getexif().get(_EXIF_ORIENTATION, 1)
    except Exception:
        orientation = 1
    if orientation not in _TRANSPOSE_ORIENTATIONS:
        return source_img
    return ImageOps.exif_transpose(source_img) or source_img

_LANCZOS = getattr(Image, "Resampling", Image).LANCZOS
_BILINEAR = getattr(Image, "Resampling", Image).BILINEAR
_BOX = getattr(Image, "Resampling", Image).BOX

def es_video(ruta: str | Path) -> bool:
    ruta = Path(ruta)
    ext = ruta.suffix.lower()
    return ext in VIDEO_FORMATS.values()


def copiar_archivo(
    ruta_origen: str | Path,
    ruta_destino: str | Path,
    *,
    ensure_dir: bool = True,
) -> Path:
    ruta_origen = Path(ruta_origen)
    ruta_destino = Path(ruta_destino)

    if ensure_dir:
        ruta_destino.parent.mkdir(parents=True, exist_ok=True)
    if ruta_destino.is_symlink() or ruta_destino.parent.is_symlink():
        raise ValueError("symlink no permitido en ruta de destino")

    fd, tmp_name = tempfile.mkstemp(
        dir=str(ruta_destino.parent), prefix=f".{ruta_destino.stem}-", suffix=".antares-tmp"
    )
    os.close(fd)
    tmp_destino = Path(tmp_name)
    try:
        shutil.copy2(ruta_origen, tmp_destino)
        os.replace(tmp_destino, ruta_destino)
    except FileNotFoundError as exc:
        with contextlib.suppress(OSError):
            tmp_destino.unlink(missing_ok=True)
        msg = f"No se encontró el archivo: {ruta_origen}"
        raise FileNotFoundError(msg) from exc
    except Exception:
        with contextlib.suppress(OSError):
            tmp_destino.unlink(missing_ok=True)
        raise

    return ruta_destino


def _ensure_mode(img: Image.Image, target_modes: tuple[str, ...]) -> Image.Image:
    if img.mode in target_modes:
        return img
    if img.mode in ("RGBA", "LA", "P", "1") and "RGBA" not in target_modes:
        if img.mode == "1":
            return img.convert("RGB")
        fondo = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        if img.mode in ("RGBA", "LA"):
            fondo.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
            return fondo
        return img.convert("RGB")
    target_mode = "RGB" if "RGB" in target_modes else target_modes[0]
    return img.convert(target_mode)


def _build_save_kwargs(
    formato: str,
    calidad: int,
    keep_exif: bool,
    img: Image.Image,
    optimize: bool | None = None,
) -> dict:
    kwargs: dict = {}
    upper_fmt = formato.upper()
    if upper_fmt in ("JPEG", "JPG", "WEBP"):
        kwargs["quality"] = max(1, min(100, int(calidad)))
    if upper_fmt in ("JPEG", "JPG") and optimize is True:
        kwargs["optimize"] = True
    if keep_exif and "exif" in img.info:
        kwargs["exif"] = img.info["exif"]
    return kwargs


def _can_fast_copy(
    source_img: Image.Image,
    formato: str,
    calidad: int,
    resize: tuple[int, int] | list[int] | None,
    keep_exif: bool,
    optimize: bool,
) -> bool:
    if resize is not None or optimize:
        return False
    if calidad < 95:
        return False
    src_fmt = (source_img.format or "").upper()
    dst_fmt = PIL_FORMAT_MAP.get(formato, formato).upper()
    if src_fmt != dst_fmt or src_fmt == "PDF":
        return False
    if getattr(source_img, "n_frames", 1) != 1:
        return False
    info = _registry[formato]
    if source_img.mode not in info["modes"]:
        return False
    try:
        exif = source_img.getexif()
    except Exception:
        exif = None
    orientation = exif.get(_EXIF_ORIENTATION, 1) if exif is not None else 1
    if orientation in _TRANSPOSE_ORIENTATIONS:
        return False
    if not keep_exif:
        has_exif = bool(exif) or bool(source_img.info.get("exif"))
        if has_exif:
            return False
    return True


def convertir_imagen(
    ruta_origen: str | Path,
    ruta_destino: str | Path,
    formato_salida: str,
    calidad: int = 95,
    resize: tuple[int, int] | list[int] | None = None,
    keep_exif: bool = False,
    *,
    optimize: bool = False,
    ensure_dir: bool = True,
) -> Path:
    ruta_origen = Path(ruta_origen)
    ruta_destino = Path(ruta_destino)

    formato = formato_salida.upper()
    if formato not in _registry:
        msg = f"Formato no soportado: {formato_salida}"
        raise ValueError(msg)

    calidad = max(1, min(100, int(calidad)))

    try:
        source_img_ctx = Image.open(ruta_origen)
    except FileNotFoundError as exc:
        msg = f"No se encontró la imagen: {ruta_origen}"
        raise FileNotFoundError(msg) from exc

    with source_img_ctx as source_img:
        if source_img.width == 0 or source_img.height == 0:
            msg = f"Imagen con dimensiones inválidas ({source_img.width}x{source_img.height}): {ruta_origen}"
            raise ValueError(msg)

        if _can_fast_copy(source_img, formato, calidad, resize, keep_exif, optimize):
            return copiar_archivo(ruta_origen, ruta_destino, ensure_dir=ensure_dir)

        working: Image.Image = _bake_orientation(source_img)

        info = _registry[formato]
        img: Image.Image = _ensure_mode(working, info["modes"])
        if resize and isinstance(resize, (tuple, list)) and len(resize) == 2:
            rw, rh = int(resize[0]), int(resize[1])
            if rw <= 0 or rh <= 0:
                msg = f"Dimensiones de resize inválidas ({rw}x{rh})"
                raise ValueError(msg)
            try:
                scale = max(img.width / rw, img.height / rh) if rw and rh else 1.0
            except ZeroDivisionError:
                scale = 1.0
            if scale >= 4.0:
                resample = _BOX
            elif scale >= 3.0:
                resample = _BILINEAR
            else:
                resample = _LANCZOS
            img = img.resize((rw, rh), resample)

        if ensure_dir:
            ruta_destino.parent.mkdir(parents=True, exist_ok=True)
        if ruta_destino.is_symlink() or ruta_destino.parent.is_symlink():
            raise ValueError("symlink no permitido en ruta de salida")
        save_kwargs = _build_save_kwargs(formato, calidad, keep_exif, img, optimize=optimize)
        fd, tmp_name = tempfile.mkstemp(
            dir=str(ruta_destino.parent), prefix=f".{ruta_destino.stem}-", suffix=".antares-tmp"
        )
        os.close(fd)
        tmp_destino = Path(tmp_name)

        try:
            encoder = info.get("encoder")
            if encoder is not None:
                save_kwargs.setdefault("quality", calidad)
                encoder(img, tmp_destino, formato, save_kwargs)
            else:
                pil_formato = PIL_FORMAT_MAP.get(formato, formato)
                img.save(tmp_destino, format=pil_formato, **save_kwargs)
            os.replace(tmp_destino, ruta_destino)
        except Exception:
            with contextlib.suppress(OSError):
                tmp_destino.unlink(missing_ok=True)
            raise

    return ruta_destino
