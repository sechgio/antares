"""Pruebas del historial content-addressed de artefactos."""

from __future__ import annotations

import hashlib

import pytest

from backend.core.agent import artifact_versions


def _artifact(artifact_id: str, name: str, digest: str, path: str | None = None) -> dict:
    return {
        "id": artifact_id,
        "kind": "pdf",
        "files": [{"path": path or name, "name": name, "sha256": digest, "mime": "application/pdf"}],
    }


def _write(drafts, name: str, content: bytes) -> str:
    target = drafts / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return hashlib.sha256(content).hexdigest()


@pytest.fixture()
def layout(tmp_path):
    base = tmp_path / "store"
    base.mkdir()
    drafts = tmp_path / "drafts"
    drafts.mkdir()
    return base, drafts


def test_record_captures_bytes_and_provenance(layout):
    base, drafts = layout
    digest = _write(drafts, "reporte.pdf", b"version-1")
    created = artifact_versions.record(base, "s1", _artifact("a1", "reporte.pdf", digest), drafts, {"method": "document_generate"})
    assert created == {"revision": 1, "parent_revision": None, "at": created["at"]}
    listed = artifact_versions.versions(base, "s1", "a1")
    assert len(listed["revisions"]) == 1
    revision = listed["revisions"][0]
    assert revision["provenance"] == {"method": "document_generate"}
    assert revision["files"][0]["sha256"] == digest
    assert revision["files"][0]["available"] is True
    assert listed["tombstoned"] is False


def test_restore_brings_back_exact_bytes(layout):
    base, drafts = layout
    first = _write(drafts, "reporte.pdf", b"version-1")
    artifact_versions.record(base, "s1", _artifact("a1", "reporte.pdf", first), drafts)
    second = _write(drafts, "reporte.pdf", b"version-2")
    artifact_versions.record(base, "s1", _artifact("a1", "reporte.pdf", second), drafts)
    assert (drafts / "reporte.pdf").read_bytes() == b"version-2"
    outcome = artifact_versions.restore(base, "s1", "a1", 1, drafts)
    assert outcome["restored"] == 1
    assert (drafts / "reporte.pdf").read_bytes() == b"version-1"
    assert hashlib.sha256((drafts / "reporte.pdf").read_bytes()).hexdigest() == first


def test_restore_refuses_unknown_or_incomplete_revision(layout):
    base, drafts = layout
    digest = _write(drafts, "reporte.pdf", b"version-1")
    artifact_versions.record(base, "s1", _artifact("a1", "reporte.pdf", digest), drafts)
    with pytest.raises(ValueError, match="no existe"):
        artifact_versions.restore(base, "s1", "a1", 9, drafts)
    with pytest.raises(ValueError, match="historial"):
        artifact_versions.restore(base, "s1", "desconocido", 1, drafts)
    # Corrompe la copia almacenada: la restauración debe negarse por hash.
    blob = base / ".artifact-versions" / "a1" / "1" / "0"
    blob.write_bytes(b"corrupcion")
    with pytest.raises(ValueError, match="corrupta"):
        artifact_versions.restore(base, "s1", "a1", 1, drafts)


def test_revision_without_bytes_is_not_restorable(layout):
    base, drafts = layout
    artifact = _artifact("a1", "reporte.pdf", "0" * 64)  # sin archivo en disco
    created = artifact_versions.record(base, "s1", artifact, drafts)
    assert created is None or artifact_versions.versions(base, "s1", "a1")["revisions"][0]["files"][0]["available"] is False
    with pytest.raises(ValueError):
        artifact_versions.restore(base, "s1", "a1", 1, drafts)


def test_pruning_drops_bytes_of_oldest_revisions(layout):
    base, drafts = layout
    artifact_versions.MAX_REVISIONS, original = 3, artifact_versions.MAX_REVISIONS
    try:
        for step in range(5):
            digest = _write(drafts, "reporte.pdf", f"v{step}".encode())
            artifact_versions.record(base, "s1", _artifact("a1", "reporte.pdf", digest), drafts)
        listed = artifact_versions.versions(base, "s1", "a1")["revisions"]
        assert [item["revision"] for item in listed] == [3, 4, 5]
        assert not (base / ".artifact-versions" / "a1" / "2").exists()
        assert (base / ".artifact-versions" / "a1" / "5").is_dir()
    finally:
        artifact_versions.MAX_REVISIONS = original


def test_tombstone_roundtrip(layout):
    base, drafts = layout
    digest = _write(drafts, "reporte.pdf", b"v1")
    artifact_versions.record(base, "s1", _artifact("a1", "reporte.pdf", digest), drafts)
    tombstoned = artifact_versions.set_tombstone(base, "s1", "a1", True)
    assert tombstoned["tombstoned"] is True
    assert artifact_versions.versions(base, "s1", "a1")["tombstoned"] is True
    restored = artifact_versions.set_tombstone(base, "s1", "a1", False)
    assert restored["tombstoned"] is False
    assert artifact_versions.versions(base, "s1", "a1")["tombstoned"] is False


def test_sessions_are_isolated(layout):
    base, drafts = layout
    digest = _write(drafts, "reporte.pdf", b"v1")
    artifact_versions.record(base, "s1", _artifact("a1", "reporte.pdf", digest), drafts)
    assert artifact_versions.versions(base, "s2", "a1")["revisions"] == []
    with pytest.raises(ValueError, match="historial"):
        artifact_versions.restore(base, "s2", "a1", 1, drafts)
