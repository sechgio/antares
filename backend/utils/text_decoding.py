from __future__ import annotations

_CSV_ENCODINGS = ("utf-8-sig", "utf-8", "cp1252", "latin-1")


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
