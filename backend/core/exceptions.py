"""Excepciones personalizadas estructuradas del dominio de Antares."""

from typing import Any


class AntaresError(Exception):
    """Base para todas las excepciones de la aplicación."""


class DatabaseError(AntaresError):
    """Error relacionado con operaciones de base de datos."""


class AntaresBaseException(AntaresError):
    """Excepción estructurada IPC para respuestas de error ricas."""

    def __init__(
        self,
        message: str,
        *,
        code: int = -32000,
        category: str = "INTERNAL_ERROR",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.category = category
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        """Convierte la excepción a un diccionario IPC estructurado."""
        payload: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "category": self.category,
        }
        if self.details:
            payload["details"] = self.details
        return payload


class InvalidRequestError(AntaresBaseException):
    """Error de mensaje IPC malformado o método inválido (JSON-RPC -32600)."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message, code=-32600, category="INVALID_REQUEST", details=details)


class MethodNotFoundError(AntaresBaseException):
    """Error cuando el método IPC solicitado no existe (JSON-RPC -32601)."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message, code=-32601, category="METHOD_NOT_FOUND", details=details)


class ValidationError(AntaresBaseException):
    """Error de validación de entrada o parámetros (JSON-RPC -32602)."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message, code=-32602, category="VALIDATION_ERROR", details=details)


class ResourceLockedError(AntaresBaseException):
    """Error cuando un archivo o recurso está bloqueado/en uso (JSON-RPC -32002)."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message, code=-32002, category="RESOURCE_LOCKED", details=details)


class InternalError(AntaresBaseException):
    """Error interno del motor de procesamiento (JSON-RPC -32603)."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message, code=-32603, category="INTERNAL_ERROR", details=details)


class NotFoundError(AntaresBaseException):
    """Error de archivo o entidad no encontrada (JSON-RPC -32004)."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message, code=-32004, category="NOT_FOUND", details=details)


class MemoryPressureError(AntaresBaseException):
    """Rechazo por presión de memoria: reintentable tras ``retry_after_ms``.

    Se dispara cuando ``psutil.virtual_memory().available`` cae bajo el umbral
    (1 GiB por defecto). El frontend debe reintentar tras el delay indicado;
    el backend ya hizo spill a disco para no perder el documento.
    """

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message, code=-32003, category="MEMORY_PRESSURE", details=details)
