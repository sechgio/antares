from __future__ import annotations

import sys
import types
from typing import Any

from backend.handlers import diagnostics


def test_process_snapshot_sin_psutil_devuelve_nulls(monkeypatch) -> None:
    # None en sys.modules provoca ImportError en `import psutil`
    monkeypatch.setitem(sys.modules, "psutil", None)
    snap = diagnostics._process_snapshot()
    assert snap["pid"] > 0
    assert snap["rss_bytes"] is None
    assert snap["cpu_percent"] is None
    assert snap["thread_count"] is None


def test_process_snapshot_con_psutil_reporta_metricas(monkeypatch) -> None:
    fake = types.ModuleType("psutil")

    class _Proc:
        def memory_info(self):
            return types.SimpleNamespace(rss=123456)

        def cpu_percent(self, interval=None):
            return 7.5

        def num_threads(self):
            return 9

    fake.Process = _Proc  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "psutil", fake)
    snap = diagnostics._process_snapshot()
    assert snap["rss_bytes"] == 123456
    assert snap["cpu_percent"] == 7.5
    assert snap["thread_count"] == 9


def test_temporary_storage_snapshot_y_error(monkeypatch) -> None:
    monkeypatch.setattr(
        diagnostics.shutil,
        "disk_usage",
        lambda _p: types.SimpleNamespace(free=25, total=100),
    )
    snap = diagnostics._temporary_storage_snapshot()
    assert snap == {"free_bytes": 25, "total_bytes": 100, "used_percent": 75.0}

    def _boom(_p: str):
        raise OSError("no disk")

    monkeypatch.setattr(diagnostics.shutil, "disk_usage", _boom)
    snap2 = diagnostics._temporary_storage_snapshot()
    assert snap2 == {"free_bytes": None, "total_bytes": None, "used_percent": None}


def test_diagnostics_snapshot_agrega_scheduler_proceso_y_disco(monkeypatch) -> None:
    monkeypatch.setattr(
        diagnostics, "_process_snapshot", lambda: {"pid": 1, "rss_bytes": 2, "cpu_percent": 3.0, "thread_count": 4}
    )
    monkeypatch.setattr(
        diagnostics,
        "_temporary_storage_snapshot",
        lambda: {"free_bytes": 1, "total_bytes": 2, "used_percent": 50.0},
    )

    class _Sched:
        def metrics(self) -> dict[str, Any]:
            return {"queued": 0}

    monkeypatch.setattr(diagnostics, "get_scheduler", _Sched)
    snap = diagnostics.diagnostics_snapshot({"ignored": True})
    assert snap["component"] == "backend"
    assert snap["timestamp"].endswith("Z")
    assert snap["scheduler"] == {"queued": 0}
    assert snap["process"]["pid"] == 1
    assert snap["temporary_storage"]["used_percent"] == 50.0
