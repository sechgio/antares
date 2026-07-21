"""Módulo de conversión de imágenes usando Pillow."""

from __future__ import annotations

import base64
import io
import shutil
from pathlib import Path
from typing import cast

from PIL import Image, ImageOps

from backend.core.format_registry import get_registry

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

# Video formats (for rename-only support)
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

# Backward compatibility alias — _registry manages format registration;
# external code should modify formats via FormatRegistry.add_format() only.
FORMATOS_SOPORTADOS = _registry

PIL_FORMAT_MAP: dict[str, str] = {
    "JPG": "JPEG",
}

_LANCZOS = getattr(Image, "Resampling", Image).LANCZOS


def es_video(ruta: str | Path) -> bool:
    """Detecta si un archivo es un video basado en su extensión."""
    ruta = Path(ruta)
    ext = ruta.suffix.lower()
    return ext in VIDEO_FORMATS.values()


def copiar_archivo(
    ruta_origen: str | Path,
    ruta_destino: str | Path,
) -> Path:
    """Copia un archivo sin conversión, preservando metadatos."""
    ruta_origen = Path(ruta_origen)
    ruta_destino = Path(ruta_destino)

    if not ruta_origen.exists():
        msg = f"No se encontró el archivo: {ruta_origen}"
        raise FileNotFoundError(msg)

    ruta_destino.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ruta_origen, ruta_destino)

    return ruta_destino


def _ensure_mode(img: Image.Image, target_modes: tuple[str, ...]) -> Image.Image:
    """Convierte la imagen al modo compatible con el formato destino."""
    if img.mode in target_modes:
        return img
    # Manejar transparencia -> fondo blanco
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


def _build_save_kwargs(formato: str, calidad: int, keep_exif: bool, img: Image.Image) -> dict:
    """Construye kwargs para img.save según el formato."""
    kwargs: dict = {}
    upper_fmt = formato.upper()
    if upper_fmt in ("JPEG", "JPG", "WEBP"):
        kwargs["quality"] = max(1, min(100, int(calidad)))
    if upper_fmt in ("JPEG", "JPG") and calidad >= 90:
        kwargs["optimize"] = True
    if keep_exif and "exif" in img.info:
        kwargs["exif"] = img.info["exif"]
    return kwargs


def convertir_imagen(
    ruta_origen: str | Path,
    ruta_destino: str | Path,
    formato_salida: str,
    calidad: int = 95,
    resize: tuple[int, int] | list[int] | None = None,
    keep_exif: bool = False,
) -> Path:
    """Convierte una imagen a otro formato.

    Args:
        ruta_origen: Ruta de la imagen origen.
        ruta_destino: Ruta de salida.
        formato_salida: Formato destino, ej: 'JPEG', 'PNG', 'WEBP'.
        calidad: Calidad 1-100 para formatos con compresión (JPEG, WEBP).
        resize: Tupla (ancho, alto) opcional para redimensionar.
        keep_exif: Preservar metadatos EXIF.

    Returns:
        Path del archivo generado.

    Raises:
        FileNotFoundError: Si la imagen origen no existe.
        ValueError: Si el formato no está soportado.
    """
    ruta_origen = Path(ruta_origen)
    ruta_destino = Path(ruta_destino)

    if not ruta_origen.exists():
        msg = f"No se encontró la imagen: {ruta_origen}"
        raise FileNotFoundError(msg)

    formato = formato_salida.upper()
    if formato not in _registry:
        msg = f"Formato no soportado: {formato_salida}"
        raise ValueError(msg)

    calidad = max(1, min(100, int(calidad)))

    with Image.open(ruta_origen) as source_img:
        if source_img.width == 0 or source_img.height == 0:
            msg = f"Imagen con dimensiones inválidas ({source_img.width}x{source_img.height}): {ruta_origen}"
            raise ValueError(msg)

        # Bake EXIF Orientation into pixels so phone photos are upright even
        # when keep_exif is False (default) or the destination strips tags.
        # Use a separate Image variable: exif_transpose returns Image, not ImageFile.
        working: Image.Image = ImageOps.exif_transpose(source_img) or source_img

        info = _registry[formato]
        img: Image.Image = _ensure_mode(working, info["modes"])

        if resize and isinstance(resize, (tuple, list)) and len(resize) == 2:
            rw, rh = int(resize[0]), int(resize[1])
            if rw <= 0 or rh <= 0:
                msg = f"Dimensiones de resize inválidas ({rw}x{rh})"
                raise ValueError(msg)
            img = img.resize((rw, rh), _LANCZOS)

        ruta_destino.parent.mkdir(parents=True, exist_ok=True)
        save_kwargs = _build_save_kwargs(formato, calidad, keep_exif, img)

        encoder = info.get("encoder")
        if encoder is not None:
            save_kwargs.setdefault("quality", calidad)
            encoder(img, ruta_destino, formato, save_kwargs)
            return ruta_destino

        pil_formato = PIL_FORMAT_MAP.get(formato, formato)
        img.save(ruta_destino, format=pil_formato, **save_kwargs)

    return ruta_destino


def convertir_a_preview(
    ruta_origen: str | Path,
    formato_salida: str = "PNG",
    calidad: int = 85,
    resize: tuple[int, int] | list[int] | None = None,
    *,
    as_data_uri: bool = False,
) -> dict[str, str]:
    """Genera una vista previa en el formato seleccionado y retorna metadata.

    By default writes the preview to a disk cache under the user data dir and
    returns a ``file://`` URI (plus ``preview_path``). Pass ``as_data_uri=True``
    to keep the legacy base64 data-URI in ``preview`` (larger IPC payloads).

    Args:
        ruta_origen: Path de la imagen origen.
        formato_salida: Formato destino para la preview (JPEG, PNG, WEBP, etc.).
        calidad: Calidad 1-100 para formatos con pérdida.
        resize: Tupla (ancho, alto) opcional.
        as_data_uri: If True, embed base64 in ``preview`` (legacy).

    Returns:
        Diccionario con:
            - preview: file URI (default) or base64 data URI
            - preview_path: absolute path to cached preview bytes (when not data-URI)
            - width / height / orig_size_kb
    """
    import hashlib

    from backend.utils.paths import user_data_path

    ruta_origen = Path(ruta_origen)
    if not ruta_origen.exists():
        msg = f"No se encontró: {ruta_origen}"
        raise FileNotFoundError(msg)

    # Cache lookup — include st_mtime so an edited/replaced image invalidates
    # the cached preview instead of serving stale bytes for the TTL window.
    from backend.core.preview_cache import get_preview_cache

    stat = ruta_origen.stat()
    resize_key = f"{resize[0]}x{resize[1]}" if resize and len(resize) == 2 else "none"
    mode_key = "data" if as_data_uri else "path"
    cache_key = (
        f"{ruta_origen}:{formato_salida}:{calidad}:{resize_key}:"
        f"{int(stat.st_mtime)}:{mode_key}"
    )
    cache = get_preview_cache()
    cached_result = cache.get(cache_key)
    if cached_result:
        cached = cast(dict[str, str], cached_result)
        # Path mode: ensure file still on disk before serving.
        if not as_data_uri:
            path_str = cached.get("preview_path") or ""
            if path_str and Path(path_str).is_file():
                return cached
        else:
            return cached

    formato = formato_salida.upper()
    pil_formato = PIL_FORMAT_MAP.get(formato, formato)

    with Image.open(ruta_origen) as source_img:
        # Match convertir_imagen: bake Orientation so preview is upright.
        working: Image.Image = ImageOps.exif_transpose(source_img) or source_img

        orig_w, orig_h = working.size
        orig_size_kb = round(stat.st_size / 1024, 1)

        # Preview capped at 400px on longest side. When `resize` is provided it
        # defines the target proportions, but the preview itself stays bounded
        # so IPC payloads remain small — a 4000x3000 resize used to produce a
        # 4000x3000 base64 preview (huge) upscaled from the <=400 intermediate
        # step (blurry). One resize straight to the capped target is sharper.
        max_size = 400
        if resize and isinstance(resize, (tuple, list)) and len(resize) == 2:
            target_w, target_h = int(resize[0]), int(resize[1])
        else:
            target_w, target_h = working.size
        longest = max(target_w, target_h)
        if longest == 0:
            raise ValueError("Imagen con dimensiones 0x0 no puede ser procesada")
        ratio = min(max_size / longest, 1.0)
        preview_size = (max(1, int(target_w * ratio)), max(1, int(target_h * ratio)))
        img: Image.Image = working.resize(preview_size, _LANCZOS)

        if formato in _registry:
            info = _registry[formato]
            img = _ensure_mode(img, info["modes"])
        elif img.mode != "RGB":
            img = img.convert("RGB")

        buffer = io.BytesIO()
        save_kwargs = _build_save_kwargs(formato, calidad, False, img)
        img.save(buffer, format=pil_formato, **save_kwargs)
        raw = buffer.getvalue()

    mime = f"image/{pil_formato.lower()}"
    if as_data_uri:
        data = base64.b64encode(raw).decode("ascii")
        result = {
            "preview": f"data:{mime};base64,{data}",
            "width": str(orig_w),
            "height": str(orig_h),
            "orig_size_kb": str(orig_size_kb),
        }
    else:
        ext = "." + (pil_formato.lower() if pil_formato.lower() != "jpeg" else "jpg")
        cache_dir = user_data_path("preview_cache")
        cache_dir.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha1(cache_key.encode("utf-8", errors="replace")).hexdigest()
        out_path = cache_dir / f"{digest}{ext}"
        # Atomic-ish write: temp then replace
        tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
        tmp_path.write_bytes(raw)
        tmp_path.replace(out_path)
        result = {
            "preview": out_path.resolve().as_uri(),
            "preview_path": str(out_path.resolve()),
            "mime": mime,
            "width": str(orig_w),
            "height": str(orig_h),
            "orig_size_kb": str(orig_size_kb),
        }

    cache.set(cache_key, result)
    return result
