"""User-safe error message shaping for IPC dispatch."""

from __future__ import annotations

from backend.core.exceptions import ValidationError
from backend.main import _user_error_message


def test_user_error_message_typed_exception():
    assert str(_user_error_message(ValidationError("x"))) == "x"


def test_user_error_message_value_error_passthrough():
    assert _user_error_message(ValueError("boom")) == "boom"


def test_user_error_message_file_not_found_hides_path():
    """L1: FileNotFoundError no debe exponer rutas absolutas al renderer."""
    msg = _user_error_message(FileNotFoundError(r"C:\Users\secreto\fotos\IMG_001.jpg"))
    assert msg == "Archivo no encontrado"
    assert "secreto" not in str(msg)
    assert "IMG_001" not in str(msg)


def test_user_error_message_hides_unexpected_internals():
    assert _user_error_message(RuntimeError(r"secret path C:\x")) == "Error interno del servidor"
