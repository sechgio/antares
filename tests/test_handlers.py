
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
        assert calls.index("job.default.heartbeat") < calls.index("process.complete") or (
            "process.complete" not in calls and calls[0] == "job.default.heartbeat"
        )


class TestFilterByOptionalIds:
    def test_matches_numeric_item_ids_against_string_params(self) -> None:
        from backend.handlers.common import filter_by_optional_ids

        items = [{'id': 1, 'v': 'a'}, {'id': 2, 'v': 'b'}]
        assert filter_by_optional_ids(items, ['2'], 'empty') == [{'id': 2, 'v': 'b'}]
        assert filter_by_optional_ids(items, [1, '2'], 'empty') == items

    def test_raises_when_no_ids_match(self) -> None:
        import pytest

        from backend.handlers.common import filter_by_optional_ids

        with pytest.raises(ValueError, match='sin coincidencias'):
            filter_by_optional_ids([{'id': 1}], ['9'], 'sin coincidencias')
