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


def test_canvas_lww_migration_remains_in_history():
    repo_root = Path(__file__).resolve().parent.parent
    migration_file = repo_root / "supabase" / "migrations" / "20260828000000_canvas_lww_atomic.sql"
    assert migration_file.exists(), f"Historical migration SQL file must exist at {migration_file}"


def test_canvas_version_storage_guard_bounds_current_and_stale_write_paths():
    repo_root = Path(__file__).resolve().parent.parent
    migration_file = (
        repo_root
        / "supabase"
        / "migrations"
        / "20260904170000_canvas_version_storage_guard.sql"
    )
    assert migration_file.exists(), f"Migration SQL file must exist at {migration_file}"

    content = migration_file.read_text(encoding="utf-8")

    assert "CREATE TABLE IF NOT EXISTS public.canvas_storage_usage" in content
    assert "max_total_bytes bigint NOT NULL DEFAULT 268435456" in content
    assert "canvas_documents_document_size_check" in content
    assert "canvas_document_versions_document_size_check" in content
    assert "16777216" in content
    assert "interval '90 days'" in content
    assert "interval '30 days'" in content
    assert "CREATE OR REPLACE FUNCTION private.canvas_record_document_version" in content
    assert "CREATE OR REPLACE FUNCTION private.canvas_purge_deleted_documents" in content
    assert "DROP FUNCTION IF EXISTS public.canvas_push_document_lww" in content
    assert "AFTER INSERT OR UPDATE OF document OR DELETE" in content
    assert "AFTER INSERT OR UPDATE OR DELETE" in content
    assert content.count("SET search_path = pg_catalog, pg_temp") >= 10

    assert content.count("INSERT INTO public.canvas_document_versions") == 1, (
        "writes must go through canvas_record_document_version; old migrations stay"
    )
    assert "PERFORM private.canvas_record_document_version" in content
    assert "PERFORM private.canvas_prune_document_versions(p_document_id)" in content
