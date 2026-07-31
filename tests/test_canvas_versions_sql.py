"""
Tests for Canvas document versions SQL migration syntax & trigger definitions.
"""
from pathlib import Path


def test_canvas_versions_migration_exists():
    repo_root = Path(__file__).resolve().parent.parent
    migration_file = repo_root / "supabase" / "migrations" / "20260731160200_canvas_document_versions.sql"
    assert migration_file.exists(), f"Migration SQL file must exist at {migration_file}"

    content = migration_file.read_text(encoding="utf-8")
    assert "CREATE TABLE IF NOT EXISTS public.canvas_document_versions" in content
    assert "canvas_documents_snapshot_trigger" in content
    assert "canvas_documents_snapshot_and_prune()" in content
    assert "OFFSET 50" in content
    assert "INSERT INTO public.canvas_document_versions" in content
    assert "idx_canvas_doc_versions_doc_date" in content
