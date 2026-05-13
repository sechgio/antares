import sys

sys.path.insert(0, ".")

import sqlite3

from backend.core.database import get_db_path
from backend.core.history import _ensure_table, list_runs, save_run


def setup() -> None:
    """Clear history table for testing."""
    _ensure_table()
    db = get_db_path()
    with sqlite3.connect(str(db)) as conn:
        conn.execute("DELETE FROM historial")
        conn.commit()

def test_pagination() -> None:
    """Test that list_runs supports offset."""
    setup()

    # Save some test runs
    for i in range(10):
        save_run(
            files=[f"file{i}.jpg"],
            options={"formato": "JPEG"},
            patron="test",
            formato="JPEG",
            calidad=95,
            resize=None,
            ok_count=1,
            err_count=0,
        )

    # Get first page
    page1 = list_runs(limit=5, offset=0)
    assert len(page1) == 5, f"Expected 5, got {len(page1)}"

    # Get second page
    page2 = list_runs(limit=5, offset=5)
    assert len(page2) == 5, f"Expected 5, got {len(page2)}"

    # Verify different results
    assert page1[0]["id"] != page2[0]["id"], "Pages should have different results"

    # Verify run_type filter works
    all_runs = list_runs()
    assert len(all_runs) == 10, f"Expected 10 total, got {len(all_runs)}"
    conversion_runs = list_runs(run_type="conversion")
    assert len(conversion_runs) == 10, f"Expected 10 conversion, got {len(conversion_runs)}"
    empty_runs = list_runs(run_type="formato")
    assert len(empty_runs) == 0, f"Expected 0 formato, got {len(empty_runs)}"


if __name__ == "__main__":
    test_pagination()
