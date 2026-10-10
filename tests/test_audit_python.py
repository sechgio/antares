"""The dependency audit must use the lock and propagate every failure."""

import subprocess
from pathlib import Path

import pytest

from scripts import audit_python


@pytest.mark.parametrize("export_code,audit_code,expected", [(0, 0, 0), (0, 1, 1), (0, 2, 2), (7, 0, 7)])
def test_audit_failures_and_cleanup(monkeypatch, export_code, audit_code, expected):
    calls = []
    requirements = None

    def fake_run(command, **kwargs):
        nonlocal requirements
        calls.append(command)
        assert kwargs["cwd"] == audit_python.ROOT
        assert kwargs["check"] is False
        if command[0] == "uv":
            assert "--locked" in command
            assert "--no-dev" in command
            assert "--no-emit-project" in command
            assert "--no-hashes" not in command
            requirements = Path(command[command.index("--output-file") + 1])
            requirements.write_text("pillow==12.3.0\n", encoding="utf-8")
            return subprocess.CompletedProcess(command, export_code)
        assert command[:3] == [audit_python.sys.executable, "-m", "pip_audit"]
        assert "--require-hashes" in command and "--disable-pip" in command
        assert Path(command[command.index("-r") + 1]) == requirements
        assert requirements.is_file()
        return subprocess.CompletedProcess(command, audit_code)

    monkeypatch.setattr(audit_python.subprocess, "run", fake_run)
    assert audit_python.main() == expected
    assert len(calls) == (1 if export_code else 2)
    assert requirements is not None and not requirements.parent.exists()
