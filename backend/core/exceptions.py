"""Excepciones personalizadas del dominio de Antares."""


class AntaresError(Exception):
    """Base para todas las excepciones de la aplicación."""


class DatabaseError(AntaresError):
    """Error relacionado con operaciones de base de datos."""
