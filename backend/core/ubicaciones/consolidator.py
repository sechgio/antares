from __future__ import annotations

import contextlib
import errno
import logging
import os
from typing import Any

from backend.core.exceptions import ResourceLockedError

logger = logging.getLogger(__name__)

_CONSOLIDATED_PDF_NAME = "ubicaciones_consolidado.pdf"
_MAX_CONSOLIDATED_PAGE_BYTES = 64 * 1024 * 1024


def _consolidated_pdf_permission_error(path: str) -> ResourceLockedError:
    return ResourceLockedError(
        f"No se pudo guardar el PDF consolidado en '{path}'. "
        "Cierra el archivo si está abierto en un visor PDF o en el Explorador de Windows e intenta de nuevo.",
    )


def _is_destination_locked(err: OSError) -> bool:
    if getattr(err, "errno", None) in (13, getattr(errno, "EACCES", 13)):
        return True
    winerror = getattr(err, "winerror", None)
    return winerror in (32, 33)


def _write_consolidated_pdf(tmp_path: str, base_path: str) -> str:
    candidates = [base_path] + [
        os.path.join(os.path.dirname(base_path), f"ubicaciones_consolidado_{n}.pdf")
        for n in range(2, 51)
    ]
    last_err: OSError | None = None
    for dest in candidates:
        try:
            os.replace(tmp_path, dest)
            return dest
        except OSError as err:
            last_err = err
            if not _is_destination_locked(err):
                break

    with contextlib.suppress(OSError):
        os.remove(tmp_path)

    if last_err is not None and _is_destination_locked(last_err):
        raise _consolidated_pdf_permission_error(base_path) from last_err
    if last_err is not None:
        raise last_err
    raise _consolidated_pdf_permission_error(base_path)


def create_consolidated_writer() -> Any:
    from pypdf import PdfWriter

    return PdfWriter()


def append_page_to_writer(writer: Any, page_path: str) -> None:
    if os.path.getsize(page_path) > _MAX_CONSOLIDATED_PAGE_BYTES:
        raise OSError("La página temporal excede el límite de 64 MiB.")
    if writer is None:
        raise RuntimeError("El escritor del PDF consolidado no está disponible.")
    if not hasattr(writer, "append"):
        raise TypeError(f"Tipo de escritor de PDF no soportado: {type(writer)}")
    writer.append(page_path)


def close_consolidated_writer(writer: Any) -> None:
    if hasattr(writer, "close"):
        writer.close()


def _save_consolidated_writer(writer: Any, output_dir: str) -> str:
    base_path = os.path.join(output_dir, _CONSOLIDATED_PDF_NAME)
    tmp_path = base_path + ".antares-tmp"
    try:
        with open(tmp_path, "wb") as f:
            writer.write(f)
    except Exception:
        with contextlib.suppress(OSError):
            os.remove(tmp_path)
        raise

    return _write_consolidated_pdf(tmp_path, base_path)


__all__ = [
    "_CONSOLIDATED_PDF_NAME",
    "_MAX_CONSOLIDATED_PAGE_BYTES",
    "_consolidated_pdf_permission_error",
    "_is_destination_locked",
    "_save_consolidated_writer",
    "_write_consolidated_pdf",
    "append_page_to_writer",
    "close_consolidated_writer",
    "create_consolidated_writer",
]
