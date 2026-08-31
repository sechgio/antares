from pathlib import Path


MIGRATION = (
    Path(__file__).parents[1]
    / "supabase"
    / "migrations"
    / "20260831120000_canvas_realtime_authorization.sql"
)


def test_canvas_realtime_policies_are_private_and_idempotent() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    assert sql.count("drop policy if exists") == 2
    assert "on realtime.messages" in sql
    assert "for select" in sql
    assert "for insert" in sql
    assert "extension in ('broadcast', 'presence')" in sql
    assert "realtime.topic() like 'canvas-document:%'" in sql
    assert sql.count("public.is_active_user()") == 2
