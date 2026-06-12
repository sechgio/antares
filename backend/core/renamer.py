"""Motor de renombrado automático basado en reglas y base de datos."""

from __future__ import annotations

import re
from pathlib import Path
from typing import TYPE_CHECKING, Any

from backend.core.config_fields import get_field_names
from backend.core.mapping_index import MappingIndex
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

    @staticmethod
    def build_mapping_patron(mapping_keys: list[str]) -> str:
        """Patrón interno de compatibilidad para modo mapeo directo."""
        if not mapping_keys:
            return "{renombre}{ext}"
        return "{renombre}{ext}"

    @staticmethod
    def _lookup_file_mapping(
        filename: str,
        file_mapping: dict[str, str] | MappingIndex | None,
    ) -> str | None:
        """Busca un nombre nuevo en el mapeo directo (tolerante a extensión y mayúsculas)."""
        if not file_mapping:
            return None
        if isinstance(file_mapping, MappingIndex):
            return file_mapping.lookup(filename)

        name = Path(filename).name
        stem = Path(name).stem

        if name in file_mapping:
            return file_mapping[name]
        if stem in file_mapping:
            return file_mapping[stem]

        lower_index = {key.lower(): value for key, value in file_mapping.items()}
        if name.lower() in lower_index:
            return lower_index[name.lower()]
        if stem.lower() in lower_index:
            return lower_index[stem.lower()]
        return None

    def aplicar(
        self,
        ruta_origen: str | Path,
        datos_bd: dict[str, Any] | None = None,
        codigo_manual: str | None = None,
        file_seq: str | None = None,
        file_mapping: dict[str, str] | MappingIndex | None = None,
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

        mapped_name = self._lookup_file_mapping(ruta.name, file_mapping or {})
        if mapped_name is not None:
            nombre_salida = sanitizar_nombre(mapped_name)
            if not nombre_salida.lower().endswith(ext.lower()):
                nombre_salida += ext
            self.secuencia += 1
            return nombre_salida

        codigo = codigo_manual or obtener_codigo_desde_nombre(ruta.name)

        # Si no se proporcionaron datos, usar diccionario vacío (desacoplado de BD)
        if datos_bd is None:
            datos_bd = {}

        seq_value = file_seq if file_seq is not None else str(self.secuencia).zfill(3)

        mapping: dict[str, str] = {"seq": seq_value, "ext": ext}

        # Primero poblamos con los datos de la base de datos si existen
        if datos_bd:
            for k, v in datos_bd.items():
                mapping[k] = str(v or "")

        # Luego aseguramos que los campos configurados tengan al menos un valor vacío o el código
        field_names = get_field_names()
        first_field = field_names[0] if field_names else None
        for f in field_names:
            if f not in mapping:
                default_val = codigo if f == first_field else ""
                mapping[f] = default_val

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
        file_mapping: dict[str, str] | MappingIndex | None = None,
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
                if file_mapping:
                    mapped = self._lookup_file_mapping(ruta.name, file_mapping)
                    if mapped is not None:
                        nombre_nuevo = self.aplicar(ruta, file_mapping=file_mapping)
                        resultados.append((str(ruta), nombre_nuevo, True))
                        continue
                codigo = codigos_manuales.get(ruta.name, obtener_codigo_desde_nombre(ruta.name))
                datos = lookup_fn(codigo) if lookup_fn else None
                fseq = file_seqs.get(ruta.name)
                nombre_nuevo = self.aplicar(ruta, datos_bd=datos, codigo_manual=codigo, file_seq=fseq)
                resultados.append((str(ruta), nombre_nuevo, datos is not None))
        finally:
            self.secuencia = seq_backup
        return resultados
