"""Tests for IPC handlers."""

from backend import handlers
from backend.handlers import conversion


class TestProcessStart:
    def setup_method(self) -> None:
        handlers._reset_state()

    def test_returns_false_and_logs_when_no_files(self) -> None:
        result = handlers.HANDLERS["process_start"]({"files": [], "destino": "out", "locale": "es"})

        assert result["started"] is False
        assert result["reason"] == "no_files"
        assert handlers._state.logs[0] == {
            "message": "No hay archivos para procesar",
            "tag": "error",
        }


class TestEmitHeartbeat:
    """Heartbeat notifications keep Electron job-activity grace alive (plan 002)."""

    def test_emit_heartbeat_legacy_default_job(self, monkeypatch) -> None:
        calls: list[tuple[str, dict]] = []
        monkeypatch.setattr(
            conversion,
            "send_notification",
            lambda method, params: calls.append((method, params)),
        )

        conversion._emit_heartbeat("default", is_default=True)

        assert calls == [
            ("job.default.heartbeat", {"running": True, "job_id": "default"}),
            ("process.heartbeat", {"running": True, "job_id": "default"}),
        ]
        # No fake progress fields
        for _method, params in calls:
            assert "progress" not in params
            assert "ok_count" not in params

    def test_emit_heartbeat_non_default_job_skips_process_channel(self, monkeypatch) -> None:
        calls: list[tuple[str, dict]] = []
        monkeypatch.setattr(
            conversion,
            "send_notification",
            lambda method, params: calls.append((method, params)),
        )

        conversion._emit_heartbeat("job-abc", is_default=False)

        assert calls == [
            ("job.job-abc.heartbeat", {"running": True, "job_id": "job-abc"}),
        ]
