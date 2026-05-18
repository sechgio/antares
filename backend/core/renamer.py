"""Motor de renombrado automático basado en reglas y base de datos."""

from __future__ import annotations

import re
from pathlib import Path
from typing import TYPE_CHECKING, Any

from backend.core.config_fields import get_field_names
from backend.utils.validators import obtener_codigo_desde_nombre, sanitizar_nombre

# Pre-compiled regex patterns for clean-up in aplicar()
_RE_MULTIPLE_UNDERSCORES = re.compile(r"_+")
_RE_TRAILING_SEPARATOR_BEFORE_DOT = re.compile(r"[_\s-]+(?=\.)")
_RE_MULTIPLE_SPACES = re.compile(r"\s+")

if TYPE_CHECKING:
    from collections.abc import Callable


class RenamerEngine:
    """Permite construir nombres de archivo dinámicos usando patrones y datos de BD."""

    @staticmethod
    def campos_disponibles() -> set[str]:
        """Retorna el conjunto de placeholders disponibles según la configuración actual."""
        fields = get_field_names()
        return {f"{{{f}}}" for f in fields} | {"{seq}", "{ext}"}

    def __init__(self, patron: str | None = None, secuencia_inicial: int = 1) -> None:
        """Inicializa el motor de renombrado.

        Args:
            patron: Cadena con placeholders, ej: "{categoria}_{codigo}_{nombre}{ext}".
            secuencia_inicial: Número inicial para {seq}.
        """
        if patron is None:
            fields = get_field_names()
            default = (
                "_".join([f"{{{f}}}" for f in fields[:2]]) + "{ext}"
                if len(fields) >= 2
                else (f"{{{fields[0]}}}{{ext}}" if fields else "img_{seq}{ext}")
            )
            patron = default
        self.patron: str = patron
        self.secuencia: int = int(secuencia_inicial)

    def aplicar(
        self,
        ruta_origen: str | Path,
        datos_bd: dict[str, Any] | None = None,
        codigo_manual: str | None = None,
        file_seq: str | None = None,
    ) -> str:
        """Genera el nuevo nombre para un archivo.

        Args:
            ruta_origen: Path o str de la imagen origen.
            datos_bd: Diccionario opcional con datos ya consultados de la BD.
            codigo_manual: Cadena opcional para forzar el código a buscar.
            file_seq: Secuencia extraída del nombre de archivo. Si se proporciona,
                      se usa en lugar del contador auto-incremental.

        Returns:
            Nuevo nombre de archivo (solo nombre, no ruta completa).
        """
        ruta = Path(ruta_origen)
        ext = ruta.suffix.lower()

        codigo = codigo_manual or obtener_codigo_desde_nombre(ruta.name)

        # Si no se proporcionaron datos, usar diccionario vacío (desacoplado de BD)
        if datos_bd is None:
            datos_bd = {}

        seq_value = file_seq if file_seq is not None else str(self.secuencia).zfill(3)

        mapping: dict[str, str] = {"seq": seq_value, "ext": ext}
        field_names = get_field_names()
        first_field = field_names[0] if field_names else None
        for f in field_names:
            # El primer campo usa el código como fallback; el resto queda vacío
            # si no hay datos en la BD. No usamos ruta.stem para evitar que el
            # nombre del archivo ya convertido/renombrado se propague como dato.
            default_val = codigo if f == first_field else ""
            mapping[f] = str(datos_bd.get(f, default_val) or "")

        nombre_salida = self.patron
        for key, val in mapping.items():
            nombre_salida = nombre_salida.replace(f"{{{key}}}", val)

        # Limpiar separadores que quedan cuando faltan datos de la BD.
        nombre_salida = _RE_MULTIPLE_UNDERSCORES.sub("_", nombre_salida)
        nombre_salida = _RE_TRAILING_SEPARATOR_BEFORE_DOT.sub("", nombre_salida)
        nombre_salida = _RE_MULTIPLE_SPACES.sub(" ", nombre_salida)
        nombre_salida = nombre_salida.strip("_. ")
        nombre_salida = sanitizar_nombre(nombre_salida)

        if not nombre_salida.lower().endswith(ext.lower()):
            nombre_salida += ext

        self.secuencia += 1
        return nombre_salida

    def preview_lote(
        self,
        rutas: list[str | Path],
        lookup_fn: Callable[[str], dict[str, Any] | None] | None = None,
        codigos_manuales: dict[str, str] | None = None,
        file_seqs: dict[str, str] | None = None,
    ) -> list[tuple[str, str, bool]]:
        """Genera una vista previa del renombrado para un lote.

        Args:
            rutas: Lista de rutas de archivos.
            lookup_fn: Función opcional para buscar datos en catálogo (code -> dict | None).
            codigos_manuales: Diccionario opcional {nombre_archivo: codigo}.
            file_seqs: Diccionario opcional {nombre_archivo: secuencia_del_archivo}.

        Returns:
            Lista de tuplas (ruta_origen, nombre_sugerido, datos_encontrados).
        """
        codigos_manuales = codigos_manuales or {}
        file_seqs = file_seqs or {}
        resultados: list[tuple[str, str, bool]] = []
        seq_backup = self.secuencia

        try:
            for ruta in rutas:
                ruta = Path(ruta)
                codigo = codigos_manuales.get(ruta.name, obtener_codigo_desde_nombre(ruta.name))
                datos = lookup_fn(codigo) if lookup_fn else None
                fseq = file_seqs.get(ruta.name)
                nombre_nuevo = self.aplicar(ruta, datos_bd=datos, codigo_manual=codigo, file_seq=fseq)
                resultados.append((str(ruta), nombre_nuevo, datos is not None))
        finally:
            self.secuencia = seq_backup
        return resultados
