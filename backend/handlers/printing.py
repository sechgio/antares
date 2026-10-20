from __future__ import annotations

from backend.core.integrations.types import JsonObject
from backend.handlers.common import with_locale


@with_locale
def _printers_list(params: JsonObject) -> JsonObject:
    from backend.core.printing import list_printers

    return {"printers": list_printers()}


@with_locale
def _print_pdf(params: JsonObject) -> JsonObject:
    from backend.core.printing import print_pdf

    if not params.get("pdf_path") or not params.get("printer_name"):
        return {"ready": False, "reason": "Selecciona el PDF y la impresora"}
    return print_pdf(
        params["pdf_path"],
        params["printer_name"],
        params.get("copies", 1),
        params.get("_cancelled"),
        pages=params.get("pages"),
        duplex=params.get("duplex"),
        quality=params.get("quality"),
    )


HANDLERS = {
    "printers_list": _printers_list,
    "print_pdf": _print_pdf,
}
