"""Errores del dominio Evidencia Volanteo."""


class EvidenciaVolanteoError(Exception):
    """Error base del módulo."""


class RenderingError(EvidenciaVolanteoError):
    """Fallo al generar PDF o DOCX."""
