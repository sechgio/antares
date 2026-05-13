"""Excepciones personalizadas del dominio de ANTARES."""


class AntaresError(Exception):
    """Base para todas las excepciones de la aplicación."""


class ConfigError(AntaresError):
    """Error al leer o escribir configuración persistente."""


class DatabaseError(AntaresError):
    """Error relacionado con operaciones de base de datos."""


class ConversionError(AntaresError):
    """Error durante la conversión de una imagen."""


class ValidationError(AntaresError):
    """Error de validación de entrada del usuario o datos."""
