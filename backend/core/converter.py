"""Módulo de conversión de imágenes usando Pillow."""

from __future__ import annotations

import base64
import io
from collections.abc import Callable
from pathlib import Path

from PIL import Image

from backend.core.format_registry import get_registry

# Initialize default formats in the global registry
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

# Backward compatibility alias
FORMATOS_SOPORTADOS = _registry

# Mapeo de nombres internos a formatos Pillow
PIL_FORMAT_MAP: dict[str, str] = {
    "JPG": "JPEG",
}

ProgresoCallback = Callable[[int, int, Path], None]


def obtener_formatos() -> list[str]:
    """Retorna lista de formatos soportados."""
    return get_registry().list_formats()


def es_video(ruta: str | Path) -> bool:
    """Detecta si un archivo es un video basado en su extensión."""
    ruta = Path(ruta)
    ext = ruta.suffix.lower()
    return ext in VIDEO_FORMATS.values()


def obtener_formatos_video() -> list[str]:
    """Retorna lista de formatos de video soportados para renombrado."""
    return list(VIDEO_FORMATS.keys())


def copiar_video(
    ruta_origen: str | Path,
    ruta_destino: str | Path,
) -> Path:
    """Copia un archivo de video sin conversión (solo renombrado).

    Args:
        ruta_origen: Ruta del video origen.
        ruta_destino: Ruta de salida.

    Returns:
        Path del archivo generado.

    Raises:
        FileNotFoundError: Si el video origen no existe.
    """
    import shutil

    ruta_origen = Path(ruta_origen)
    ruta_destino = Path(ruta_destino)

    if not ruta_origen.exists():
        raise FileNotFoundError(f"No se encontró el video: {ruta_origen}")

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
        raise FileNotFoundError(f"No se encontró la imagen: {ruta_origen}")

    formato = formato_salida.upper()
    if formato not in FORMATOS_SOPORTADOS:
        raise ValueError(f"Formato no soportado: {formato_salida}")

    calidad = max(1, min(100, int(calidad)))

    with Image.open(ruta_origen) as source_img:
        info = FORMATOS_SOPORTADOS[formato]
        img: Image.Image = _ensure_mode(source_img, info["modes"])

        if resize and isinstance(resize, (tuple, list)) and len(resize) == 2:
            img = img.resize((int(resize[0]), int(resize[1])), getattr(Image, "Resampling", Image).LANCZOS)

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


def procesar_lote(
    origenes: list[str | Path],
    carpeta_destino: str | Path,
    formato: str,
    calidad: int = 95,
    resize: tuple[int, int] | list[int] | None = None,
    keep_exif: bool = False,
    progreso_callback: ProgresoCallback | None = None,
) -> list[Path | str]:
    """Procesa un lote de imágenes.

    Args:
        origenes: Lista de rutas de imágenes.
        carpeta_destino: Carpeta de salida.
        formato: Formato destino.
        calidad: Calidad de salida.
        resize: Tupla (ancho, alto) opcional.
        keep_exif: Preservar metadatos EXIF.
        progreso_callback: Función(i, total, ruta) opcional para reportar progreso.

    Returns:
        Lista de Paths generados o strings de error 'ERROR: ...'.
    """
    carpeta_destino = Path(carpeta_destino)
    carpeta_destino.mkdir(parents=True, exist_ok=True)
    formato_upper = formato.upper()
    if formato_upper not in FORMATOS_SOPORTADOS:
        raise ValueError(f"Formato no soportado: {formato}")
    ext = FORMATOS_SOPORTADOS[formato_upper]["ext"]
    resultados: list[Path | str] = []

    for i, ruta in enumerate(origenes, 1):
        ruta = Path(ruta)
        nombre_salida = ruta.stem + ext
        ruta_salida = carpeta_destino / nombre_salida
        try:
            convertir_imagen(ruta, ruta_salida, formato, calidad, resize, keep_exif)
            resultados.append(ruta_salida)
        except Exception as e:
            resultados.append(f"ERROR: {ruta.name} -> {e}")

        if progreso_callback:
            progreso_callback(i, len(origenes), ruta)

    return resultados


def convertir_a_preview(
    ruta_origen: str | Path,
    formato_salida: str = "PNG",
    calidad: int = 85,
    resize: tuple[int, int] | list[int] | None = None,
) -> dict[str, str]:
    """Genera una vista previa en el formato seleccionado y retorna metadata.

    Args:
        ruta_origen: Path de la imagen origen.
        formato_salida: Formato destino para la preview (JPEG, PNG, WEBP, etc.).
        calidad: Calidad 1-100 para formatos con pérdida.
        resize: Tupla (ancho, alto) opcional.

    Returns:
        Diccionario con:
            - preview: Base64 data URI string
            - width: Ancho original
            - height: Alto original
            - orig_size_kb: Tamaño original en KB
    """
    ruta_origen = Path(ruta_origen)
    if not ruta_origen.exists():
        raise FileNotFoundError(f"No se encontró: {ruta_origen}")

    formato = formato_salida.upper()
    pil_formato = PIL_FORMAT_MAP.get(formato, formato)

    with Image.open(ruta_origen) as source_img:
        orig_w, orig_h = source_img.size
        orig_size_kb = round(ruta_origen.stat().st_size / 1024, 1)

        # Max preview size 400px on longest side
        max_size = 400
        ratio = min(max_size / max(source_img.size), 1.0)
        preview_size = (int(source_img.width * ratio), int(source_img.height * ratio))
        img: Image.Image = source_img.resize(preview_size, getattr(Image, "Resampling", Image).LANCZOS)

        # Aplicar modo y calidad según formato
        if formato in FORMATOS_SOPORTADOS:
            info = FORMATOS_SOPORTADOS[formato]
            img = _ensure_mode(img, info["modes"])
        elif img.mode != "RGB":
            img = img.convert("RGB")

        # Aplicar resize de preview si se proporciona
        if resize and isinstance(resize, (tuple, list)) and len(resize) == 2:
            img = img.resize((int(resize[0]), int(resize[1])), getattr(Image, "Resampling", Image).LANCZOS)

        buffer = io.BytesIO()
        save_kwargs = _build_save_kwargs(formato, calidad, False, img)
        img.save(buffer, format=pil_formato, **save_kwargs)
        buffer.seek(0)
        data = base64.b64encode(buffer.read()).decode("ascii")

    mime = "image/png" if pil_formato == "PNG" else f"image/{pil_formato.lower()}"
    return {
        "preview": f"data:{mime};base64,{data}",
        "width": str(orig_w),
        "height": str(orig_h),
        "orig_size_kb": str(orig_size_kb),
    }
