from typing import Any, Literal

ErrorCategory = Literal[
    "INTERNAL_ERROR",
    "INVALID_REQUEST",
    "METHOD_NOT_FOUND",
    "VALIDATION_ERROR",
    "RESOURCE_LOCKED",
    "NOT_FOUND",
    "MEMORY_PRESSURE",
    "TIMEOUT",
    "AUTHENTICATION_ERROR",
    "RENDERING_ERROR",
]


class AntaresError(Exception):
    pass


class DatabaseError(AntaresError):
    pass


class AntaresBaseException(AntaresError):

    def __init__(
        self,
        message: str,
        *,
        code: int = -32000,
        category: ErrorCategory = "INTERNAL_ERROR",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.category = category
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "category": self.category,
        }
        if self.details:
            payload["details"] = self.details
        return payload


class InvalidRequestError(AntaresBaseException):

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message, code=-32600, category="INVALID_REQUEST", details=details)


class MethodNotFoundError(AntaresBaseException):

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message, code=-32601, category="METHOD_NOT_FOUND", details=details)


class ValidationError(AntaresBaseException):

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message, code=-32602, category="VALIDATION_ERROR", details=details)


class ResourceLockedError(AntaresBaseException):

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message, code=-32002, category="RESOURCE_LOCKED", details=details)


class InternalError(AntaresBaseException):

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message, code=-32603, category="INTERNAL_ERROR", details=details)


class NotFoundError(AntaresBaseException):

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message, code=-32004, category="NOT_FOUND", details=details)


class MemoryPressureError(AntaresBaseException):

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message, code=-32003, category="MEMORY_PRESSURE", details=details)
