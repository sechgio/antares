"""Tests for opt-in IPC phase telemetry (latency + RSS)."""

from __future__ import annotations

import io
import json
import logging
import time

import pytest

from backend import ipc_protocol
from backend import main as backend_main
from backend.core import ipc_phase_telemetry as telemetry


@pytest.fixture(autouse=True)
def _reset_telemetry(monkeypatch: pytest.MonkeyPatch) -> None:
    telemetry.reset_for_tests()
    monkeypatch.delenv("ANTARES_IPC_TELEMETRY", raising=False)
    # Force 100% sampling during tests so success-path emits are deterministic.
    # Sampling-specific tests override random to verify the 1% logic.
    monkeypatch.setattr(telemetry.random, "random", lambda: 0.0)
    yield
    telemetry.reset_for_tests()
    monkeypatch.delenv("ANTARES_IPC_TELEMETRY", raising=False)

def test_enabled_is_false_by_default() -> None:
    assert telemetry.enabled() is False


def test_flag_off_is_noop_without_marks_or_logs(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="backend.core.ipc_phase_telemetry"):
        telemetry.start("1", method="version")
        telemetry.mark("1", "enqueue")
        telemetry.emit_and_clear("1")
    assert telemetry.trace_count() == 0
    assert not any("ipc_phase" in r.message for r in caplog.records)


def test_mark_records_rss_and_emit_includes_msg_id(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    monkeypatch.setenv("ANTARES_IPC_TELEMETRY", "1")
    rss_values = iter([100 * 1024 * 1024, 110 * 1024 * 1024, 120 * 1024 * 1024])
    monkeypatch.setattr(telemetry, "_rss_bytes", lambda: next(rss_values))

    with caplog.at_level(logging.INFO, logger="backend.core.ipc_phase_telemetry"):
        telemetry.start("abc", method="version", lane="sync")
        telemetry.mark("abc", "parse")
        telemetry.mark("abc", "handler_end")
        telemetry.set_fields("abc", handler_ok=True, write_ok=True, ok=True)
        telemetry.emit_and_clear("abc")

    assert telemetry.trace_count() == 0
    phase_logs = [r.message for r in caplog.records if "ipc_phase" in r.message]
    assert len(phase_logs) == 1
    line = phase_logs[0]
    assert "msg_id=abc" in line
    assert "method=version" in line
    assert "lane=sync" in line
    assert "handler_ok=True" in line
    assert "write_ok=True" in line
    assert "drss_miB" in line or "rss_miB" in line


def test_rss_failure_does_not_break_emit(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    monkeypatch.setenv("ANTARES_IPC_TELEMETRY", "1")

    def boom() -> int:
        raise RuntimeError("rss unavailable")

    monkeypatch.setattr(telemetry, "_rss_bytes", boom)
    with caplog.at_level(logging.INFO, logger="backend.core.ipc_phase_telemetry"):
        telemetry.start("r1", method="version")
        telemetry.mark("r1", "parse")
        telemetry.set_fields("r1", ok=True)
        telemetry.emit_and_clear("r1")
    assert any("ipc_phase" in r.message and "msg_id=r1" in r.message for r in caplog.records)


def test_rejected_event_omits_handler_ms(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    monkeypatch.setenv("ANTARES_IPC_TELEMETRY", "1")
    with caplog.at_level(logging.WARNING, logger="backend.core.ipc_phase_telemetry"):
        telemetry.start("busy", method="db_import", lane="heavy")
        telemetry.mark("busy", "enqueue")
        telemetry.set_fields("busy", rejected="heavy_queue_full", ok=False, write_ok=True)
        telemetry.emit_and_clear("busy")
    line = next(r.message for r in caplog.records if "ipc_phase" in r.message)
    assert "rejected=heavy_queue_full" in line
    assert "handler_ms=" not in line


def test_read_message_parse_ms_excludes_stdin_idle(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    monkeypatch.setenv("ANTARES_IPC_TELEMETRY", "1")
    monkeypatch.setattr(telemetry, "_rss_bytes", lambda: 50 * 1024 * 1024)

    class SlowFirstRead:
        """Blocks only inside readline; line bytes are already available after return."""

        def __init__(self) -> None:
            self._data = b'{"jsonrpc":"2.0","id":"p1","method":"version","params":{}}\n'
            self._served = False

        @property
        def buffer(self):
            return self

        def readline(self, size: int = -1) -> bytes:
            if not self._served:
                time.sleep(0.05)
                self._served = True
            if not self._data:
                return b""
            newline = self._data.find(b"\n")
            end = len(self._data) if newline < 0 else newline + 1
            amount = end if size < 0 else min(size, end)
            chunk = self._data[:amount]
            self._data = self._data[amount:]
            return chunk

    stdout = io.StringIO()
    monkeypatch.setattr(ipc_protocol.sys, "stdin", SlowFirstRead())
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    with caplog.at_level(logging.INFO, logger="backend.core.ipc_phase_telemetry"):
        msg = ipc_protocol.read_message()
        assert msg is not None and getattr(msg, "id", None) == "p1"
        # Force emit so we can inspect parse_ms without a full dispatch.
        telemetry.set_fields("p1", method="version", lane="sync", ok=True, write_ok=True)
        telemetry.emit_and_clear("p1")

    line = next(r.message for r in caplog.records if "ipc_phase" in r.message)
    # parse_ms must be far below the 50 ms stdin idle sleep.
    assert "parse_ms=" in line
    parse_token = next(part for part in line.split() if part.startswith("parse_ms="))
    parse_ms = float(parse_token.split("=", 1)[1])
    assert parse_ms < 40.0


def test_send_response_emits_serialize_write_and_write_ok(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    monkeypatch.setenv("ANTARES_IPC_TELEMETRY", "1")
    monkeypatch.setattr(telemetry, "_rss_bytes", lambda: 64 * 1024 * 1024)
    stdout = io.BytesIO()

    class Out:
        buffer = stdout

        def write(self, _s: str) -> int:
            raise AssertionError("text path unused")

        def flush(self) -> None:
            return None

    monkeypatch.setattr(ipc_protocol.sys, "stdout", Out())
    telemetry.start("w1", method="version", lane="sync")
    telemetry.mark("w1", "handler_end")
    telemetry.set_fields("w1", handler_ok=True)

    with caplog.at_level(logging.INFO, logger="backend.core.ipc_phase_telemetry"):
        ipc_protocol.send_response({"ok": True}, "w1")

    assert telemetry.trace_count() == 0
    line = next(r.message for r in caplog.records if "ipc_phase" in r.message)
    assert "serialize_write_ms=" in line
    assert "write_ok=True" in line
    assert json.loads(stdout.getvalue().decode())["result"]["ok"] is True


def test_rss_exception_during_send_does_not_break_response(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTARES_IPC_TELEMETRY", "1")

    def boom() -> int:
        raise RuntimeError("rss boom")

    monkeypatch.setattr(telemetry, "_rss_bytes", boom)
    stdout = io.StringIO()
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)
    telemetry.start("safe", method="version")
    ipc_protocol.send_response({"v": 1}, "safe")
    assert '"v": 1' in stdout.getvalue()


def test_scheduler_wait_ms_positive_when_dispatch_delayed(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    monkeypatch.setenv("ANTARES_IPC_TELEMETRY", "1")
    monkeypatch.setattr(telemetry, "_rss_bytes", lambda: 70 * 1024 * 1024)
    stdout = io.StringIO()
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    # Pre-create enqueue mark as submit would.
    telemetry.start("d1", method="version", lane="light")
    telemetry.mark("d1", "enqueue")
    time.sleep(0.03)

    with caplog.at_level(logging.INFO, logger="backend.core.ipc_phase_telemetry"):
        backend_main._dispatch(lambda _p: {"ok": True}, {}, "d1", "version")

    line = next(r.message for r in caplog.records if "ipc_phase" in r.message)
    wait_token = next(part for part in line.split() if part.startswith("scheduler_wait_ms="))
    wait_ms = float(wait_token.split("=", 1)[1])
    assert wait_ms >= 20.0
    assert '"ok": true' in stdout.getvalue().lower()


def test_sync_lane_reports_zero_scheduler_wait(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    monkeypatch.setenv("ANTARES_IPC_TELEMETRY", "1")
    monkeypatch.setattr(telemetry, "_rss_bytes", lambda: 70 * 1024 * 1024)
    stdout = io.StringIO()
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    telemetry.start("s1", method="process_status", lane="sync")
    # Sync path: no enqueue mark before dispatch — wait should be 0.
    with caplog.at_level(logging.INFO, logger="backend.core.ipc_phase_telemetry"):
        backend_main._dispatch(lambda _p: {"running": False}, {}, "s1", "process_status")

    line = next(r.message for r in caplog.records if "ipc_phase" in r.message)
    assert "scheduler_wait_ms=0.0" in line or "scheduler_wait_ms=0" in line


def test_submit_handler_logs_rejected_on_scheduler_busy(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    monkeypatch.setenv("ANTARES_IPC_TELEMETRY", "1")
    monkeypatch.setattr(telemetry, "_rss_bytes", lambda: 80 * 1024 * 1024)
    stdout = io.StringIO()
    monkeypatch.setattr(ipc_protocol.sys, "stdout", stdout)

    class BusyScheduler:
        def submit_heavy(self, *args, **kwargs):
            raise backend_main.SchedulerBusy("heavy_queue_full")

        def submit_light(self, *args, **kwargs):
            raise AssertionError("should use heavy")

        def metrics(self):
            return {}

    monkeypatch.setattr(backend_main, "get_scheduler", lambda: BusyScheduler())

    telemetry.start("h1", method="db_import", lane="heavy")
    with caplog.at_level(logging.WARNING, logger="backend.core.ipc_phase_telemetry"):
        future = backend_main._submit_handler(lambda _p: {}, {}, "h1", "db_import")

    assert future is None
    assert "ocupado" in stdout.getvalue().lower()
    line = next(r.message for r in caplog.records if "ipc_phase" in r.message)
    assert "rejected=heavy_queue_full" in line
    assert "handler_ms=" not in line

def test_sampling_drops_fast_success_when_random_high(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("ANTARES_IPC_TELEMETRY", "1")
    monkeypatch.setattr(telemetry.random, "random", lambda: 0.99)
    monkeypatch.setattr(telemetry, "_rss_bytes", lambda: 60 * 1024 * 1024)
    with caplog.at_level(logging.INFO, logger="backend.core.ipc_phase_telemetry"):
        telemetry.start("sample-drop", method="version", lane="sync")
        telemetry.mark("sample-drop", "handler_end")
        telemetry.set_fields("sample-drop", handler_ok=True, ok=True, handler_ms=10.0)
        telemetry.emit_and_clear("sample-drop")
    assert not any("ipc_phase" in r.message for r in caplog.records)
    assert telemetry.trace_count() == 0


def test_sampling_keeps_error_even_when_random_high(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("ANTARES_IPC_TELEMETRY", "1")
    monkeypatch.setattr(telemetry.random, "random", lambda: 0.99)
    monkeypatch.setattr(telemetry, "_rss_bytes", lambda: 60 * 1024 * 1024)
    with caplog.at_level(logging.INFO, logger="backend.core.ipc_phase_telemetry"):
        telemetry.start("sample-err", method="version", lane="sync")
        telemetry.mark("sample-err", "handler_end")
        telemetry.set_fields("sample-err", handler_ok=False, ok=False, handler_ms=10.0)
        telemetry.emit_and_clear("sample-err")
    assert any("ipc_phase" in r.message and "msg_id=sample-err" in r.message for r in caplog.records)


def test_sampling_keeps_slow_even_when_random_high(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("ANTARES_IPC_TELEMETRY", "1")
    monkeypatch.setattr(telemetry.random, "random", lambda: 0.99)
    monkeypatch.setattr(telemetry, "_rss_bytes", lambda: 60 * 1024 * 1024)
    with caplog.at_level(logging.INFO, logger="backend.core.ipc_phase_telemetry"):
        telemetry.start("sample-slow", method="version", lane="sync")
        telemetry.mark("sample-slow", "handler_end")
        telemetry.set_fields("sample-slow", handler_ok=True, ok=True, handler_ms=6000.0)
        telemetry.emit_and_clear("sample-slow")
    assert any("ipc_phase" in r.message and "msg_id=sample-slow" in r.message for r in caplog.records)
