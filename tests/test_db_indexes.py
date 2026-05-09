import sys
from pathlib import Path

# Add the project root to the path so 'backend' module can be found
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

import sqlite3

from backend.core.database import get_db_path, init_db


def test_indexes_created():
    """Test that required explicit indexes exist after init_db."""
    init_db()

    with sqlite3.connect(str(get_db_path())) as conn:
        cursor = conn.execute("PRAGMA index_list(imagenes)")
        indexes = cursor.fetchall()

        # Filter out auto indexes (they start with 'sqlite_autoindex')
        explicit_indexes = [idx for idx in indexes if not idx[1].startswith('sqlite_autoindex')]

        # Should have at least one explicit index on the first field (code field)
        assert len(explicit_indexes) > 0, "No explicit indexes found on imagenes table"

        # Check index columns
        for idx in explicit_indexes:
            idx_name = idx[1]
            cursor.execute(f"PRAGMA index_info({idx_name})")
            columns = cursor.fetchall()
            print(f"Explicit Index {idx_name}: {columns}")

    print("Index test passed!")

if __name__ == '__main__':
    test_indexes_created()
