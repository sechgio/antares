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


def test_canvas_version_storage_prune_before_insert_migration_bounds_transient_quota():
    repo_root = Path(__file__).resolve().parent.parent
    migration_file = (
        repo_root
        / "supabase"
        / "migrations"
        / "20260907180000_canvas_version_storage_prune_before_insert.sql"
    )
    assert migration_file.exists(), f"Migration SQL file must exist at {migration_file}"

    content = migration_file.read_text(encoding="utf-8")

    assert "CREATE OR REPLACE FUNCTION private.canvas_prune_document_versions" in content
    assert "p_keep integer DEFAULT 50" in content
    assert "OFFSET GREATEST(p_keep, 0)" in content
    assert "CREATE OR REPLACE FUNCTION private.canvas_record_document_version" in content
    assert "PERFORM private.canvas_prune_document_versions(p_document_id, 49);" in content
    assert "PERFORM private.canvas_prune_document_versions(p_document_id, 50);" in content
    record_body = content.split("CREATE OR REPLACE FUNCTION private.canvas_record_document_version", 1)[1].split("$$;", 1)[0]
    assert "RETURN NULL" not in record_body
    assert "SET search_path = pg_catalog, pg_temp" in content


def test_canvas_storage_idempotency_migration_deduplicates_noop_versions_and_exposes_maintenance():
    repo_root = Path(__file__).resolve().parent.parent
    migration_file = (
        repo_root
        / "supabase"
        / "migrations"
        / "20260909090000_canvas_storage_idempotency_and_maintenance.sql"
    )
    assert migration_file.exists(), f"Migration SQL file must exist at {migration_file}"

    content = migration_file.read_text(encoding="utf-8")

    assert "ADD COLUMN IF NOT EXISTS content_hash text" in content
    assert "canvas_documents_set_content_hash" in content
    assert "canvas_document_versions_set_content_hash" in content
    assert "SET content_hash = private.canvas_document_hash(document)" not in content
    assert "canvas_validate_storage_batch" not in content
    assert "NEW.document IS NOT DISTINCT FROM OLD.document" in content
    assert "NEW.content_hash IS NOT DISTINCT FROM OLD.content_hash" in content
    assert "md5(p_document::text)" in content
    assert "created_at = v_created_at" in content
    assert "RETURN NULL" not in content.split("CREATE OR REPLACE FUNCTION private.canvas_record_document_version", 1)[1].split("$$;", 1)[0]
    assert "canvas_prune_document_versions(p_document_id, 49)" in content
    assert "canvas_prune_document_versions(p_document_id, 50)" in content
    assert "canvas_maintenance" in content
    assert "canvas_reconcile_storage_usage" in content
    assert "FOR UPDATE" in content
    assert "LIMIT v_limit" in content


def test_canvas_lww_v2_rpc_is_explicit_and_serializes_document_and_delete_writes():
    repo_root = Path(__file__).resolve().parent.parent
    migration_file = (
        repo_root
        / "supabase"
        / "migrations"
        / "20260909100000_canvas_lww_rpc_v2.sql"
    )
    assert migration_file.exists(), f"Migration SQL file must exist at {migration_file}"

    content = migration_file.read_text(encoding="utf-8")

    assert "canvas_validate_legacy_storage_batch" in content
    assert not content.lstrip().startswith("DO $$"), "deployment must not scan every Canvas row"
    assert "private.canvas_push_document_lww_v2" in content
    assert "public.canvas_push_document_lww_v2" in content
    assert "p_force_resurrect boolean" in content
    assert "pg_advisory_xact_lock" in content
    assert "FOR UPDATE" in content
    assert "private.canvas_delete_document_lww_v2" in content
    assert "public.canvas_delete_document_lww_v2" in content
    assert "p_deleted_at timestamptz" in content
    assert "GRANT EXECUTE ON FUNCTION public.canvas_push_document_lww_v2" in content
    assert "GRANT EXECUTE ON FUNCTION public.canvas_delete_document_lww_v2" in content
    v2_body = content.split("CREATE OR REPLACE FUNCTION private.canvas_push_document_lww_v2", 1)[1].split("$$;", 1)[0]
    assert "content_hash" in v2_body
    assert "v_existing.updated_at = v_updated_at" in v2_body


def test_canvas_upgrade_compatibility_migration_preserves_legacy_rpc_and_serializes_first_insert():
    repo_root = Path(__file__).resolve().parent.parent
    migration_file = (
        repo_root
        / "supabase"
        / "migrations"
        / "20260909100000_canvas_lww_rpc_v2.sql"
    )
    assert migration_file.exists(), f"Migration SQL file must exist at {migration_file}"

    content = migration_file.read_text(encoding="utf-8")

    assert "pg_advisory_xact_lock" in content
    assert "CREATE OR REPLACE FUNCTION public.canvas_push_document_lww(" in content
    assert "CREATE OR REPLACE FUNCTION public.canvas_push_document_lww_v2(" in content
    assert "p_id uuid" in content
    assert "p_force_resurrect boolean DEFAULT false" in content
    assert "CREATE OR REPLACE FUNCTION public.canvas_delete_document_lww_v2(" in content
    assert "GRANT EXECUTE ON FUNCTION public.canvas_push_document_lww_v2(jsonb, timestamptz, boolean)" in content
    assert "GRANT EXECUTE ON FUNCTION public.canvas_delete_document_lww_v2(uuid, timestamptz)" in content
    assert "DROP FUNCTION IF EXISTS public.canvas_push_document_lww(" in content
    assert "DROP FUNCTION IF EXISTS public.canvas_delete_document_lww(uuid, timestamptz)" not in content
    assert content.count("TO authenticated") >= 2
    assert "RAISE EXCEPTION" in content
    assert "canvas_documents" in content
    assert "canvas_document_versions" in content


def test_supabase_perf_audit_migration_delegates_legacy_rpc_and_narrows_hot_path():
    repo_root = Path(__file__).resolve().parent.parent
    migration_file = (
        repo_root
        / "supabase"
        / "migrations"
        / "20260911200000_supabase_perf_audit.sql"
    )
    assert migration_file.exists(), f"Migration SQL file must exist at {migration_file}"

    content = migration_file.read_text(encoding="utf-8")

    assert "SELECT private.canvas_push_document_lww_v2(p_document, p_updated_at, false)" in content
    assert "pg_try_advisory_xact_lock" in content

    v2_body = content.split(
        "CREATE OR REPLACE FUNCTION private.canvas_push_document_lww_v2", 1
    )[1].split("$$;", 1)[0]
    assert "%ROWTYPE" not in v2_body
    assert "SELECT id, updated_at, deleted_at, content_hash" in v2_body

    record_body = content.split(
        "CREATE OR REPLACE FUNCTION private.canvas_record_document_version", 1
    )[1].split("$$;", 1)[0]
    assert "canvas_assert_document_within_limit" not in record_body
    assert "canvas_prune_document_versions(p_document_id, 49)" in record_body
    assert "canvas_prune_document_versions(p_document_id, 50)" not in record_body

    delta_body = content.split(
        "CREATE OR REPLACE FUNCTION private.canvas_storage_apply_delta", 1
    )[1].split("$$;", 1)[0]
    assert "FOR UPDATE" not in delta_body
    assert "RETURNING document_bytes, version_bytes, max_total_bytes" in delta_body

    append_body = content.split(
        "CREATE OR REPLACE FUNCTION private.canvas_append_document_version", 1
    )[1].split("$$;", 1)[0]
    assert "canvas_assert_document_within_limit(p_document)" in append_body

    assert "AND (SELECT private.is_active_user())" in content
    assert "DROP INDEX IF EXISTS public.idx_tareas_proyecto" in content
    assert "idx_tareas_proyecto_sort" in content
    assert "idx_board_columns_proyecto_sort" in content

