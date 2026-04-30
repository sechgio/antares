"""Excepciones personalizadas del dominio de COSMO."""


class CosmoError(Exception):
    """Base para todas las excepciones de la aplicación."""


class ConfigError(CosmoError):
    """Error al leer o escribir configuración persistente."""


class DatabaseError(CosmoError):
    """Error relacionado con operaciones de base de datos."""


class ConversionError(CosmoError):
    """Error durante la conversión de una imagen."""


class ValidationError(CosmoError):
    """Error de validación de entrada del usuario o datos."""
