"""Impresión de PDFs en la cola de Windows, sin depender de un visor externo."""

from __future__ import annotations

import ctypes
import sys
from collections.abc import Callable
from ctypes import wintypes
from pathlib import Path
from typing import Any

import pymupdf as fitz
from PIL import Image


class _PrinterInfo(ctypes.Structure):
    _fields_ = [("name", wintypes.LPWSTR), ("server", wintypes.LPWSTR), ("attributes", wintypes.DWORD)]


class _DocInfo(ctypes.Structure):
    _fields_ = [("size", ctypes.c_int), ("name", wintypes.LPCWSTR), ("output", wintypes.LPCWSTR),
                ("datatype", wintypes.LPCWSTR), ("flags", wintypes.DWORD)]


class _BitmapInfo(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("width", wintypes.LONG), ("height", wintypes.LONG),
                ("planes", wintypes.WORD), ("bits", wintypes.WORD), ("compression", wintypes.DWORD),
                ("image_size", wintypes.DWORD), ("x_resolution", wintypes.LONG), ("y_resolution", wintypes.LONG),
                ("colors", wintypes.DWORD), ("important_colors", wintypes.DWORD)]


def _spool() -> Any:
    if sys.platform != "win32":
        return None
    spool = ctypes.WinDLL("winspool.drv", use_last_error=True)
    spool.EnumPrintersW.argtypes = [wintypes.DWORD, wintypes.LPWSTR, wintypes.DWORD, ctypes.c_void_p,
                                   wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(wintypes.DWORD)]
    spool.EnumPrintersW.restype = wintypes.BOOL
    spool.GetDefaultPrinterW.argtypes = [wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    spool.GetDefaultPrinterW.restype = wintypes.BOOL
    return spool


def list_printers() -> list[dict[str, str | bool]]:
    if sys.platform != "win32":
        return []
    spool = _spool()
    needed, count = wintypes.DWORD(), wintypes.DWORD()
    found = spool.EnumPrintersW(6, None, 4, None, 0, ctypes.byref(needed), ctypes.byref(count))
    if not needed.value:
        if not found and ctypes.get_last_error() not in (0, 122):
            raise ctypes.WinError()
        return []
    buffer = ctypes.create_string_buffer(needed.value)
    if not spool.EnumPrintersW(6, None, 4, buffer, len(buffer), ctypes.byref(needed), ctypes.byref(count)):
        raise ctypes.WinError()
    size = wintypes.DWORD()
    spool.GetDefaultPrinterW(None, ctypes.byref(size))
    default = ""
    if size.value:
        name = ctypes.create_unicode_buffer(size.value)
        if spool.GetDefaultPrinterW(name, ctypes.byref(size)):
            default = name.value
    printers = ctypes.cast(buffer, ctypes.POINTER(_PrinterInfo))
    return [{"name": str(printers[i].name), "default": printers[i].name == default} for i in range(count.value)]


def _gdi() -> Any:
    if sys.platform != "win32":
        return None
    gdi = ctypes.WinDLL("gdi32", use_last_error=True)
    gdi.CreateDCW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.c_void_p]
    gdi.CreateDCW.restype = wintypes.HDC
    gdi.StartDocW.argtypes = [wintypes.HDC, ctypes.POINTER(_DocInfo)]
    gdi.StartDocW.restype = ctypes.c_int
    for name in ("StartPage", "EndPage", "EndDoc", "AbortDoc", "DeleteDC"):
        getattr(gdi, name).argtypes = [wintypes.HDC]
        getattr(gdi, name).restype = ctypes.c_int
    gdi.GetDeviceCaps.argtypes = [wintypes.HDC, ctypes.c_int]
    gdi.GetDeviceCaps.restype = ctypes.c_int
    gdi.SetStretchBltMode.argtypes = [wintypes.HDC, ctypes.c_int]
    gdi.SetStretchBltMode.restype = ctypes.c_int
    gdi.StretchDIBits.argtypes = [wintypes.HDC, *([ctypes.c_int] * 8), ctypes.c_void_p,
                                 ctypes.POINTER(_BitmapInfo), wintypes.UINT, wintypes.DWORD]
    gdi.StretchDIBits.restype = ctypes.c_int
    return gdi


def print_pdf(pdf_path: str, printer_name: str, copies: int = 1,
              cancelled: Callable[[], bool] | None = None) -> dict[str, str | int | bool]:
    if sys.platform != "win32":
        raise ValueError("La impresión de PDFs requiere Windows")
    if not printer_name or printer_name not in {p["name"] for p in list_printers()}:
        raise ValueError("Selecciona una impresora instalada en Windows")
    if not isinstance(copies, int) or isinstance(copies, bool) or not 1 <= copies <= 99:
        raise ValueError("Las copias deben ser un entero entre 1 y 99")
    source = Path(pdf_path)
    if not source.is_file() or source.is_symlink() or any(p.is_symlink() for p in source.parents):
        raise ValueError("Selecciona un PDF disponible sin enlaces simbólicos")
    if source.stat().st_size > 100 * 1024 * 1024:
        raise ValueError("El PDF excede el máximo de 100 MiB")
    with fitz.open(source) as document:
        if not document.is_pdf or document.needs_pass or not 1 <= len(document) <= 200:
            raise ValueError("La impresión requiere un PDF sin contraseña de 1 a 200 páginas")
        gdi = _gdi()
        dc = gdi.CreateDCW("WINSPOOL", printer_name, None, None)
        if not dc:
            raise ValueError("No se pudo abrir la impresora seleccionada")
        started = False
        try:
            width, height = gdi.GetDeviceCaps(dc, 8), gdi.GetDeviceCaps(dc, 10)
            if width <= 0 or height <= 0:
                raise ValueError("La impresora no informó un área imprimible válida")
            if cancelled and cancelled():
                raise ValueError("Impresión cancelada")
            info = _DocInfo(ctypes.sizeof(_DocInfo), source.name, None, None, 0)
            job_id = gdi.StartDocW(dc, ctypes.byref(info))
            if job_id <= 0:
                raise ValueError("No se pudo iniciar el trabajo de impresión")
            started = True
            gdi.SetStretchBltMode(dc, 4)
            for _ in range(copies):
                for page in document:
                    if cancelled and cancelled():
                        raise ValueError("Impresión cancelada")
                    rotate = (page.rect.width > page.rect.height) != (width > height)
                    matrix = fitz.Matrix(150 / 72, 150 / 72).prerotate(90 if rotate else 0)
                    if page.rect.width * page.rect.height * (150 / 72) ** 2 > 32_000_000:
                        raise ValueError("La página excede el tamaño máximo de impresión")
                    pix = page.get_pixmap(matrix=matrix, colorspace=fitz.csRGB, alpha=False)
                    bitmap = Image.frombytes("RGB", (pix.width, pix.height), pix.samples).tobytes("raw", "BGRX")
                    header = _BitmapInfo(ctypes.sizeof(_BitmapInfo), pix.width, -pix.height, 1, 32, 0, len(bitmap), 0, 0, 0, 0)
                    scale = min(width / pix.width, height / pix.height)
                    target_w, target_h = max(1, round(pix.width * scale)), max(1, round(pix.height * scale))
                    if gdi.StartPage(dc) <= 0:
                        raise ValueError("No se pudo iniciar la página de impresión")
                    drawn = gdi.StretchDIBits(dc, (width - target_w) // 2, (height - target_h) // 2, target_w, target_h,
                                            0, 0, pix.width, pix.height, bitmap, ctypes.byref(header), 0, 0x00CC0020)
                    if drawn in (0, -1) or gdi.EndPage(dc) <= 0:
                        raise ValueError("No se pudo enviar la página a la impresora")
            if gdi.EndDoc(dc) <= 0:
                raise ValueError("No se pudo finalizar el envío a la cola de impresión")
            started = False
            return {"queued": True, "job_id": job_id, "printer_name": printer_name, "copies": copies,
                    "pages": len(document), "filename": source.name}
        finally:
            if started:
                gdi.AbortDoc(dc)
            gdi.DeleteDC(dc)
