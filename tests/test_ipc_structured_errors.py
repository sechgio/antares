"""Pruebas unitarias para errores estructurados de IPC."""

from backend.core.exceptions import (
    AntaresBaseException,
    InternalError,
    InvalidRequestError,
    MethodNotFoundError,
    NotFoundError,
    ResourceLockedError,
    ValidationError,
)
from backend.ipc_protocol import send_response


def test_antares_base_exception_serialization() -> None:
    """Verifica que AntaresBaseException serialice a dict con code, message y category."""
    exc = AntaresBaseException("Mensaje de prueba", code=-32000, category="CUSTOM_ERROR", details={"file": "test.txt"})
    serialized = exc.to_dict()

    assert serialized["code"] == -32000
    assert serialized["message"] == "Mensaje de prueba"
    assert serialized["category"] == "CUSTOM_ERROR"
    assert serialized["details"] == {"file": "test.txt"}


def test_specific_exception_subclasses() -> None:
    """Verifica que las subclases específicas contengan los códigos JSON-RPC estándar."""
    val_err = ValidationError("Parámetro inválido", details={"param": "output_path"})
    assert val_err.code == -32602
    assert val_err.category == "VALIDATION_ERROR"

    lock_err = ResourceLockedError("Archivo bloqueado", details={"path": "doc.xlsx"})
    assert lock_err.code == -32002
    assert lock_err.category == "RESOURCE_LOCKED"

    internal_err = InternalError("Error interno en conversor")
    assert internal_err.code == -32603
    assert internal_err.category == "INTERNAL_ERROR"

    not_found_err = NotFoundError("Plantilla no encontrada")
    assert not_found_err.code == -32004
    assert not_found_err.category == "NOT_FOUND"

    invalid_req = InvalidRequestError("Método inválido")
    assert invalid_req.code == -32600
    assert invalid_req.category == "INVALID_REQUEST"

    method_missing = MethodNotFoundError("Método desconocido")
    assert method_missing.code == -32601
    assert method_missing.category == "METHOD_NOT_FOUND"


def test_send_response_with_structured_exception(capsys) -> None:
    """Verifica que send_response formatee correctamente la respuesta JSON-RPC con excepción estructurada."""
    err = ValidationError("Ruta no permitida", details={"key": "output"})
    send_response(None, "req-101", error=err)

    captured = capsys.readouterr()
    assert '"jsonrpc": "2.0"' in captured.out
    assert '"id": "req-101"' in captured.out
    assert '"code": -32602' in captured.out
    assert '"category": "VALIDATION_ERROR"' in captured.out
    assert '"Ruta no permitida"' in captured.out
