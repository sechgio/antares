
from backend.bootstrap import adjust_backend_import_path


def test_preserves_pyinstaller_runtime_path(tmp_path) -> None:
    runtime_dir = tmp_path / "_MEI12345"
    original_paths = [str(runtime_dir)]

    adjusted = adjust_backend_import_path(
        original_paths.copy(),
        backend_dir=runtime_dir,
        frozen=True,
    )

    assert adjusted == original_paths


def test_replaces_source_backend_dir_with_project_root(tmp_path) -> None:
    backend_dir = tmp_path / "backend"
    project_root = tmp_path

    adjusted = adjust_backend_import_path(
        [str(backend_dir)],
        backend_dir=backend_dir,
        frozen=False,
    )

    assert adjusted[0] == str(project_root)
