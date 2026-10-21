from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.core.editor import render
from backend.core.editor.store import new_project_document
from backend.core.editor.toolchain import Toolchain, ToolchainError


@pytest.fixture
def child_renderer(monkeypatch: pytest.MonkeyPatch):
    popen = subprocess.Popen
    children: list[subprocess.Popen] = []

    def install(program: str) -> list[subprocess.Popen]:
        def start(command, **kwargs):
            child = popen([sys.executable, "-c", program, command[-1]], **kwargs)
            children.append(child)
            return child

        monkeypatch.setattr(subprocess, "Popen", start)
        monkeypatch.setattr(render, "resolve_toolchain", lambda: Toolchain(Path(sys.executable), Path(sys.executable)))
        monkeypatch.setattr(render, "probe_json", lambda *_: {"format": {"duration": "1"}, "streams": [{}]})
        return children

    yield install
    for child in children:
        if child.poll() is None:
            child.kill()
        child.communicate()


def test_successful_render_publishes_verified_output(tmp_path: Path, child_renderer) -> None:
    child_renderer("import pathlib,sys; pathlib.Path(sys.argv[1]).write_bytes(b'video')")
    output = tmp_path / "export.mp4"
    result = render.execute_render(new_project_document("Prueba"), output, cancel_check=lambda: False)
    assert output.read_bytes() == b"video"
    assert result == {"output": str(output), "durationUs": 1_000_000, "streams": 1}
    assert not list(tmp_path.glob(".*.tmp"))


def test_cancel_terminates_running_child_and_preserves_previous_output(tmp_path: Path, child_renderer) -> None:
    children = child_renderer("import pathlib,sys,time; pathlib.Path(sys.argv[1]).write_bytes(b'partial'); time.sleep(30)")
    output = tmp_path / "export.mp4"
    output.write_bytes(b"previous")
    with pytest.raises(ToolchainError, match="cancelado"):
        render.execute_render(
            new_project_document("Prueba"), output,
            cancel_check=lambda: bool(list(tmp_path.glob(".*.tmp"))),
        )
    assert output.read_bytes() == b"previous"
    assert not list(tmp_path.glob(".*.tmp"))
    assert children and children[0].poll() is not None


def test_failed_render_removes_partial_output(tmp_path: Path, child_renderer) -> None:
    child_renderer("import pathlib,sys; pathlib.Path(sys.argv[1]).write_bytes(b'partial'); sys.stderr.write('render error'); sys.exit(1)")
    output = tmp_path / "export.mp4"
    with pytest.raises(ToolchainError, match="render error"):
        render.execute_render(new_project_document("Prueba"), output)
    assert not output.exists()
    assert not list(tmp_path.glob(".*.tmp"))


def test_timeout_terminates_child_and_removes_partial_output(tmp_path: Path, child_renderer, monkeypatch: pytest.MonkeyPatch) -> None:
    children = child_renderer("import time; time.sleep(30)")
    ticks = iter((0.0, 1801.0))
    monkeypatch.setattr(render, "time", SimpleNamespace(monotonic=lambda: next(ticks)))
    output = tmp_path / "export.mp4"
    output.write_bytes(b"previous")
    with pytest.raises(subprocess.TimeoutExpired):
        render.execute_render(new_project_document("Prueba"), output)
    assert output.read_bytes() == b"previous"
    assert not list(tmp_path.glob(".*.tmp"))
    assert children and children[0].poll() is not None
