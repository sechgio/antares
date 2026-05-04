"""Startup path helpers for the backend entrypoint."""

from __future__ import annotations

from pathlib import Path


def adjust_backend_import_path(
    paths: list[str],
    backend_dir: Path,
    *,
    frozen: bool = False,
) -> list[str]:
    """Return sys.path entries that make ``backend`` importable from source.

    PyInstaller needs its runtime directory to stay on sys.path, so frozen
    builds must not rewrite the temporary extraction path.
    """

    if frozen:
        return paths

    project_root = backend_dir.parent
    project_root_text = str(project_root)

    for index, item in enumerate(paths):
        try:
            if Path(item).resolve() == backend_dir:
                paths[index] = project_root_text
                break
        except (OSError, RuntimeError):
            continue
    else:
        if project_root_text not in paths:
            paths.insert(0, project_root_text)

    return paths
