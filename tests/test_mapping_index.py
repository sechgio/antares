"""Tests para MappingIndex (lookup, stats, colisiones)."""

from __future__ import annotations

from backend.core.mapping_index import MappingIndex


class TestMappingIndex:
    def test_lookup_case_insensitive(self) -> None:
        index = MappingIndex({"img_0001.jpg": "fachada"})
        assert index.lookup("IMG_0001.jpg") == "fachada"

    def test_resolve_output_name_adds_extension(self) -> None:
        index = MappingIndex({"IMG_0001.jpg": "fachada_norte"})
        assert index.resolve_output_name("IMG_0001.jpg") == "fachada_norte.jpg"

    def test_compute_stats(self) -> None:
        index = MappingIndex({
            "A.jpg": "uno",
            "B.jpg": "dos",
            "C.jpg": "tres",
        })
        stats = index.compute_stats(["C:/tmp/A.jpg", "C:/tmp/B.jpg", "C:/tmp/missing.jpg"])
        assert stats["matchedFiles"] == 2
        assert stats["unmatchedFiles"] == ["missing.jpg"]
        assert stats["orphanEntries"] == ["C.jpg"]

    def test_compute_stats_orphan_parity_stem_and_case(self) -> None:
        """O(1) orphan path must match prior _id_matches_file semantics."""
        index = MappingIndex({
            "photo.jpg": "a",
            "STEM_ONLY": "b",
            "Mixed.JPG": "c",
            "orphan_id": "d",
        })
        files = ["C:/in/photo.jpg", "C:/in/stem_only.png", "C:/in/mixed.jpg"]
        stats = index.compute_stats(files)
        # photo.jpg exact; STEM_ONLY via file stem; Mixed.JPG via case; orphan_id alone
        assert set(stats["orphanEntries"]) == {"orphan_id"}
        assert stats["matchedFiles"] == 3

    def test_find_collisions(self) -> None:
        index = MappingIndex({
            "A.jpg": "mismo",
            "B.jpg": "mismo",
        })
        collisions = index.find_collisions(["C:/tmp/A.jpg", "C:/tmp/B.jpg"])
        assert len(collisions) == 1
        assert collisions[0]["output"] == "mismo.jpg"
        assert set(collisions[0]["sources"]) == {"A.jpg", "B.jpg"}
