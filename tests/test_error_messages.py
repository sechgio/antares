
from __future__ import annotations

from backend.core.exceptions import AntaresBaseException, ValidationError
from backend.main import _user_error_message


def test_user_error_message_typed_exception():
    exc = _user_error_message(ValidationError("x"))
    assert str(exc) == "x"
    assert exc.category == "VALIDATION_ERROR"


def test_user_error_message_value_error_passthrough():
    exc = _user_error_message(ValueError("boom"))
    assert str(exc) == "boom"
    assert exc.category == "VALIDATION_ERROR"


def test_user_error_message_file_not_found_hides_path():
    exc = _user_error_message(FileNotFoundError(r"C:\Users\secreto\fotos\IMG_001.jpg"))
    assert str(exc) == "Archivo no encontrado"
    assert exc.category == "NOT_FOUND"
    assert "secreto" not in str(exc)
    assert "IMG_001" not in str(exc)


def test_user_error_message_import_error_passthrough():
    exc = _user_error_message(ImportError("falta weasyprint"))
    assert str(exc) == "falta weasyprint"
    assert exc.category == "INTERNAL_ERROR"


def test_user_error_message_hides_unexpected_internals():
    exc = _user_error_message(RuntimeError(r"secret path C:\x"))
    assert isinstance(exc, AntaresBaseException)
    assert str(exc) == "Error interno del servidor"
    assert exc.category == "INTERNAL_ERROR"


def test_user_error_message_keeps_tool_domain_errors():
    """Evidencia Volanteo y Aviso de Corte escriben sus mensajes en español en
    errores de dominio; aplanarlos a "Error interno del servidor" deja al
    usuario sin la causa (documento vacío, Excel inválido, regla inválida)."""
    from backend.core.evidencia_volanteo.errors import EvidenciaVolanteoError, RenderingError
    from backend.core.panel_aviso_corte.errors import (
        InvalidExcelError,
        InvalidMatchRuleError,
        InvalidPanelError,
        PanelAvisoCorteError,
    )

    cases = [
        (RenderingError("No hay páginas para exportar"), "No hay páginas para exportar"),
        (EvidenciaVolanteoError("Evidencia inválida"), "Evidencia inválida"),
        (InvalidExcelError("El Excel no tiene filas"), "El Excel no tiene filas"),
        (InvalidMatchRuleError("Regla de emparejamiento inválida"), "Regla de emparejamiento inválida"),
        (InvalidPanelError("Panel no soportado"), "Panel no soportado"),
        (PanelAvisoCorteError("Error del aviso de corte"), "Error del aviso de corte"),
    ]
    for exc, message in cases:
        mapped = _user_error_message(exc)
        assert str(mapped) == message
        assert mapped.category == "VALIDATION_ERROR", type(exc).__name__
