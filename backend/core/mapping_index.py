
from __future__ import annotations

from pathlib import Path
from typing import Any

from backend.utils.validators import sanitizar_nombre


class MappingIndex:

    def __init__(self, file_mapping: dict[str, str]) -> None:
        self.raw = dict(file_mapping)
        self._exact: dict[str, str] = {}
        self._lower: dict[str, str] = {}
        self.stem_conflicts: list[str] = []
        self._conflicted_stems: set[str] = set()
        self._conflicted_stems_lower: set[str] = set()

        for key, value in file_mapping.items():
            if not key:
                continue
            self._exact[key] = value
            self._lower[key.lower()] = value

        stem_to_values: dict[str, set[str]] = {}
        stem_lower_to_values: dict[str, set[str]] = {}
        for key, value in file_mapping.items():
            if not key:
                continue
            stem = Path(key).stem
            if not stem:
                continue
            stem_to_values.setdefault(stem, set()).add(value)
            stem_lower_to_values.setdefault(stem.lower(), set()).add(value)

        for stem, values in stem_to_values.items():
            if len(values) != 1:
                self.stem_conflicts.append(stem)
                self._conflicted_stems.add(stem)
                self._conflicted_stems_lower.add(stem.lower())
                continue
            value = next(iter(values))
            if stem not in self._exact:
                self._exact[stem] = value

        for stem_l, values in stem_lower_to_values.items():
            if len(values) != 1:
                self._conflicted_stems_lower.add(stem_l)
                if stem_l not in {c.lower() for c in self.stem_conflicts}:
                    self.stem_conflicts.append(stem_l)
                continue
            value = next(iter(values))
            if stem_l not in self._lower:
                self._lower[stem_l] = value

    def lookup(self, filename: str) -> str | None:
        if not self.raw:
            return None
        name = Path(filename).name
        stem = Path(name).stem
        if name in self._exact:
            return self._exact[name]
        if name.lower() in self._lower:
            return self._lower[name.lower()]
        if stem in self._conflicted_stems or stem.lower() in self._conflicted_stems_lower:
            return None
        if stem in self._exact:
            return self._exact[stem]
        if stem.lower() in self._lower:
            return self._lower[stem.lower()]
        return None

    def resolve_output_name(self, filename: str) -> str | None:
        mapped = self.lookup(filename)
        if mapped is None:
            return None
        ext = Path(filename).suffix.lower()
        output = sanitizar_nombre(mapped)
        if not output:
            return None
        if ext and not output.lower().endswith(ext):
            output += ext
        return output

    def _id_matches_file(self, id_key: str, file_name: str) -> bool:
        key_lower = id_key.lower()
        stem_key = Path(id_key).stem.lower()
        if file_name == id_key or file_name.lower() == key_lower:
            return True
        file_stem = Path(file_name).stem
        return file_stem == id_key or file_stem.lower() in {stem_key, key_lower}

    def _id_matches_any_file(
        self,
        id_key: str,
        *,
        names: set[str],
        names_lower: set[str],
        stems: set[str],
        stems_lower: set[str],
    ) -> bool:
        key_lower = id_key.lower()
        stem_key = Path(id_key).stem.lower()
        if id_key in names or key_lower in names_lower:
            return True
        return id_key in stems or stem_key in stems_lower or key_lower in stems_lower

    def compute_stats(self, file_paths: list[str]) -> dict[str, Any]:
        file_names = [Path(f).name for f in file_paths if f]
        matched_names: list[str] = []
        for name in file_names:
            if self.lookup(name) is not None:
                matched_names.append(name)

        names = set(file_names)
        names_lower = {n.lower() for n in file_names}
        stems = {Path(n).stem for n in file_names}
        stems_lower = {Path(n).stem.lower() for n in file_names}
        orphan_entries = [
            id_key
            for id_key in self.raw
            if not self._id_matches_any_file(
                id_key,
                names=names,
                names_lower=names_lower,
                stems=stems,
                stems_lower=stems_lower,
            )
        ]
        collisions = self.find_collisions(file_paths)

        return {
            "totalEntries": len(self.raw),
            "matchedFiles": len(matched_names),
            "unmatchedFiles": [name for name in file_names if name not in matched_names],
            "orphanEntries": orphan_entries,
            "collisions": collisions,
        }

    def find_collisions(self, file_paths: list[str]) -> list[dict[str, Any]]:
        grouped: dict[str, tuple[str, list[str]]] = {}
        for fpath in file_paths:
            if not fpath:
                continue
            name = Path(fpath).name
            output = self.resolve_output_name(name)
            if not output:
                continue
            key = output.lower()
            if key in grouped:
                grouped[key][1].append(name)
            else:
                grouped[key] = (output, [name])

        return [
            {"output": display, "sources": sources}
            for display, sources in grouped.values()
            if len(sources) > 1
        ]
