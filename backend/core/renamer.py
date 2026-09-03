
from __future__ import annotations

import re
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

from backend.core.config_fields import get_field_names
from backend.core.mapping_index import MappingIndex
from backend.utils.validators import obtener_codigo_desde_nombre, sanitizar_nombre

SequenceMode = Literal["record", "global", "filename"]

_RE_MULTIPLE_UNDERSCORES = re.compile(r"_+")
_RE_TRAILING_SEPARATOR_BEFORE_DOT = re.compile(r"[_\s-]+(?=\.)")
_RE_MULTIPLE_SPACES = re.compile(r"\s+")

if TYPE_CHECKING:
    from collections.abc import Callable


class RenamerEngine:

    @staticmethod
    def campos_disponibles() -> set[str]:
        fields = get_field_names()
        return {f"{{{f}}}" for f in fields} | {"{seq}", "{ext}", "{sep}"}

    def __init__(
        self,
        patron: str | None = None,
        secuencia_inicial: int = 1,
        separador: str = "_",
        sequence_mode: SequenceMode = "filename",
    ) -> None:
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
        self.separador: str = separador
        self.sequence_mode: SequenceMode = sequence_mode
        self._record_sequences: dict[str, int] = {}

    @staticmethod
    def _lookup_file_mapping(
        filename: str,
        file_mapping: dict[str, str] | MappingIndex | None,
    ) -> str | None:
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
        sequence_group: str | None = None,
    ) -> str:
        ruta = Path(ruta_origen)
        ext = ruta.suffix.lower()

        if file_mapping:
            nombre_salida = self._resolve_mapped_output_name(ruta, file_mapping)
            if nombre_salida is not None:
                return nombre_salida

        codigo = codigo_manual or obtener_codigo_desde_nombre(ruta.name)

        if datos_bd is None:
            datos_bd = {}

        if self.sequence_mode == "record" and sequence_group:
            normalized_group = sequence_group.strip().casefold()
            next_value = self._record_sequences.get(normalized_group, 1)
            self._record_sequences[normalized_group] = next_value + 1
            seq_value = str(next_value).zfill(3)
        elif self.sequence_mode == "filename" and file_seq is not None:
            seq_value = file_seq
        else:
            seq_value = str(self.secuencia).zfill(3)

        mapping: dict[str, str] = {"seq": seq_value, "ext": ext, "sep": self.separador}

        if datos_bd:
            for k, v in datos_bd.items():
                mapping[k] = str(v or "")

        field_names = get_field_names()
        first_field = field_names[0] if field_names else None
        for f in field_names:
            if f not in mapping:
                default_val = codigo if f == first_field else ""
                mapping[f] = default_val

        nombre_salida = self.patron
        for key, val in mapping.items():
            nombre_salida = nombre_salida.replace(f"{{{key}}}", val)

        nombre_salida = _RE_MULTIPLE_UNDERSCORES.sub("_", nombre_salida)
        nombre_salida = _RE_TRAILING_SEPARATOR_BEFORE_DOT.sub("", nombre_salida)
        nombre_salida = _RE_MULTIPLE_SPACES.sub(" ", nombre_salida)
        nombre_salida = nombre_salida.strip("_. ")
        nombre_salida = sanitizar_nombre(nombre_salida)

        if not nombre_salida.lower().endswith(ext.lower()):
            nombre_salida += ext

        self.secuencia += 1
        return nombre_salida

    @staticmethod
    def _preserve_original_name(ruta: Path) -> str:
        ext = ruta.suffix.lower()
        stem = sanitizar_nombre(ruta.stem)
        if not stem:
            return sanitizar_nombre(ruta.name)
        if ext and not stem.lower().endswith(ext):
            return stem + ext
        return stem

    def _resolve_mapped_output_name(
        self,
        ruta: Path,
        file_mapping: dict[str, str] | MappingIndex,
    ) -> str | None:
        if isinstance(file_mapping, MappingIndex):
            return file_mapping.resolve_output_name(ruta.name)

        mapped = self._lookup_file_mapping(ruta.name, file_mapping)
        if mapped is None:
            return None
        ext = ruta.suffix.lower()
        nombre_salida = sanitizar_nombre(mapped)
        if not nombre_salida.lower().endswith(ext.lower()):
            nombre_salida += ext
        return nombre_salida

    def preview_lote(
        self,
        rutas: list[str | Path],
        lookup_fn: Callable[[str], dict[str, Any] | None] | None = None,
        codigos_manuales: dict[str, str] | None = None,
        file_seqs: dict[str, str] | None = None,
        file_mapping: dict[str, str] | MappingIndex | None = None,
        sequence_groups: dict[str, str] | None = None,
    ) -> list[tuple[str, str, bool]]:
        codigos_manuales = codigos_manuales or {}
        file_seqs = file_seqs or {}
        sequence_groups = sequence_groups or {}
        resultados: list[tuple[str, str, bool]] = []
        seq_backup = self.secuencia
        record_sequences_backup = self._record_sequences.copy()

        try:
            for ruta in rutas:
                ruta = Path(ruta)
                if file_mapping:
                    mapped_name = self._resolve_mapped_output_name(ruta, file_mapping)
                    if mapped_name is not None:
                        resultados.append((str(ruta), mapped_name, True))
                        continue
                    resultados.append((str(ruta), self._preserve_original_name(ruta), False))
                    continue
                codigo = codigos_manuales.get(ruta.name, obtener_codigo_desde_nombre(ruta.name))
                datos = lookup_fn(codigo) if lookup_fn else None
                if datos is None and self.sequence_mode == "record":
                    resultados.append((str(ruta), self._preserve_original_name(ruta), False))
                    continue
                fseq = file_seqs.get(ruta.name)
                group = sequence_groups.get(ruta.name)
                nombre_nuevo = self.aplicar(
                    ruta,
                    datos_bd=datos,
                    codigo_manual=codigo,
                    file_seq=fseq,
                    sequence_group=group,
                )
                resultados.append((str(ruta), nombre_nuevo, datos is not None))
        finally:
            self.secuencia = seq_backup
            self._record_sequences = record_sequences_backup
        return resultados
