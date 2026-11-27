from __future__ import annotations

import codecs
from pathlib import Path

_CSV_ENCODINGS = ("utf-8-sig", "utf-8", "cp1252", "latin-1")
_CSV_SNIFF_BYTES = 64 * 1024


def decode_csv_bytes(content: bytes) -> str:
    """Decodifica bytes de un CSV probando las codificaciones habituales de
    Excel/Windows; `ValueError` solo salta ante una lista vacía."""
    for encoding in _CSV_ENCODINGS:
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    msg = "No se pudo decodificar el archivo CSV"
    raise ValueError(msg)


def _head_decodes(chunk: bytes, encoding: str) -> bool:
    try:
        codecs.getincrementaldecoder(encoding)().decode(chunk, final=False)
    except UnicodeDecodeError:
        return False
    return True


def sniff_csv(path: Path) -> tuple[str, str]:
    """Excel en español exporta con ';' y en ANSI de Windows, y el encabezado
    suele ser ASCII aunque el cuerpo traiga tildes: la codificación se decide
    sobre un muestreo, no sobre la primera línea, y sin leer el archivo entero
    para conservar el streaming. La coma mantiene la precedencia para no cambiar
    los CSV que ya se leían bien."""
    with path.open("rb") as fh:
        head = fh.read(_CSV_SNIFF_BYTES)
    encoding = next(candidate for candidate in _CSV_ENCODINGS if _head_decodes(head, candidate))
    first_line = head.partition(b"\n")[0]
    delimiter = next((d for d in (",", ";", "\t") if d.encode() in first_line), ",")
    return encoding, delimiter
