"""Helpers compartidos para tests que lanzan el backend real por IPC."""

from __future__ import annotations

import json
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent


def drain_stderr(proc: subprocess.Popen, sink: list[str]) -> None:
    if proc.stderr is None:
        return
    for line in iter(proc.stderr.readline, ""):
        sink.append(line)


def spawn_backend(env: dict[str, str] | None = None) -> tuple[subprocess.Popen, list[str]]:
    """Lanza `python -m backend.main` con pipes UTF-8 y stderr drenado."""
    proc = subprocess.Popen(
        [sys.executable, "-m", "backend.main"],
        cwd=str(BACKEND_ROOT),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        env=env,
    )
    stderr_lines: list[str] = []
    threading.Thread(target=drain_stderr, args=(proc, stderr_lines), daemon=True).start()
    return proc, stderr_lines


def await_ready(proc: subprocess.Popen, stderr_lines: list[str], timeout: float = 10.0) -> None:
    """Espera la notificación `ready`; falla en EOF, db_init_failed o timeout."""
    buffer = ""
    start = time.time()
    while time.time() - start < timeout:
        line = proc.stdout.readline()
        if not line:
            break
        buffer += line
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if msg.get("method") == "db_init_failed":
            proc.kill()
            proc.wait()
            pytest.fail(
                f"Backend db_init_failed during startup: {msg.get('params')}\n"
                f"stderr: {''.join(stderr_lines)}"
            )
        if msg.get("method") == "ready":
            return
    proc.kill()
    proc.wait()
    pytest.fail(
        f"Backend did not send ready within {timeout}s.\n"
        f"stdout buffer: {buffer!r}\n"
        f"stderr: {''.join(stderr_lines)}"
    )


def stop_backend(proc: subprocess.Popen) -> None:
    if proc.stdin is not None:
        proc.stdin.close()
    proc.kill()
    proc.wait()


@pytest.fixture
def backend_process():
    proc, stderr_lines = spawn_backend()
    await_ready(proc, stderr_lines)
    proc.stderr_lines = stderr_lines
    yield proc
    stop_backend(proc)
