from __future__ import annotations

from typing import Any


def test_diagnostics_snapshot_is_safe_and_contains_operational_signals(monkeypatch) -> None:
    from backend.handlers import diagnostics

    class FakeScheduler:
        def metrics(self) -> dict[str, Any]:
            return {
                "light_workers": 2,
                "light_queued": 1,
                "heavy_workers": 4,
                "heavy_queued": 3,
            }

    monkeypatch.setattr(diagnostics, "get_scheduler", lambda: FakeScheduler())
    monkeypatch.setattr(
        diagnostics,
        "_process_snapshot",
        lambda: {"pid": 42, "rss_bytes": 1234, "cpu_percent": 7.5, "thread_count": 9},
    )
    monkeypatch.setattr(
        diagnostics,
        "_temporary_storage_snapshot",
        lambda: {"free_bytes": 100, "total_bytes": 200, "used_percent": 50.0},
    )

    result = diagnostics.diagnostics_snapshot({"document": {"layers": ["secret"]}})

    assert result["component"] == "backend"
    assert isinstance(result["timestamp"], str)
    assert result["scheduler"]["heavy_queued"] == 3
    assert result["process"]["rss_bytes"] == 1234
    assert result["temporary_storage"]["free_bytes"] == 100
    assert "document" not in result
    assert "path" not in result["temporary_storage"]


def test_diagnostics_snapshot_is_registered_as_a_sync_handler() -> None:
    from backend.handlers import HANDLERS

    assert HANDLERS.is_known("diagnostics_snapshot")
    assert callable(HANDLERS.get("diagnostics_snapshot"))
