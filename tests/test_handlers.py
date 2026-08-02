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

    def test_run_conversion_emits_immediate_heartbeat_before_work(self, monkeypatch, tmp_path) -> None:
        """First heartbeat must land at T≈0 so Electron grace covers post-start."""
        from backend.core.jobs import Job

        calls: list[str] = []
        monkeypatch.setattr(
            conversion,
            "send_notification",
            lambda method, params: calls.append(method),
        )
        monkeypatch.setattr(conversion, "set_locale", lambda *_a, **_k: None)

        job = Job(
            id="default",
            job_type="conversion",
            params={"files": [], "destino": str(tmp_path), "locale": "es"},
        )
        with job.state._lock:
            job.state.running = True

        conversion._run_conversion_job(job)

        assert "job.default.heartbeat" in calls
        assert "process.heartbeat" in calls
        # Immediate emit is the first notification, before complete.
        assert calls.index("job.default.heartbeat") < calls.index("process.complete") or (
            "process.complete" not in calls and calls[0] == "job.default.heartbeat"
        )
